import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containerEnv } from './docker.js';
import type { RuntimeSpec } from './types.js';

const SPEC: RuntimeSpec = {
  type: 'paper',
  version: '1.21.1',
  java: '21',
  memory: '6144M',
  initMemory: '6144M',
  timezone: 'UTC',
  rconPassword: 'test-rcon-password',
  port: 25565,
  uid: 1000,
  gid: 1000,
  sleepAfterSeconds: null,
};

function envMap(spec: RuntimeSpec): Map<string, string> {
  return new Map(
    containerEnv(spec).map((entry) => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );
}

test('without sleeping the container gets no autopause or server.properties variables', () => {
  const env = envMap(SPEC);
  assert.equal(env.has('ENABLE_AUTOPAUSE'), false);
  assert.equal(env.has('MAX_TICK_TIME'), false);
  assert.equal(env.has('JVM_DD_OPTS'), false);
  assert.equal(env.get('TYPE'), 'PAPER');
});

test('sleeping turns on autopause with the chosen wait and switches off the watchdogs', () => {
  const env = envMap({ ...SPEC, sleepAfterSeconds: 900 });
  assert.equal(env.get('ENABLE_AUTOPAUSE'), 'TRUE');
  assert.equal(env.get('AUTOPAUSE_TIMEOUT_EST'), '900');
  assert.equal(env.get('AUTOPAUSE_TIMEOUT_INIT'), '900');
  assert.equal(env.get('AUTOPAUSE_TIMEOUT_KN'), '120');
  // Without these the watchdog kills the server right after it wakes from a long sleep.
  assert.equal(env.get('MAX_TICK_TIME'), '-1');
  assert.equal(env.get('JVM_DD_OPTS'), 'disable.watchdog:true');
});

test('only Paper based servers get the Paper watchdog flag', () => {
  assert.equal(envMap({ ...SPEC, type: 'purpur', sleepAfterSeconds: 900 }).get('JVM_DD_OPTS'), 'disable.watchdog:true');
  assert.equal(envMap({ ...SPEC, type: 'vanilla', sleepAfterSeconds: 900 }).has('JVM_DD_OPTS'), false);
  assert.equal(envMap({ ...SPEC, type: 'fabric', sleepAfterSeconds: 900 }).has('JVM_DD_OPTS'), false);
});

test('the wait after a ping is never longer than the main wait', () => {
  assert.equal(envMap({ ...SPEC, sleepAfterSeconds: 60 }).get('AUTOPAUSE_TIMEOUT_KN'), '60');
});
