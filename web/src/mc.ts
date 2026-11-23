// Helpers for Minecraft text: formatting codes (the section sign followed by a letter or digit)
// and the escaping rules of `server.properties`, which is a Java properties file.

export const MC_COLORS = [
  { code: '0', name: 'Black', hex: '#000000' },
  { code: '1', name: 'Dark blue', hex: '#0000aa' },
  { code: '2', name: 'Dark green', hex: '#00aa00' },
  { code: '3', name: 'Dark aqua', hex: '#00aaaa' },
  { code: '4', name: 'Dark red', hex: '#aa0000' },
  { code: '5', name: 'Dark purple', hex: '#aa00aa' },
  { code: '6', name: 'Gold', hex: '#ffaa00' },
  { code: '7', name: 'Gray', hex: '#aaaaaa' },
  { code: '8', name: 'Dark gray', hex: '#555555' },
  { code: '9', name: 'Blue', hex: '#5555ff' },
  { code: 'a', name: 'Green', hex: '#55ff55' },
  { code: 'b', name: 'Aqua', hex: '#55ffff' },
  { code: 'c', name: 'Red', hex: '#ff5555' },
  { code: 'd', name: 'Light purple', hex: '#ff55ff' },
  { code: 'e', name: 'Yellow', hex: '#ffff55' },
  { code: 'f', name: 'White', hex: '#ffffff' },
] as const;

export const MC_FORMATS = [
  { code: 'l', name: 'Bold' },
  { code: 'o', name: 'Italic' },
  { code: 'n', name: 'Underline' },
  { code: 'm', name: 'Strikethrough' },
  { code: 'k', name: 'Obfuscated' },
  { code: 'r', name: 'Reset' },
] as const;

export interface MotdSpan {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  obfuscated: boolean;
}

const SECTION = '§';

/** Lets people type "&a" instead of the hard to type section sign. */
export function ampersandToSection(text: string): string {
  return text.replace(/&([0-9a-fk-or])/gi, `${SECTION}$1`);
}

type Style = Omit<MotdSpan, 'text'>;
const PLAIN: Style = { color: null, bold: false, italic: false, underline: false, strike: false, obfuscated: false };

/** Splits text with formatting codes into lines of styled spans. */
export function parseMotd(input: string): MotdSpan[][] {
  const text = ampersandToSection(input);
  const lines: MotdSpan[][] = [[]];
  let style: Style = PLAIN;
  let buffer = '';

  const flush = () => {
    if (buffer !== '') lines[lines.length - 1]!.push({ text: buffer, ...style });
    buffer = '';
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === SECTION && i + 1 < text.length) {
      const code = text.charAt(i + 1).toLowerCase();
      i++;
      flush();
      const color = MC_COLORS.find((c) => c.code === code);
      // A color code also clears any bold, italic and other effects, as in the game.
      if (color) style = { ...PLAIN, color: color.hex };
      else if (code === 'l') style = { ...style, bold: true };
      else if (code === 'o') style = { ...style, italic: true };
      else if (code === 'n') style = { ...style, underline: true };
      else if (code === 'm') style = { ...style, strike: true };
      else if (code === 'k') style = { ...style, obfuscated: true };
      else if (code === 'r') style = PLAIN;
      continue;
    }
    if (char === '\n') {
      flush();
      lines.push([]);
      continue;
    }
    buffer += char;
  }
  flush();
  return lines;
}

/** Reads a value from a properties file: resolves \uXXXX, \n and other backslash escapes. */
export function decodeProperty(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_match, group: string) => {
    if (group.length === 5) return String.fromCharCode(Number.parseInt(group.slice(1), 16));
    switch (group) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'f':
        return '\f';
      default:
        return group;
    }
  });
}

/** Writes a value the way Java reads it. Everything outside plain ASCII becomes \uXXXX, so any Minecraft version can load it. */
export function encodeProperty(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '\\') out += '\\\\';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20 || code > 0x7e) {
      for (let i = 0; i < char.length; i++) out += `\\u${char.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()}`;
    } else out += char;
  }
  return out.replace(/^ /, '\\ ');
}

/** Text components such as the resource pack prompt are stored as JSON. This reads a plain JSON string back as text. */
export function readJsonText(stored: string): string {
  const decoded = decodeProperty(stored);
  if (decoded === '') return '';
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && 'text' in parsed && typeof (parsed as { text: unknown }).text === 'string') {
      return (parsed as { text: string }).text;
    }
  } catch {
    // Not JSON. Treat it as plain text.
  }
  return decoded;
}

export function writeJsonText(text: string): string {
  return encodeProperty(JSON.stringify(text));
}
