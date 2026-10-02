#!/usr/bin/python3
"""Daily MongoDB dump and OpenBao Raft snapshot; AppRole never grants writes."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import urllib.request

ROOT = Path('/var/backups/deepdrill')
TLS = ssl.create_default_context(cafile='/etc/deepdrill/openbao-ca.crt')


def request(path, token=None, data=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['X-Vault-Token'] = token
    req = urllib.request.Request('https://127.0.0.1:8200/v1/' + path,
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers=headers)
    return urllib.request.urlopen(req, context=TLS, timeout=120)


def main():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        credentials = Path(os.environ['CREDENTIALS_DIRECTORY'])
        with request('auth/approle/login', data={
            'role_id': (credentials / 'role-id').read_text().strip(),
            'secret_id': (credentials / 'secret-id').read_text().strip(),
        }) as response:
            token = json.load(response)['auth']['client_token']
        try:
            with request('secret/data/deepdrill/backup', token) as response:
                uri = json.load(response)['data']['data']['MONGODB_URI']
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            with tempfile.TemporaryDirectory(prefix='.pending-', dir=ROOT) as staging:
                directory = Path(staging)
                with tempfile.TemporaryDirectory(prefix='deepdrill-dump-', dir='/run') as private:
                    config = Path(private) / 'mongo.yml'
                    config.write_text('uri: ' + json.dumps(uri) + '\n')
                    result = subprocess.run(['mongodump', '--config=' + str(config), '--db=deep-drill',
                                             '--archive=' + str(directory / 'mongo.archive.gz'), '--gzip'],
                                            capture_output=True, timeout=900)
                    if result.returncode:
                        raise RuntimeError('MongoDB backup failed (credentials and database output withheld)')
                with request('sys/storage/raft/snapshot', token) as response:
                    with (directory / 'openbao.snap').open('wb') as output:
                        shutil.copyfileobj(response, output)
                checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()}
                (directory / 'sha256.json').write_text(json.dumps(checksums, indent=2) + '\n')
                directory.rename(ROOT / stamp)
            complete = sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.is_symlink() and
                              len(p.name) == 16 and p.name.endswith('Z') and (p / 'sha256.json').is_file())
            for old in complete[:-7]:
                shutil.rmtree(old)
            print('Deep Drill MongoDB and OpenBao backup completed: ' + stamp)
        finally:
            with request('auth/token/revoke-self', token, {}) as response:
                response.read()


if __name__ == '__main__':
    main()
