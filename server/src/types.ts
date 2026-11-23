// API types shared with the web app. The web app imports them with `import type`,
// so nothing in this file may be needed at runtime by the browser.

export const SOFTWARE_TYPES = [
  'vanilla',
  'snapshot',
  'paper',
  'spigot',
  'purpur',
  'fabric',
  'quilt',
  'neoforge',
  'forge',
] as const;
export type SoftwareType = (typeof SOFTWARE_TYPES)[number];

export const JAVA_VERSIONS = ['8', '11', '17', '21', '25'] as const;
export type JavaVersion = (typeof JAVA_VERSIONS)[number];

export const PLAYER_LISTS = ['whitelist', 'ops', 'banned-players', 'banned-ips'] as const;
export type PlayerListName = (typeof PLAYER_LISTS)[number];

export type ServerStatus = 'offline' | 'starting' | 'online' | 'stopping';

export interface SoftwareInfo {
  type: SoftwareType;
  version: string;
  java: JavaVersion;
}

export interface PlayersInfo {
  online: number;
  max: number;
  names: string[];
}

export interface RamInfo {
  usedMb: number;
  limitMb: number;
}

export interface ServerSnapshot {
  status: ServerStatus;
  /** Short human readable progress or error text, for example "Pulling image 63%". */
  detail: string | null;
  address: string;
  software: SoftwareInfo;
  eulaAccepted: boolean;
  /** Epoch milliseconds when the current run started, or null while offline. */
  startedAt: number | null;
  players: PlayersInfo | null;
  ram: RamInfo | null;
  /** True while a reinstall is deleting files. Nothing else can run until it finishes. */
  reinstalling: boolean;
  runtime: 'docker' | 'fake';
}

export interface LogLine {
  ts: number;
  text: string;
  kind: 'out' | 'cmd' | 'sys';
}

export type WsMessage =
  | { type: 'status'; data: ServerSnapshot }
  | { type: 'history'; lines: LogLine[] }
  | { type: 'log'; line: LogLine };

export interface SoftwareCatalogEntry {
  id: SoftwareType;
  label: string;
  badge: 'plugins' | 'mods' | null;
  description: string;
  website: string;
}

export interface SoftwareResponse {
  current: SoftwareInfo;
  catalog: SoftwareCatalogEntry[];
}

export interface EnvironmentResponse {
  java: JavaVersion;
  javaVersions: JavaVersion[];
  timezone: string;
  timezones: string[];
  /** Maximum Java heap in megabytes. */
  memoryMb: number;
  /** Sizes offered in the picker, in megabytes, smallest first. */
  memoryOptionsMb: number[];
  /** Total memory of the machine in megabytes, or null if unknown. */
  hostMemoryMb: number | null;
  /** Above this the panel warns that the system may run short of memory. */
  recommendedMemoryMb: number;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
}

export interface FileListing {
  path: string;
  entries: FileEntry[];
}

export interface PlayerEntry {
  /** Stable identifier used to remove the entry: uuid for players, ip for banned IPs. */
  id: string;
  name: string;
  detail?: string;
}

export interface PropertiesResponse {
  exists: boolean;
  properties: Record<string, string>;
}

export interface AuthMe {
  email: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
