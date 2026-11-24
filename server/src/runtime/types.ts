import type { JavaVersion, SoftwareType } from '../types.js';

/** Everything that decides how the Minecraft container is built. A change means the container must be recreated. */
export interface RuntimeSpec {
  type: SoftwareType;
  version: string;
  java: JavaVersion;
  /** Maximum heap, the MEMORY variable of the image. */
  memory: string;
  /** Initial heap, the INIT_MEMORY variable of the image. */
  initMemory: string;
  timezone: string;
  rconPassword: string;
  port: number;
  uid: number;
  gid: number;
  /** Freeze the server after this many seconds without players, or null to keep it running. */
  sleepAfterSeconds: number | null;
}

export interface ContainerInfo {
  exists: boolean;
  running: boolean;
  /** Docker is restarting the container after it exited. */
  restarting: boolean;
  /** Epoch milliseconds of the current run, or null when it never started. */
  startedAt: number | null;
  health: 'none' | 'starting' | 'healthy' | 'unhealthy';
  specHash: string | null;
  /** The server process is frozen because nobody was online. Only true while running. */
  sleeping: boolean;
}

export interface LogHandle {
  stop(): void;
}

export interface ExecResult {
  exitCode: number;
  output: string;
}

/** Controls the single Minecraft server process or container. */
export interface Runtime {
  readonly kind: 'docker' | 'fake';
  inspect(): Promise<ContainerInfo>;
  specHash(spec: RuntimeSpec): Promise<string>;
  /** Makes sure everything needed to create the container is available locally. */
  ensureImage(spec: RuntimeSpec, onProgress: (text: string) => void): Promise<void>;
  /** Replaces any existing container with a new stopped one built from the spec. Data is kept. */
  recreate(spec: RuntimeSpec): Promise<void>;
  /** Deletes the container if there is one. The data folder is not touched. */
  remove(): Promise<void>;
  start(): Promise<void>;
  /** Stops gracefully and resolves once the server has exited. */
  stop(timeoutSeconds: number): Promise<void>;
  followLogs(
    options: { sinceMs: number | null; tail: number },
    onLine: (timestamp: number, text: string) => void,
    onEnd: () => void,
  ): Promise<LogHandle>;
  exec(command: string[]): Promise<ExecResult>;
  /** Unfreezes a sleeping server right away. Does nothing when it is not sleeping. */
  wake(): Promise<void>;
  stats(): Promise<{ memoryBytes: number } | null>;
  /** Total memory of the machine the server runs on, in megabytes, or null if it cannot be read. */
  hostMemoryMb(): Promise<number | null>;
}
