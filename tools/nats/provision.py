# /// script
# requires-python = ">=3.11"
# dependencies = ["nats-py==2.16.0"]
# ///
"""Generate private broker files, then reconcile the rig streams and consumers."""
import argparse
from copy import deepcopy
import asyncio
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from urllib.parse import urlparse

import nats
from nats.js.errors import NotFoundError
from nats.js.api import ConsumerConfig, StreamConfig

ROOT = Path(__file__).resolve().parents[2]


def policy():
    return json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('policy.mjs'))]))


def private_write(path, value):
    content = json.dumps(value, indent=2) + '\n'
    if path.exists() and path.read_text() == content:
        path.chmod(0o600)
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def initialize(data_dir, desired):
    directory = data_dir.resolve() / 'nats'
    if directory.is_relative_to(ROOT):
        raise ValueError('NATS data must be outside the checkout')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    credentials_path = directory / 'credentials.json'
    if not credentials_path.exists():
        private_write(credentials_path, {
            role: secrets.token_urlsafe(32) for role in ['provisioner', *desired['permissions']]
        })
    credentials_path.chmod(0o600)
    credentials = json.loads(credentials_path.read_text())
    users = [{'user': 'provisioner', 'password': credentials['provisioner'], 'permissions': {
        'publish': {'allow': ['$JS.API.>']},
        'subscribe': {'allow': ['_INBOX.provisioner.>']},
    }}]
    users.extend({'user': role, 'password': credentials[role], 'permissions': permissions}
                 for role, permissions in desired['permissions'].items())
    private_write(directory / 'server.conf', {
        'listen': '0.0.0.0:4222',
        'jetstream': {'store_dir': '/data/jetstream', 'max_file_store': 24 * 1024 ** 3, 'max_memory_store': 64 * 1024 ** 2},
        'authorization': {'users': users},
    })
    return credentials


async def connect(url, role, credentials, **options):
    parsed = urlparse(url)
    if parsed.scheme != 'nats' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password:
        raise ValueError('Provisioning accepts only a local nats:// URL without credentials')
    return await nats.connect(url, user=role, password=credentials[role],
                              inbox_prefix=f'_INBOX.{role}'.encode(),
                              allow_reconnect=False, connect_timeout=2, **options)


def matches(actual, desired):
    return all(actual.get(key) == value for key, value in desired.items())


async def provision(url, credentials, desired):
    connection = await connect(url, 'provisioner', credentials)
    changes = 0
    try:
        js = connection.jetstream()
        for stream in desired['streams']:
            try:
                current = await js.stream_info(stream['name'])
            except NotFoundError:
                await js.add_stream(config=StreamConfig.from_response(deepcopy(stream)))
                changes += 1
                continue
            if not matches(current.config.as_dict(), stream):
                await js.update_stream(config=StreamConfig.from_response(deepcopy(stream)))
                changes += 1
        for consumer in desired['consumers']:
            stream, config = consumer['stream'], consumer['config']
            try:
                current = await js.consumer_info(stream, config['name'])
            except NotFoundError:
                current = None
            if current is None or not matches(current.config.as_dict(), config):
                await js.add_consumer(stream, config=ConsumerConfig.from_response(deepcopy(config)))
                changes += 1
    finally:
        await connection.close()
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'apply'])
    parser.add_argument('--data-dir', type=Path, default=Path(os.environ.get('VELA_DATA_DIR',
                        str(Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'vela'))))
    parser.add_argument('--url', default='nats://127.0.0.1:4222')
    args = parser.parse_args()
    desired = policy()
    credentials = initialize(args.data_dir, desired)
    if args.action == 'apply':
        changes = asyncio.run(provision(args.url, credentials, desired))
        print(f'NATS provisioning complete; {changes} resources changed')
    else:
        print('NATS private files ready')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('NATS provisioning failed; check the local broker and private files') from None
