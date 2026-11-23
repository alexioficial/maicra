/**
 * Minimal reader and writer for Minecraft `server.properties` files.
 * Updates keep comments, blank lines, key order and keys the panel does not know about.
 */

const KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function splitLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trimStart();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;
  const index = trimmed.indexOf('=');
  if (index === -1) return null;
  return { key: trimmed.slice(0, index).trim(), value: trimmed.slice(index + 1) };
}

export function parseProperties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const entry = splitLine(line);
    if (entry && entry.key !== '') result[entry.key] = entry.value;
  }
  return result;
}

export function applyProperties(text: string, updates: Record<string, string>): string {
  for (const [key, value] of Object.entries(updates)) {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid property key: ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`Property ${key} must not contain line breaks`);
  }

  const pending = new Map(Object.entries(updates));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  // A trailing newline produces an empty last element. Drop it and add it back at the end.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const output = lines.map((line) => {
    const entry = splitLine(line);
    if (!entry || !pending.has(entry.key)) return line;
    const value = pending.get(entry.key)!;
    pending.delete(entry.key);
    return `${entry.key}=${value}`;
  });

  for (const [key, value] of pending) output.push(`${key}=${value}`);
  return output.join(eol) + eol;
}
