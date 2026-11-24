import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMinutes } from './format.js';

test('formatMinutes uses hours for whole hours and minutes otherwise', () => {
  assert.equal(formatMinutes(5), '5 minutes');
  assert.equal(formatMinutes(1), '1 minute');
  assert.equal(formatMinutes(60), '1 hour');
  assert.equal(formatMinutes(180), '3 hours');
  assert.equal(formatMinutes(90), '90 minutes');
});
