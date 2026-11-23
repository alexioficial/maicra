import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { StateStore } from './state.js';

async function withDataDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maicra-state-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const OLD_STATE = {
  eulaAccepted: true,
  software: { type: 'paper', version: '1.21.11', java: '21' },
  timezone: 'UTC',
  rconPassword: 'abcdefghijkl',
};

test('a state file written before the RAM option gets the default memory', async () => {
  await withDataDir(async (dir) => {
    await fs.mkdir(path.join(dir, '.maicra'));
    await fs.writeFile(path.join(dir, '.maicra', 'state.json'), JSON.stringify(OLD_STATE));

    const store = new StateStore(dir, { memoryMb: 3072 });
    const state = await store.load();
    assert.equal(state?.memoryMb, 3072);
    assert.equal(state?.software.type, 'paper', 'other values are untouched');
  });
});

test('a saved memory value wins over the default', async () => {
  await withDataDir(async (dir) => {
    await fs.mkdir(path.join(dir, '.maicra'));
    await fs.writeFile(path.join(dir, '.maicra', 'state.json'), JSON.stringify({ ...OLD_STATE, memoryMb: 6144 }));

    const state = await new StateStore(dir, { memoryMb: 2048 }).load();
    assert.equal(state?.memoryMb, 6144);
  });
});

test('update keeps the memory value on disk', async () => {
  await withDataDir(async (dir) => {
    const store = new StateStore(dir, { memoryMb: 2048 });
    await store.set({ ...OLD_STATE, software: { type: 'vanilla', version: '1.21.11', java: '21' }, memoryMb: 2048 });
    await store.update({ memoryMb: 8192 });

    const reloaded = await new StateStore(dir, { memoryMb: 2048 }).load();
    assert.equal(reloaded?.memoryMb, 8192);
  });
});
