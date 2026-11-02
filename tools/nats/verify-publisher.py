# /// script
# requires-python = ">=3.11"
# dependencies = ["nats-py==2.16.0"]
# ///
"""Run the fake-rig capture check against a private, disposable broker."""
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
    with tempfile.TemporaryDirectory(prefix='vela-publisher-') as temporary:
        directory = Path(temporary)
        name = 'vela-step36-' + uuid.uuid4().hex[:12]
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
            subprocess.run(['pnpm', 'exec', 'vitest', 'run', 'apps/server/tests/publisher-broker.test.ts'], cwd=ROOT, check=True,
                           env={**os.environ, 'TEST_NATS_URL': url, 'TEST_NATS_CREDENTIALS': str(directory / 'nats/credentials.json'), 'TEST_NATS_CONTAINER': name})
        finally:
            subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)
    print('PASS disposable broker and private files removed; live compose untouched')


if __name__ == '__main__':
    main()
