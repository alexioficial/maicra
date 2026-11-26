import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { FakeRuntime } from './runtime/fake.js';
import type { RuntimeSpec } from './runtime/types.js';
import { VersionService } from './versions.js';

process.env.LOG_LEVEL = 'silent';

class StubVersions extends VersionService {
  override async latestRelease() { return '1.21.1'; }
  override async javaFor() { return '21' as const; }
}

class RecordingRuntime extends FakeRuntime {
  spec: RuntimeSpec | null = null;
  override async recreate(spec: RuntimeSpec) {
    this.spec = spec;
    await super.recreate(spec);
  }
}

async function fixture(run: (ctx: {
  call: (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => ReturnType<Awaited<ReturnType<typeof buildApp>>['app']['inject']>;
  manager: Awaited<ReturnType<typeof buildApp>>['manager'];
  runtime: RecordingRuntime;
  dir: string;
}) => Promise<void>, configOverrides: NodeJS.ProcessEnv = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maicra-connection-'));
  const config = loadConfig({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'maicra-dev-password',
    SESSION_SECRET: 'x'.repeat(40), DATA_DIR: dir, RUNTIME: 'fake', MC_PORT: '25570', MC_PUBLIC_ADDRESS: 'play.example.com', ...configOverrides });
  const runtime = new RecordingRuntime(dir);
  const { app, manager } = await buildApp(config, { runtime, versions: new StubVersions() });
  await manager.init();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login',
    payload: { email: 'admin@example.com', password: 'maicra-dev-password' } });
  const cookie = login.cookies.find((entry) => entry.name === 'maicra_session')!.value;
  const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies: { maicra_session: cookie } });
  try { await run({ call, manager, runtime, dir }); }
  finally { manager.shutdown(); await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
}

test('connection settings inherit environment defaults and persist IP or domain overrides', async () => {
  await fixture(async ({ call, manager, dir }) => {
    const initial = (await call('GET', '/api/environment')).json();
    assert.equal(initial.port, 25570);
    assert.equal(initial.publicAddress, 'play.example.com');
    assert.equal(manager.snapshot().address, 'play.example.com:25570');
    for (const [publicAddress, port, address] of [
      ['play.example.com', 25565, 'play.example.com'],
      ['play.example.com', 25580, 'play.example.com:25580'],
      ['203.0.113.10', 25580, '203.0.113.10:25580'],
      ['2001:db8::1', 25580, '[2001:db8::1]:25580'],
      ['[2001:db8::1]', 25565, '[2001:db8::1]'],
    ] as const) {
      assert.equal((await call('PUT', '/api/environment', { publicAddress, port })).statusCode, 200);
      assert.equal(manager.snapshot().address, address);
    }
    await call('PUT', '/api/environment', { publicAddress: '203.0.113.10', port: 25580 });
    const saved = JSON.parse(await fs.readFile(path.join(dir, '.maicra/state.json'), 'utf8'));
    assert.equal(saved.port, 25580);
    assert.equal(saved.publicAddress, '203.0.113.10');
    await call('PUT', '/api/environment', { timezone: 'UTC' });
    assert.equal(manager.snapshot().address, '203.0.113.10:25580');
    manager.shutdown();
    await manager.init();
    assert.equal(manager.snapshot().address, '203.0.113.10:25580');
  });
});

test('an existing address with an explicit port is preserved until connection settings are saved', async () => {
  await fixture(async ({ call, manager }) => {
    assert.equal(manager.snapshot().address, 'play.example.com:25580');
    assert.equal((await call('GET', '/api/environment')).json().publicAddress, 'play.example.com');
    await call('PUT', '/api/environment', { timezone: 'UTC' });
    assert.equal(manager.snapshot().address, 'play.example.com:25580');
    await call('PUT', '/api/environment', { port: 25590 });
    assert.equal(manager.snapshot().address, 'play.example.com:25590');
    await call('PUT', '/api/environment', { port: 25565 });
    assert.equal(manager.snapshot().address, 'play.example.com');
  }, { MC_PUBLIC_ADDRESS: 'play.example.com:25580' });
});

test('invalid connection settings are rejected without changing the address', async () => {
  await fixture(async ({ call, manager }) => {
    for (const port of [0, -1, 65536, 25565.5, '25580', null]) {
      assert.equal((await call('PUT', '/api/environment', { port })).statusCode, 400, String(port));
    }
    for (const publicAddress of ['', 'https://play.example.com', 'play.example.com:25580', 'a/b', 'bad host', '999.999.999.999', '[bad]', 'a\n.example', 'play%2eexample.com']) {
      assert.equal((await call('PUT', '/api/environment', { publicAddress })).statusCode, 400, publicAddress);
    }
    assert.equal(manager.snapshot().address, 'play.example.com:25570');
  });
});

test('launch uses the public port and repairs an edited internal port without changing other properties', async () => {
  await fixture(async ({ call, manager, runtime, dir }) => {
    await fs.writeFile(path.join(dir, 'server.properties'), '#Keep this comment\nserver-port=25565\nmotd=Keep this MOTD\nserver-port=25599\n');
    await call('PUT', '/api/environment', { port: 25580 });
    await call('POST', '/api/server/eula', { accept: true });
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    const deadline = Date.now() + 15000;
    while (manager.snapshot().status !== 'online') {
      assert.ok(Date.now() < deadline, 'the fake server starts');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(runtime.spec?.port, 25580);
    const raw = await fs.readFile(path.join(dir, 'server.properties'), 'utf8');
    assert.match(raw, /server-port=25565/);
    assert.equal(raw.includes('server-port=25599'), false, 'a duplicate must not override the internal port');
    assert.match(raw, /motd=Keep this MOTD/);
    assert.match(raw, /#Keep this comment/);
    assert.equal((await call('PUT', '/api/environment', { port: 25581 })).statusCode, 409);
    assert.equal((await call('PUT', '/api/environment', { publicAddress: 'other.example.com' })).statusCode, 409);
    await call('POST', '/api/server/stop');
    while (manager.snapshot().status !== 'offline') await new Promise((resolve) => setTimeout(resolve, 100));
  });
});
