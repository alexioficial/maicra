import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ApiError } from './errors.js';
import { HIDDEN_DIR } from './state.js';
import type { FileEntry, FileListing } from './types.js';

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/**
 * Deletes everything in the data folder except the panel's own hidden folder, and returns how many
 * items were removed. Used by Reinstall. Symbolic links are removed, never followed.
 */
export async function wipeServerFiles(root: string): Promise<number> {
  if (path.parse(root).root === root) throw new Error('Refusing to wipe the root of a file system');
  let removed = 0;
  for (const name of await fs.readdir(root)) {
    if (name === HIDDEN_DIR) continue;
    await fs.rm(path.join(root, name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/** File operations confined to the Minecraft data folder. */
export class FileService {
  constructor(
    private readonly root: string,
    private readonly uid: number,
    private readonly gid: number,
  ) {}

  /** Turns a user supplied path into an absolute path inside the root, or throws. */
  resolve(rel: string): string {
    if (rel.includes('\0')) throw new ApiError(400, 'invalid_path', 'Invalid path');
    const clean = path.posix.normalize('/' + rel.replace(/\\/g, '/'));
    const segments = clean.split('/').filter(Boolean);
    if (segments[0] === HIDDEN_DIR) throw new ApiError(403, 'forbidden_path', 'This path is reserved');
    return path.join(this.root, ...segments);
  }

  /** Path shown to the client: always starts with a slash, never leaks the host location. */
  toRel(abs: string): string {
    const rel = path.relative(this.root, abs).split(path.sep).join('/');
    return '/' + rel;
  }

  /** Rejects paths whose real location, after following symlinks, is outside the root. */
  private async assertInside(abs: string): Promise<void> {
    const rootReal = await fs.realpath(this.root);
    let probe = abs;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
          throw new ApiError(403, 'forbidden_path', 'Path is outside the server folder');
        }
        return;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(probe);
        if (parent === probe) return;
        probe = parent;
      }
    }
  }

  private async safe(rel: string): Promise<string> {
    const abs = this.resolve(rel);
    await this.assertInside(abs);
    return abs;
  }

  private assertName(name: string): void {
    if (name === '' || name === '.' || name === '..' || /[\\/\0]/.test(name) || name === HIDDEN_DIR) {
      throw new ApiError(400, 'invalid_name', 'Invalid file name');
    }
  }

  private async own(target: string): Promise<void> {
    if (process.platform === 'win32') return;
    try {
      await fs.chown(target, this.uid, this.gid);
    } catch {
      // Not allowed to change the owner (for example when not running as root). Leave it as is.
    }
  }

  async list(rel: string): Promise<FileListing> {
    const abs = await this.safe(rel);
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new ApiError(404, 'not_found', 'Folder not found');
      if (code === 'ENOTDIR') throw new ApiError(400, 'not_a_folder', 'Not a folder');
      throw error;
    }
    const isRoot = abs === this.root;
    const entries: FileEntry[] = [];
    for (const name of names) {
      if (isRoot && name === HIDDEN_DIR) continue;
      try {
        const stat = await fs.stat(path.join(abs, name));
        entries.push({
          name,
          type: stat.isDirectory() ? 'dir' : 'file',
          size: stat.isDirectory() ? 0 : stat.size,
          mtime: stat.mtimeMs,
        });
      } catch {
        // Broken symlink or a file that vanished while listing. Skip it.
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
    return { path: this.toRel(abs), entries };
  }

  async readText(rel: string): Promise<string> {
    const abs = await this.safe(rel);
    const stat = await this.statOrThrow(abs);
    if (stat.isDirectory()) throw new ApiError(400, 'not_a_file', 'This is a folder');
    if (stat.size > MAX_EDIT_BYTES) throw new ApiError(413, 'too_large', 'File is too large to edit (limit 2 MB)');
    const buffer = await fs.readFile(abs);
    if (buffer.subarray(0, 8192).includes(0)) throw new ApiError(415, 'binary_file', 'Binary files cannot be edited');
    return buffer.toString('utf8');
  }

  async writeText(rel: string, content: string): Promise<void> {
    const abs = await this.safe(rel);
    if (abs === this.root) throw new ApiError(400, 'invalid_path', 'Invalid path');
    let existed = true;
    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) throw new ApiError(400, 'not_a_file', 'This is a folder');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      existed = false;
    }
    await fs.writeFile(abs, content, 'utf8');
    if (!existed) await this.own(abs);
  }

  async mkdir(rel: string): Promise<void> {
    const abs = await this.safe(rel);
    if (abs === this.root) throw new ApiError(400, 'invalid_path', 'Invalid path');
    try {
      await fs.mkdir(abs);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new ApiError(409, 'exists', 'Already exists');
      if (code === 'ENOENT') throw new ApiError(404, 'not_found', 'The parent folder does not exist');
      throw error;
    }
    await this.own(abs);
  }

  /**
   * Creates a folder and any missing parent folders. Each new folder gets the owner of the Minecraft
   * process, which matters: a world folder created as root could not be written by the server.
   * Does nothing if the folder already exists.
   */
  async ensureDirs(rel: string): Promise<void> {
    const abs = await this.safe(rel);
    if (abs === this.root) return;
    let current = this.root;
    for (const part of path.relative(this.root, abs).split(path.sep)) {
      current = path.join(current, part);
      try {
        await fs.mkdir(current);
        await this.own(current);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOTDIR') throw new ApiError(400, 'not_a_folder', 'A file is in the way of that folder');
        if (code !== 'EEXIST') throw error;
      }
    }
  }

  async createFile(rel: string): Promise<void> {
    const abs = await this.safe(rel);
    try {
      await fs.writeFile(abs, '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError(409, 'exists', 'Already exists');
      throw error;
    }
    await this.own(abs);
  }

  async remove(rel: string): Promise<void> {
    const abs = await this.safe(rel);
    if (abs === this.root) throw new ApiError(400, 'invalid_path', 'The server folder itself cannot be deleted');
    await fs.rm(abs, { recursive: true, force: true });
  }

  async rename(fromRel: string, toName: string): Promise<void> {
    this.assertName(toName);
    const from = await this.safe(fromRel);
    if (from === this.root) throw new ApiError(400, 'invalid_path', 'Invalid path');
    const to = await this.safe(path.posix.join(path.posix.dirname(this.toRel(from)), toName));
    try {
      await fs.access(to);
      throw new ApiError(409, 'exists', 'A file with that name already exists');
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    await fs.rename(from, to);
  }

  async openRead(rel: string): Promise<{ stream: ReadStream; size: number; name: string }> {
    const abs = await this.safe(rel);
    const stat = await this.statOrThrow(abs);
    if (stat.isDirectory()) throw new ApiError(400, 'not_a_file', 'This is a folder');
    return { stream: createReadStream(abs), size: stat.size, name: path.basename(abs) };
  }

  async saveUpload(dirRel: string, filename: string, source: Readable): Promise<string> {
    this.assertName(filename);
    const dir = await this.safe(dirRel);
    const stat = await this.statOrThrow(dir);
    if (!stat.isDirectory()) throw new ApiError(400, 'not_a_folder', 'Upload target is not a folder');
    const target = path.join(dir, filename);
    await this.assertInside(target);
    const tmp = path.join(dir, `.${filename}.${randomBytes(4).toString('hex')}.part`);
    try {
      await pipeline(source, createWriteStream(tmp));
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true });
      throw error;
    }
    await this.own(target);
    return this.toRel(target);
  }

  /** Reads the end of a file without loading all of it. Missing files read as empty. */
  async tail(rel: string, maxBytes: number): Promise<string> {
    const abs = await this.safe(rel);
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(abs, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      let text = buffer.toString('utf8');
      if (size > maxBytes) text = text.slice(text.indexOf('\n') + 1);
      return text;
    } finally {
      await handle.close();
    }
  }

  /** Reads and parses a JSON file. Missing files give the fallback value. */
  async readJson<T>(rel: string, fallback: T): Promise<T> {
    const abs = await this.safe(rel);
    try {
      return JSON.parse(await fs.readFile(abs, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw new ApiError(500, 'invalid_json', `${path.basename(abs)} could not be read`);
    }
  }

  async writeJson(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, JSON.stringify(value, null, 2));
  }

  async readRaw(rel: string): Promise<string | null> {
    const abs = await this.safe(rel);
    try {
      return await fs.readFile(abs, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async statOrThrow(abs: string) {
    try {
      return await fs.stat(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'not_found', 'Not found');
      throw error;
    }
  }
}
