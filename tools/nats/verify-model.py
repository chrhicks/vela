# /// script
# requires-python = ">=3.11"
# dependencies = ["nats-py==2.16.0"]
# ///
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import uuid

from provision import ROOT


def main():
    image = next(line.split('image: ', 1)[1] for line in (ROOT / 'compose.yaml').read_text().splitlines() if 'image: nats:' in line)
    with tempfile.TemporaryDirectory(prefix='vela-model-') as temporary:
        directory = Path(temporary)
        name = 'vela-step39-' + uuid.uuid4().hex[:12]
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        try:
            subprocess.run(['uv', 'run', str(ROOT / 'tools/nats/provision.py'), 'init', '--data-dir', temporary], check=True)
            subprocess.run(['docker', 'run', '-d', '--name', name, '--user', f'{os.getuid()}:{os.getgid()}',
                            '-p', f'127.0.0.1:{port}:4222', '-v', f'{directory / "nats"}:/data', image,
                            '--config', '/data/server.conf'], check=True, stdout=subprocess.DEVNULL)
            binding = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', name]))['4222/tcp'][0]
            url = f'nats://127.0.0.1:{binding["HostPort"]}'
            subprocess.run(['uv', 'run', str(ROOT / 'tools/nats/provision.py'), 'apply', '--data-dir', temporary, '--url', url], check=True)
            result = subprocess.run(['pnpm', 'exec', 'vitest', 'run', 'apps/server/tests/model-replay.test.ts'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                           env={**os.environ, 'TEST_NATS_URL': url, 'TEST_NATS_CREDENTIALS': str(directory / 'nats/credentials.json'), 'TEST_SAFE_KILL': str(Path.home() / 'dev/personal/home/tools/safe-kill/safe_kill.py')})
            credentials = json.loads((directory / 'nats/credentials.json').read_text())
            if any(secret in result.stdout for secret in credentials.values()):
                raise RuntimeError('Credential appeared in model test output')
            print(result.stdout, end='')
            result.check_returncode()
            print('PASS credentialLeaks=0')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)
    print('PASS disposable broker and private files removed; live compose untouched')


if __name__ == '__main__':
    main()
