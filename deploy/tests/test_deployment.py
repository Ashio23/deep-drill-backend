import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'deepdrill-ci.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTest(unittest.TestCase):
    def test_rejects_arbitrary_ssh_commands(self):
        for cmd in ['sh', 'deploy ../x ' + 'b'*64, 'deploy ' + 'a'*40 + ' ' + 'b'*64 + '; id', 'scp -t /tmp/file']:
            with self.assertRaises(ValueError): deploy.command(cmd)
        self.assertEqual(deploy.command('deploy ' + 'a'*40 + ' ' + 'b'*64), ('a'*40, 'b'*64))

    def test_rejects_corrupt_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): deploy.receive(io.BytesIO(b'bad'), Path(tmp)/'artifact', hashlib.sha256(b'good').hexdigest())

    def test_rejects_traversal_links_and_secrets(self):
        for name, kind in [('../escape',tarfile.REGTYPE),('/etc/passwd',tarfile.REGTYPE),('node_modules/link',tarfile.SYMTYPE),('.env',tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                archive=Path(tmp)/'test.tar.gz'; dest=Path(tmp)/'dest';dest.mkdir()
                with tarfile.open(archive,'w:gz') as tar:
                    entry=tarfile.TarInfo(name);entry.type=kind;entry.linkname='/etc/passwd';tar.addfile(entry,io.BytesIO())
                with self.assertRaises(ValueError): deploy.extract(archive,dest)

    def test_healthy_release_activates_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve();old=base/'old';old.mkdir();new=base/'new';new.mkdir();(base/'current').symlink_to(old)
            calls=[];deploy.activate(base,new,lambda:calls.append('restart'),lambda:True)
            self.assertEqual((base/'current').resolve(),new);self.assertEqual(calls,['restart'])

    def test_unhealthy_release_rolls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve();old=base/'old';old.mkdir();new=base/'new';new.mkdir();(base/'current').symlink_to(old)
            calls=[]
            with self.assertRaises(RuntimeError):deploy.activate(base,new,lambda:calls.append((base/'current').resolve()),lambda:False)
            self.assertEqual((base/'current').resolve(),old);self.assertEqual(calls,[new,old])

    def test_failed_initial_release_has_no_current_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve();new=base/'new';new.mkdir()
            with self.assertRaises(RuntimeError):deploy.activate(base,new,lambda:None,lambda:False)
            self.assertFalse((base/'current').is_symlink())

if __name__=='__main__':unittest.main()
