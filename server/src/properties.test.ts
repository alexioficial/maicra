import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyProperties, parseProperties } from './properties.js';

test('parseProperties reads keys and ignores comments and blanks', () => {
  const text = '#Minecraft server properties\n#Sat Nov 21\n\nmax-players=20\nmotd=A server=cool\nwhite-list=false\n';
  assert.deepEqual(parseProperties(text), {
    'max-players': '20',
    motd: 'A server=cool',
    'white-list': 'false',
  });
});

test('parseProperties handles windows line endings', () => {
  assert.deepEqual(parseProperties('a=1\r\nb=2\r\n'), { a: '1', b: '2' });
});

test('applyProperties updates in place and keeps comments and order', () => {
  const text = '# header\nmax-players=20\n\ngamemode=survival\n';
  const result = applyProperties(text, { 'max-players': '50' });
  assert.equal(result, '# header\nmax-players=50\n\ngamemode=survival\n');
});

test('applyProperties appends unknown keys', () => {
  const result = applyProperties('a=1\n', { b: '2' });
  assert.equal(result, 'a=1\nb=2\n');
});

test('applyProperties creates content from nothing', () => {
  assert.equal(applyProperties('', { pvp: 'true' }), 'pvp=true\n');
});

test('applyProperties preserves empty values and equals signs', () => {
  const result = applyProperties('resource-pack=\n', { motd: 'a=b', 'resource-pack': '' });
  assert.equal(result, 'resource-pack=\nmotd=a=b\n');
});

test('applyProperties keeps windows line endings', () => {
  assert.equal(applyProperties('a=1\r\n', { a: '2' }), 'a=2\r\n');
});

test('applyProperties rejects bad keys and multi-line values', () => {
  assert.throws(() => applyProperties('', { 'bad key': '1' }));
  assert.throws(() => applyProperties('', { good: 'x\ny' }));
});
