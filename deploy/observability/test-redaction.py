#!/usr/bin/env python3
"""Integration check with the installed Alloy binary; synthetic data only.

Runs an isolated file -> production processing stages -> loki.echo pipeline.
Does not write to Loki, read application logs or restart any service.
"""
import json
import os
from pathlib import Path
import subprocess
import socket
import tempfile
import time

config = Path(__file__).with_name('config.alloy').read_text()
pipeline = config[config.index('loki.process "api"'):config.index('loki.write "local"')]
pipeline = pipeline.replace('loki.write.local.receiver', 'loki.echo.test.receiver')
fixtures = [
    ('redaction-check-1 Bearer fakeBearerValue123', 'fakeBearerValue123'),
    ('redaction-check-2 eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.fakeSignature', 'eyJhbGciOiJub25lIn0'),
    ('redaction-check-3 mongodb+srv://fakeUser:fakeMongoPassword@db.invalid/test', 'fakeMongoPassword'),
    ('{"message":"redaction-check-4", "password":"fakeJsonPassword", "level":"error"}', 'fakeJsonPassword'),
    ('{"message":"redaction-check-5", "access_token":"fakeAccessToken", "level":"info"}', 'fakeAccessToken'),
    ('redaction-check-6 harmless startup message', None),
]
with tempfile.TemporaryDirectory(prefix='alloy-redaction-') as tmp:
    root = Path(tmp)
    source = root/'input.log'
    source.write_text('\n'.join(line for line, _ in fixtures)+'\n')
    cfg = root/'test.alloy'
    cfg.write_text('''logging { level = "info" }
loki.source.file "test" {
 targets = [{__path__ = PATH, service = "synthetic-test"}]
 forward_to = [loki.process.api.receiver]
}
loki.echo "test" {}
'''.replace('PATH',json.dumps(str(source)))+pipeline)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with (root/'output').open('w+') as output:
        proc = subprocess.Popen(['alloy','run','--disable-reporting','--server.http.listen-addr=127.0.0.1:'+str(port),'--storage.path='+str(root/'storage'),str(cfg)],stdout=output,stderr=subprocess.STDOUT,env={**os.environ,'GOMEMLIMIT':'96MiB','GOMAXPROCS':'1'})
        try:
            deadline=time.monotonic()+20
            while time.monotonic()<deadline:
                output.flush(); output.seek(0); captured=output.read()
                if all('redaction-check-'+str(i) in captured for i in range(1,7)):break
                if proc.poll() is not None:raise RuntimeError('Isolated Alloy process exited: '+captured)
                time.sleep(0.25)
            else:raise AssertionError('Timed out waiting for all synthetic logs: '+captured)
        finally:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        for i,(_,secret) in enumerate(fixtures,1):
            assert 'redaction-check-'+str(i) in captured
            if secret:
                assert secret not in captured, 'Synthetic credential was not redacted: case '+str(i)
        assert captured.count('[REDACTED')>=5
        assert 'harmless startup message' in captured
        assert 'error' in captured
print('PASS: six synthetic logs processed; Bearer/JWT/Mongo/JSON credentials redacted; ordinary message preserved.')
