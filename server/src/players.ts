import { createHash } from 'node:crypto';
import net from 'node:net';
import { ApiError } from './errors.js';
import type { FileService } from './files.js';
import type { ServerManager } from './manager.js';
import { parseProperties } from './properties.js';
import type { PlayerEntry, PlayerListName } from './types.js';

const FILES: Record<PlayerListName, string> = {
  whitelist: '/whitelist.json',
  ops: '/ops.json',
  'banned-players': '/banned-players.json',
  'banned-ips': '/banned-ips.json',
};

const NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

interface RawEntry {
  uuid?: string;
  name?: string;
  ip?: string;
  level?: number;
  reason?: string;
}

/** Offline mode servers derive the uuid from the name instead of asking Mojang. */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return dashUuid(hash.toString('hex'));
}

function dashUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Date format used inside the ban lists, for example "2026-11-22 10:00:00 +0000". */
function minecraftDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

/**
 * Reads and edits the whitelist, operators and ban lists. While the server is online the changes go
 * through console commands, because the server owns those files then. While offline the files are edited directly.
 */
export class PlayersService {
  constructor(
    private readonly files: FileService,
    private readonly manager: ServerManager,
  ) {}

  async list(list: PlayerListName): Promise<PlayerEntry[]> {
    const raw = await this.files.readJson<RawEntry[]>(FILES[list], []);
    return raw.map((entry) => {
      if (list === 'banned-ips') return { id: entry.ip ?? '', name: entry.ip ?? '', detail: entry.reason };
      return {
        id: entry.uuid ?? entry.name ?? '',
        name: entry.name ?? '',
        detail: list === 'ops' && entry.level !== undefined ? `Level ${entry.level}` : entry.reason,
      };
    });
  }

  async add(list: PlayerListName, value: string): Promise<string> {
    const target = this.validate(list, value);
    this.requireIdle();

    if (this.manager.isOnline()) {
      const command = { whitelist: 'whitelist add', ops: 'op', 'banned-players': 'ban', 'banned-ips': 'ban-ip' }[list];
      return this.manager.runSilent(`${command} ${target}`);
    }

    const entries = await this.files.readJson<RawEntry[]>(FILES[list], []);
    if (list === 'banned-ips') {
      if (!entries.some((entry) => entry.ip === target)) {
        entries.push({ ip: target, created: minecraftDate(), source: 'Maicra', expires: 'forever', reason: 'Banned by an operator.' } as RawEntry);
      }
    } else {
      const uuid = await this.lookupUuid(target);
      if (!entries.some((entry) => entry.uuid === uuid)) {
        if (list === 'whitelist') entries.push({ uuid, name: target });
        else if (list === 'ops') entries.push({ uuid, name: target, level: 4, bypassesPlayerLimit: false } as RawEntry);
        else {
          entries.push({ uuid, name: target, created: minecraftDate(), source: 'Maicra', expires: 'forever', reason: 'Banned by an operator.' } as RawEntry);
        }
      }
    }
    await this.files.writeJson(FILES[list], entries);
    return '';
  }

  async remove(list: PlayerListName, id: string): Promise<string> {
    this.requireIdle();
    const entries = await this.files.readJson<RawEntry[]>(FILES[list], []);
    const match = entries.find((entry) => (list === 'banned-ips' ? entry.ip === id : entry.uuid === id || entry.name === id));
    if (!match) throw new ApiError(404, 'not_found', 'That entry no longer exists');

    if (this.manager.isOnline()) {
      const command = { whitelist: 'whitelist remove', ops: 'deop', 'banned-players': 'pardon', 'banned-ips': 'pardon-ip' }[list];
      const target = list === 'banned-ips' ? match.ip : match.name;
      return this.manager.runSilent(`${command} ${target}`);
    }

    await this.files.writeJson(FILES[list], entries.filter((entry) => entry !== match));
    return '';
  }

  private requireIdle(): void {
    if (!this.manager.isOnline() && !this.manager.isOffline()) {
      throw new ApiError(409, 'busy', 'Wait until the server has finished starting or stopping');
    }
  }

  /** Validates the input, which also keeps it safe to put into a console command. */
  private validate(list: PlayerListName, value: string): string {
    const trimmed = value.trim();
    if (list === 'banned-ips') {
      if (net.isIP(trimmed) === 0) throw new ApiError(400, 'invalid_ip', 'Enter a valid IP address');
      return trimmed;
    }
    if (!NAME_PATTERN.test(trimmed)) {
      throw new ApiError(400, 'invalid_name', 'Player names use letters, numbers and underscores, up to 16 characters');
    }
    return trimmed;
  }

  private async lookupUuid(name: string): Promise<string> {
    const properties = parseProperties((await this.files.readRaw('/server.properties')) ?? '');
    if (properties['online-mode'] === 'false') return offlineUuid(name);

    try {
      const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(6000),
        headers: { 'user-agent': 'maicra-panel/0.1' },
      });
      if (response.status === 404 || response.status === 204) {
        throw new ApiError(404, 'player_not_found', `No Minecraft account is called ${name}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { id: string };
      return dashUuid(data.id);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'lookup_failed', 'Could not look up that player. Start the server and try again.');
    }
  }
}
