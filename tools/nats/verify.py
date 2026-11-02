# /// script
# requires-python = ">=3.11"
# dependencies = ["nats-py==2.16.0"]
# ///
"""Exercise the compose image and every runtime permission on a disposable broker."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

from provision import ROOT, connect, initialize, policy, provision


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


async def check(url, credentials, desired, directory):
    assert await provision(url, credentials, desired) == 6
    admin = await connect(url, 'provisioner', credentials)
    js = admin.jetstream()

    async def snapshot():
        streams = [await js.stream_info(s['name']) for s in desired['streams']]
        consumers = [await js.consumer_info(c['stream'], c['config']['name']) for c in desired['consumers']]
        return [s.as_dict() for s in streams], [c.as_dict() for c in consumers]

    before = await snapshot()
    files = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in directory.glob('*') if p.is_file()}
    assert initialize(directory.parent, desired) == credentials
    assert await provision(url, credentials, desired) == 0
    for action in ('init', 'apply'):
        output = subprocess.check_output([
            sys.executable, str(Path(__file__).with_name('provision.py')), action,
            '--data-dir', str(directory.parent), '--url', url,
        ], text=True)
        assert not any(password in output for password in credentials.values())
        if action == 'apply':
            assert output.strip() == 'NATS provisioning complete; 0 resources changed'
    assert await snapshot() == before
    assert files == {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in directory.glob('*') if p.is_file()}
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in directory.glob('*') if p.is_file())
    print('PASS provisioning twice preserves broker state and private files (0600)')
    subjects = [subject.replace('*', 'test-rig') for stream in desired['streams'] for subject in stream['subjects']]
    clients = {}
    errors = {}
    violations = {}
    try:
        for role in desired['permissions']:
            errors[role] = []
            violations[role] = asyncio.Event()
            async def on_error(error, role=role):
                errors[role].append(str(error))
                violations[role].set()
            clients[role] = await connect(url, role, credentials, error_cb=on_error)

        async def probe(role, operation, subject, allowed):
            client = clients[role]
            errors[role].clear()
            violations[role].clear()
            if operation == 'publish':
                await client.publish(subject, b'{}')
            else:
                sub = await client.subscribe(subject)
            await client.flush()
            try:
                await asyncio.wait_for(violations[role].wait(), timeout=0.05 if allowed else 2)
            except TimeoutError:
                pass
            denied = any('permissions violation' in error.lower() for error in errors[role])
            assert denied != allowed, f'{role} {operation} {subject}: expected allowed={allowed}, errors={errors[role]}'
            if operation == 'subscribe':
                await sub.unsubscribe()
            errors[role].clear()

        for role in clients:
            for subject in subjects:
                kind = subject.split('.', 4)[4]
                if role == 'publisher':
                    allowed = kind not in ('solve', 'session', 'mount-position', 'pointing-fix')
                elif role == 'solver':
                    allowed = kind in ('solve', 'gap')
                elif role == 'model':
                    allowed = kind in ('mount-position', 'pointing-fix')
                else:
                    allowed = False
                await probe(role, 'publish', subject, allowed)
                await probe(role, 'subscribe', subject, role == 'observer' and '.assess.' in subject)
            for other in clients:
                await probe(role, 'subscribe', f'_INBOX.{other}.probe', role == other)
                await probe(role, 'publish', f'_INBOX.{other}.probe', False)
            for subject in ('>', 'rig.>', '$JS.API.>', '_INBOX.>', 'rig.v1.*.fact.>'):
                await probe(role, 'subscribe', subject, False)
            for subject in ('unrelated.event', 'rig.v1.test-rig.fact.unknown', 'rig.replay.test-rig.fact.frame',
                            '$JS.API.STREAM.DELETE.RIG_FACTS', '$JS.API.STREAM.PURGE.RIG_FACTS',
                            '$JS.API.STREAM.CREATE.OTHER', '$JS.API.STREAM.MSG.GET.RIG_FACTS',
                            '$JS.API.CONSUMER.CREATE.RIG_FACTS', '$JS.API.CONSUMER.DELETE.RIG_FACTS.model-v1'):
                await probe(role, 'publish', subject, False)
            for consumer in desired['consumers']:
                stream, name = consumer['stream'], consumer['config']['name']
                for subject in (f'$JS.API.CONSUMER.INFO.{stream}.{name}',
                                f'$JS.API.CONSUMER.MSG.NEXT.{stream}.{name}',
                                f'$JS.ACK.{stream}.{name}.1.1.1.1.1'):
                    await probe(role, 'publish', subject, role == consumer['role'])
            print(f'PASS {role}: every registry data subject, private inbox, management and cross-consumer denial')

        publisher = clients['publisher'].jetstream()
        first = await publisher.publish('rig.v1.test-rig.fact.frame', b'{}', headers={'Nats-Msg-Id': 'frame:test-image'})
        second = await publisher.publish('rig.v1.test-rig.fact.frame', b'{}', headers={'Nats-Msg-Id': 'frame:test-image'})
        assert first.seq == second.seq and second.duplicate
        await clients['model'].jetstream().publish('rig.v1.test-rig.assess.mount-position', b'{}')
        for consumer in desired['consumers']:
            role, stream, name = consumer['role'], consumer['stream'], consumer['config']['name']
            runtime = clients[role].jetstream()
            await runtime.consumer_info(stream, name)
            subscription = await runtime.pull_subscribe_bind(stream=stream, durable=name)
            messages = await subscription.fetch(1, timeout=2)
            await messages[0].ack_sync(timeout=2)
            await subscription.unsubscribe()
            assert (await js.consumer_info(stream, name)).ack_floor.consumer_seq == 1
        print('PASS real pull, consumer info and confirmed ack for every durable; message-id deduplication')
    finally:
        await asyncio.gather(*(client.close() for client in clients.values()))
        await admin.close()


def main():
    desired = policy()
    compose = (ROOT / 'compose.yaml').read_text()
    image = next(line.split('image: ', 1)[1] for line in compose.splitlines() if 'image: nats:' in line)
    assert '@sha256:' in image and 'latest' not in image
    assert '127.0.0.1:4222:4222' in compose
    with tempfile.TemporaryDirectory(prefix='vela-nats-') as temporary:
        directory = Path(temporary)
        credentials = initialize(directory, desired)
        name = 'vela-step35-test-' + uuid.uuid4().hex[:12]
        try:
            docker('run', '-d', '--name', name, '--user', f'{os.getuid()}:{os.getgid()}',
                   '-p', '127.0.0.1::4222', '-v', f'{directory / "nats"}:/data',
                   image, '--config', '/data/server.conf')
            binding = json.loads(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', name))['4222/tcp'][0]
            assert binding['HostIp'] == '127.0.0.1'
            url = f'nats://127.0.0.1:{binding["HostPort"]}'
            assert docker('exec', name, 'nats-server', '--version').endswith('v2.15.2')
            asyncio.run(check(url, credentials, desired, directory / 'nats'))
        finally:
            docker('rm', '-f', name)
    print('PASS throwaway broker and private data removed; real compose project untouched')


if __name__ == '__main__':
    main()
