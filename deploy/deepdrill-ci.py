#!/usr/bin/python3
"""Restricted SSH deployment receiver. Run as deepdrill, never as root."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/home/deepdrill/apps')
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 500 * 1024 * 1024


def command(value):
    match = re.fullmatch(r'deploy ([0-9a-f]{40}) ([0-9a-f]{64})', value)
    if not match:
        raise ValueError('Only deploy <commit SHA> <artifact SHA256> is permitted')
    return match.groups()


def receive(stream, path, expected):
    total = 0
    digest = hashlib.sha256()
    with path.open('xb') as output:
        while chunk := stream.read(65536):
            total += len(chunk)
            if total > MAX_ARCHIVE:
                raise ValueError('Artifact too large')
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != expected:
        raise ValueError('Artifact checksum mismatch')


def extract(archive, directory):
    with tarfile.open(archive, 'r:gz') as tar:
        entries = tar.getmembers()
        total = 0
        for item in entries:
            path = PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not path.parts:
                raise ValueError('Unsafe artifact path')
            if path.parts[0] not in {'dist', 'node_modules', 'package.json', 'package-lock.json'}:
                raise ValueError('Unexpected artifact content')
            if not (item.isdir() or item.isfile()):
                raise ValueError('Artifact links and special files are forbidden')
            total += item.size
            if total > MAX_EXPANDED:
                raise ValueError('Expanded artifact too large')
        for item in entries:
            dest = directory.joinpath(*PurePosixPath(item.name).parts)
            if item.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(item) as source, dest.open('wb') as output:
                    shutil.copyfileobj(source, output)
                dest.chmod(0o755 if item.mode & 0o111 else 0o644)
    if not (directory / 'dist/main.js').is_file():
        raise ValueError('Missing backend entrypoint')


def restart():
    subprocess.run(['sudo', '-n', '/bin/systemctl', 'restart', 'deepdrill-api.service'], check=True)


def healthy():
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3200/api/v1/health', timeout=2) as response:
                data = json.load(response)
                if data == {'status': 'ok', 'database': 'up'}:
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


def activate(base, release, restart_fn=restart, health_fn=healthy):
    current = base / 'current'
    previous = current.resolve() if current.is_symlink() else None
    candidate = base / ('.current-' + str(os.getpid()))
    candidate.symlink_to(release)
    candidate.replace(current)
    try:
        restart_fn()
        if not health_fn():
            raise RuntimeError('New release health check failed')
    except Exception:
        if previous:
            candidate.symlink_to(previous)
            candidate.replace(current)
            restart_fn()
        else:
            current.unlink(missing_ok=True)
        raise


def main():
    os.umask(0o077)
    sha, digest = command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    BASE.mkdir(parents=True, exist_ok=True)
    releases = BASE / 'releases'
    releases.mkdir(exist_ok=True)
    with (BASE / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='.incoming-', dir=BASE) as incoming:
            archive = Path(incoming) / 'release.tar.gz'
            receive(sys.stdin.buffer, archive, digest)
            release = releases / sha
            if not release.exists():
                staging = Path(incoming) / 'release'
                staging.mkdir()
                extract(archive, staging)
                staging.rename(release)
            activate(BASE, release)
            # Retain the active release plus at least four previous verified builds.
            old = sorted((p for p in releases.iterdir() if p.is_dir() and not p.is_symlink() and re.fullmatch('[0-9a-f]{40}', p.name)), key=lambda p: p.stat().st_mtime, reverse=True)
            for path in old[5:]:
                if path != release:
                    shutil.rmtree(path)
            print('Activated Deep Drill release ' + sha, flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
