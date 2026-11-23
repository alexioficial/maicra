import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeProperty, encodeProperty, parseMotd, readJsonText, writeJsonText } from './mc.js';

test('decodeProperty resolves unicode escapes, newlines and escaped punctuation', () => {
  assert.equal(decodeProperty('\\u00A7aHello'), '§aHello');
  assert.equal(decodeProperty('Line one\\nLine two'), 'Line one\nLine two');
  assert.equal(decodeProperty('https\\://example.com/pack.zip'), 'https://example.com/pack.zip');
  assert.equal(decodeProperty('a\\\\b'), 'a\\b');
  assert.equal(decodeProperty('trailing\\'), 'trailing\\');
});

test('encodeProperty produces ASCII that decodes back to the same text', () => {
  const samples = ['§aWelcome §lback', 'Line one\nLine two', 'café ñ', 'back\\slash', 'emoji 😀', ' leading space', 'a=b:c'];
  for (const sample of samples) {
    const encoded = encodeProperty(sample);
    assert.match(encoded, /^[\x20-\x7e]*$/, `ASCII only: ${encoded}`);
    assert.equal(decodeProperty(encoded), sample);
  }
});

test('encodeProperty writes the section sign as \\u00A7', () => {
  assert.equal(encodeProperty('§a'), '\\u00A7a');
});

test('parseMotd styles text and splits lines', () => {
  const lines = parseMotd('§aGreen §lbold\n§cRed');
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines[0]!.map((span) => [span.text, span.color, span.bold]),
    [
      ['Green ', '#55ff55', false],
      ['bold', '#55ff55', true],
    ],
  );
  assert.equal(lines[1]![0]!.color, '#ff5555');
});

test('parseMotd resets effects on a color code and on reset', () => {
  const [line] = parseMotd('§lBold§cRed§rPlain');
  assert.equal(line![1]!.bold, false, 'a color clears bold');
  assert.equal(line![2]!.color, null, 'reset clears the color');
});

test('parseMotd accepts ampersand codes and ignores unknown ones', () => {
  const [line] = parseMotd('&bAqua §zskipped');
  assert.equal(line![0]!.color, '#55ffff');
  assert.equal(line!.map((span) => span.text).join(''), 'Aqua skipped');
});

test('json text round trips and tolerates plain values', () => {
  assert.equal(readJsonText(writeJsonText('Please accept §bthe pack')), 'Please accept §bthe pack');
  assert.equal(writeJsonText(''), '""');
  assert.equal(readJsonText('""'), '');
  assert.equal(readJsonText('{"text":"hi"}'), 'hi');
  assert.equal(readJsonText('just text'), 'just text');
});
