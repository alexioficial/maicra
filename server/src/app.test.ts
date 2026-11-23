import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { FileService } from './files.js';
import { offlineUuid } from './players.js';
import { FakeRuntime } from './runtime/fake.js';
import type { ServerSnapshot } from './types.js';
import { VersionService } from './versions.js';

/** Version lookups without the network. */
class StubVersions extends VersionService {
  override async latestRelease() {
    return '1.21.11';
  }
  override async list() {
    return ['1.21.11', '1.21.10'];
  }
  override async javaFor() {
    return '21' as const;
  }
}

const PASSWORD = 'correct-horse-battery';
process.env.LOG_LEVEL = 'silent';

describe('panel api', () => {
  let dataDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let manager: Awaited<ReturnType<typeof buildApp>>['manager'];
  let runtime: FakeRuntime;
  let cookie = '';

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object | undefined, cookies: cookie ? { maicra_session: cookie } : {} });

  const waitForStatus = async (wanted: ServerSnapshot['status'], timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = (await call('GET', '/api/server')).json<ServerSnapshot>();
      if (snapshot.status === wanted) return snapshot;
      if (Date.now() > deadline) assert.fail(`Timed out waiting for ${wanted}, last status was ${snapshot.status}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maicra-test-'));
    const config = loadConfig({
      ADMIN_EMAIL: 'owner@example.com',
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: 'x'.repeat(40),
      DATA_DIR: dataDir,
      RUNTIME: 'fake',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    runtime = new FakeRuntime(dataDir);
    ({ app, manager } = await buildApp(config, { versions: new StubVersions(), runtime }));
    await manager.init();
  });

  after(async () => {
    manager.shutdown();
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  test('rejects requests without a session', async () => {
    assert.equal((await call('GET', '/api/server')).statusCode, 401);
    assert.equal((await call('GET', '/api/auth/me')).statusCode, 401);
  });

  test('health check works without a session', async () => {
    const response = await call('GET', '/api/health');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  });

  test('rejects a wrong password and accepts the right one', async () => {
    const bad = await call('POST', '/api/auth/login', { email: 'owner@example.com', password: 'nope' });
    assert.equal(bad.statusCode, 401);

    const good = await call('POST', '/api/auth/login', { email: 'OWNER@example.com', password: PASSWORD });
    assert.equal(good.statusCode, 200);
    const setCookie = good.cookies.find((c) => c.name === 'maicra_session');
    assert.ok(setCookie, 'session cookie is set');
    assert.equal(setCookie.httpOnly, true);
    cookie = setCookie.value;

    assert.equal((await call('GET', '/api/auth/me')).json().email, 'owner@example.com');
  });

  test('rejects a tampered session token', async () => {
    const saved = cookie;
    cookie = saved.slice(0, -2) + 'xx';
    assert.equal((await call('GET', '/api/server')).statusCode, 401);
    cookie = saved;
  });

  test('blocks cross-site writes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/server/stop',
      headers: { origin: 'https://evil.example', host: 'panel.example' },
      cookies: { maicra_session: cookie },
    });
    assert.equal(response.statusCode, 403);
  });

  test('starts offline and asks for the EULA first', async () => {
    const snapshot = (await call('GET', '/api/server')).json<ServerSnapshot>();
    assert.equal(snapshot.status, 'offline');
    assert.equal(snapshot.eulaAccepted, false);
    assert.deepEqual(snapshot.software, { type: 'vanilla', version: '1.21.11', java: '21' });

    const refused = await call('POST', '/api/server/start');
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, 'eula');
  });

  test('runs the full start, command and stop cycle', async () => {
    assert.equal((await call('POST', '/api/server/eula', { accept: true })).statusCode, 200);
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    assert.equal((await call('POST', '/api/server/start')).statusCode, 409, 'cannot start twice');

    const online = await waitForStatus('online');
    assert.ok(online.startedAt, 'has a start time');

    const output = (await call('POST', '/api/console/command', { command: '/list' })).json();
    assert.match(output.output, /There are 0 of a max of 20 players online/);
    assert.ok(manager.history().some((line) => /Done \(/.test(line.text)), 'console history has the Done line');

    assert.equal((await call('PUT', '/api/software', { type: 'vanilla', version: '1.21.10' })).statusCode, 409, 'no software change while running');

    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    await waitForStatus('offline');
    assert.equal((await call('POST', '/api/console/command', { command: 'list' })).statusCode, 409);
  });

  test('changes software only while offline and validates the version', async () => {
    const ok = await call('PUT', '/api/software', { type: 'vanilla', version: '1.21.10' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().version, '1.21.10');

    const bad = await call('PUT', '/api/software', { type: 'vanilla', version: '0.0.1' });
    assert.equal(bad.statusCode, 400);
  });

  test('raises the RAM while offline, within what the machine can give', async () => {
    const before = (await call('GET', '/api/environment')).json();
    assert.equal(before.memoryMb, 2048, 'starts from the MC_MEMORY default');
    assert.equal(before.hostMemoryMb, 16384);
    assert.equal(before.recommendedMemoryMb, 12288);
    assert.ok(before.memoryOptionsMb.includes(4096));
    assert.ok(!before.memoryOptionsMb.includes(16384), 'the whole machine is not offered');

    const raised = await call('PUT', '/api/environment', { memoryMb: 4096 });
    assert.equal(raised.statusCode, 200);
    assert.equal(raised.json().memoryMb, 4096);
    assert.equal((await call('GET', '/api/environment')).json().memoryMb, 4096, 'the choice is kept');

    assert.equal((await call('PUT', '/api/environment', { memoryMb: 512 })).statusCode, 400, 'below the minimum');
    assert.equal((await call('PUT', '/api/environment', { memoryMb: 1500 })).statusCode, 400, 'not a multiple of 256');
    const tooMuch = await call('PUT', '/api/environment', { memoryMb: 16384 });
    assert.equal(tooMuch.statusCode, 400);
    assert.match(tooMuch.json().message, /most you can give/);
    assert.equal((await call('GET', '/api/environment')).json().memoryMb, 4096, 'rejected values change nothing');

    // The next container is built with the new size, so Minecraft starts with it.
    assert.equal(manager.snapshot().software.java, '21');
  });

  test('reads and updates server.properties without losing other keys', async () => {
    const before = (await call('GET', '/api/options/properties')).json();
    assert.equal(before.exists, true);
    assert.equal(before.properties['max-players'], '20');

    const updated = await call('PUT', '/api/options/properties', { properties: { 'max-players': '50', 'view-distance': '12' } });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().properties['max-players'], '50');
    assert.equal(updated.json().properties['motd'], 'A Minecraft Server');

    const raw = await fs.readFile(path.join(dataDir, 'server.properties'), 'utf8');
    assert.match(raw, /^#Minecraft server properties$/m, 'comments are kept');
    assert.equal((await call('PUT', '/api/options/properties', { properties: { 'bad key': '1' } })).statusCode, 400);
  });

  test('manages files and refuses paths outside the server folder', async () => {
    assert.equal((await call('POST', '/api/files/folder', { path: '/plugins/configs' })).statusCode, 200);
    assert.equal((await call('PUT', '/api/files/content', { path: '/plugins/configs/a.yml', content: 'hello: world\n' })).statusCode, 200);

    const listing = (await call('GET', '/api/files?path=/plugins/configs')).json();
    assert.deepEqual(listing.entries.map((e: { name: string }) => e.name), ['a.yml']);
    assert.equal((await call('GET', '/api/files/content?path=/plugins/configs/a.yml')).json().content, 'hello: world\n');

    const rename = await call('POST', '/api/files/rename', { path: '/plugins/configs/a.yml', name: 'b.yml' });
    assert.equal(rename.statusCode, 200);
    assert.equal((await call('DELETE', '/api/files?path=/plugins/configs')).statusCode, 200);

    // Without "parents" a missing parent is an error. With it, the whole chain is created, and repeating is fine.
    assert.equal((await call('POST', '/api/files/folder', { path: '/pack-world/datapacks' })).statusCode, 404);
    assert.equal((await call('POST', '/api/files/folder', { path: '/pack-world/datapacks', parents: true })).statusCode, 200);
    assert.equal((await call('POST', '/api/files/folder', { path: '/pack-world/datapacks', parents: true })).statusCode, 200);
    assert.deepEqual((await call('GET', '/api/files?path=/pack-world')).json().entries.map((e: { name: string }) => e.name), ['datapacks']);
    assert.equal((await call('POST', '/api/files/folder', { path: '/.maicra/x', parents: true })).statusCode, 403, 'the hidden folder stays off limits');
    await call('DELETE', '/api/files?path=/pack-world');

    // Traversal attempts stay inside the root instead of reaching the real file system.
    const escape = await call('GET', '/api/files/content?path=' + encodeURIComponent('/../../../../etc/passwd'));
    assert.equal(escape.statusCode, 404);
    assert.equal((await call('GET', '/api/files/content?path=/.maicra/state.json')).statusCode, 403);

    const root = (await call('GET', '/api/files?path=/')).json();
    assert.ok(!root.entries.some((e: { name: string }) => e.name === '.maicra'), 'hidden folder is not listed');
    assert.equal((await call('DELETE', '/api/files?path=/')).statusCode, 400, 'root cannot be deleted');
  });

  test('edits player lists while offline using offline mode uuids', async () => {
    await call('PUT', '/api/options/properties', { properties: { 'online-mode': 'false' } });

    const added = await call('POST', '/api/players/whitelist', { value: 'Steve' });
    assert.equal(added.statusCode, 200);
    assert.deepEqual(added.json().entries, [{ id: offlineUuid('Steve'), name: 'Steve' }]);

    assert.equal((await call('POST', '/api/players/ops', { value: 'bad name!' })).statusCode, 400);
    assert.equal((await call('POST', '/api/players/banned-ips', { value: '203.0.113.9' })).statusCode, 200);

    const removed = await call('DELETE', `/api/players/whitelist?id=${offlineUuid('Steve')}`);
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json().entries, []);
  });

  test('serves the server icon only when one exists', async () => {
    assert.equal((await call('GET', '/api/server/icon')).statusCode, 404);
    await fs.writeFile(path.join(dataDir, 'server-icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const response = await call('GET', '/api/server/icon');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    await fs.rm(path.join(dataDir, 'server-icon.png'));
  });

  test('offline uuid matches the value Minecraft computes', () => {
    assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  });

  test('file service keeps resolved paths inside the root', () => {
    const files = new FileService(path.join(dataDir, 'x'), 1000, 1000);
    for (const input of ['/../../etc/passwd', '..\\..\\windows', '/a/../../b', '////..//']) {
      const resolved = files.resolve(input);
      assert.ok(resolved.startsWith(path.join(dataDir, 'x')), `${input} -> ${resolved}`);
    }
  });

  test('stop while Minecraft is still loading waits for it and then stops it safely', async () => {
    // A real image ignores a stop that arrives during loading and Docker kills it after the timeout.
    runtime.stoppedWhileLoading = false;
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    while (!(await runtime.inspect()).running) await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    const waiting = (await call('GET', '/api/server')).json<ServerSnapshot>();
    assert.equal(waiting.status, 'stopping');
    assert.match(waiting.detail ?? '', /finish loading|Cancelling/);

    await waitForStatus('offline');
    assert.equal(runtime.stoppedWhileLoading, false, 'the stop was held back until the server was ready');
  });

  test('stop while the image is still being prepared cancels the start', async () => {
    const startsBefore = runtime.startCalls;
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    await waitForStatus('offline');

    assert.equal(runtime.startCalls, startsBefore, 'the server was never started');
    // It starts normally afterwards: the cancel left nothing stuck behind.
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    await waitForStatus('online');
    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    await waitForStatus('offline');
  });

  test('reinstall wipes the server and resets the software but keeps the panel settings', async () => {
    // Something to lose: a world, a plugin folder and a file at the top level.
    await fs.mkdir(path.join(dataDir, 'world', 'region'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'world', 'level.dat'), 'precious');
    await fs.mkdir(path.join(dataDir, 'plugins'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'ops.json'), '[]');

    // It cannot run without the exact confirmation word.
    assert.equal((await call('POST', '/api/server/reinstall')).statusCode, 400);
    assert.equal((await call('POST', '/api/server/reinstall', { confirm: 'yes' })).statusCode, 400);
    assert.ok((await fs.readdir(dataDir)).includes('world'), 'nothing was deleted by the rejected calls');

    // It cannot run while the server is on.
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    await waitForStatus('online');
    const refused = await call('POST', '/api/server/reinstall', { confirm: 'REINSTALL' });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, 'must_be_offline');
    assert.equal(await fs.readFile(path.join(dataDir, 'world', 'level.dat'), 'utf8'), 'precious');

    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    await waitForStatus('offline');

    const memoryBefore = (await call('GET', '/api/environment')).json().memoryMb;
    assert.equal((await call('POST', '/api/server/reinstall', { confirm: 'REINSTALL' })).statusCode, 202);

    // The deletion runs in the background. Wait for it to finish.
    const deadline = Date.now() + 15_000;
    while ((await call('GET', '/api/server')).json<ServerSnapshot>().reinstalling) {
      if (Date.now() > deadline) assert.fail('Reinstall did not finish in time');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.deepEqual(await fs.readdir(dataDir), ['.maicra'], 'only the panel folder is left');
    const snapshot = (await call('GET', '/api/server')).json<ServerSnapshot>();
    assert.equal(snapshot.status, 'offline');
    assert.equal(snapshot.detail, null);
    // An earlier test moved the software to 1.21.10. A reinstall goes back to the newest Vanilla.
    assert.deepEqual(snapshot.software, { type: 'vanilla', version: '1.21.11', java: '21' });
    assert.equal(snapshot.eulaAccepted, true, 'the accepted EULA is kept');
    assert.equal((await call('GET', '/api/environment')).json().memoryMb, memoryBefore, 'RAM is kept');

    // A fresh install can be started again.
    assert.equal((await call('POST', '/api/server/start')).statusCode, 202);
    await waitForStatus('online');
    assert.equal((await call('POST', '/api/server/stop')).statusCode, 202);
    await waitForStatus('offline');
  });

  test('logout clears the session', async () => {
    const response = await call('POST', '/api/auth/logout');
    assert.equal(response.statusCode, 200);
    assert.equal(response.cookies.find((c) => c.name === 'maicra_session')?.value, '');
  });
});
