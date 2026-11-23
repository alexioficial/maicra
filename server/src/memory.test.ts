import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeLimits, describeMemory, memoryOptions, toMemoryArg } from './memory.js';

test('limits leave memory for the system and recommend three quarters', () => {
  // A 16 GB machine.
  const limits = computeLimits(16384);
  assert.equal(limits.maxMb, 15360);
  assert.equal(limits.recommendedMb, 12288);
  assert.equal(limits.minMb, 1024);
});

test('limits for a small machine never go below the minimum', () => {
  assert.equal(computeLimits(1536).maxMb, 1024);
  assert.equal(computeLimits(1536).recommendedMb, 1024);
  assert.equal(computeLimits(4096).maxMb, 3072);
});

test('limits for an unknown machine are generous and never warn', () => {
  const limits = computeLimits(null);
  assert.equal(limits.hostMb, null);
  assert.equal(limits.recommendedMb, limits.maxMb);
});

test('options stay inside the limits and are sorted', () => {
  const options = memoryOptions(computeLimits(8192), 2048);
  assert.equal(options[0], 1024);
  // 8 GB machine: 1 GB stays free for the system, so 7 GB is the most that is offered.
  assert.equal(options.at(-1), 7168);
  assert.deepEqual(options, [...options].sort((a, b) => a - b));
  assert.ok(options.includes(4096));
  assert.ok(!options.includes(8192), 'the whole machine is never offered');
});

test('options always include the current value, even if it is odd', () => {
  const options = memoryOptions(computeLimits(8192), 2560);
  assert.ok(options.includes(2560));
  assert.equal(new Set(options).size, options.length, 'no duplicates');
});

test('memory argument uses G for whole gigabytes and M otherwise', () => {
  assert.equal(toMemoryArg(4096), '4G');
  assert.equal(toMemoryArg(1536), '1536M');
  assert.equal(toMemoryArg(1024), '1G');
});

test('describeMemory is readable', () => {
  assert.equal(describeMemory(4096), '4 GB');
  assert.equal(describeMemory(1536), '1.5 GB');
  assert.equal(describeMemory(512), '512 MB');
});
