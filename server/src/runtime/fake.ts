import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContainerInfo, ExecResult, LogHandle, Runtime, RuntimeSpec } from './types.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One minute of the sleep timeout lasts this long here, so the feature can be tried and tested
 * without waiting. The shortest option, 5 minutes, puts the fake server to sleep after 5 seconds.
 */
const SLEEP_MS_PER_MINUTE = 1000;
/** Same as in the real image: after a wake without a join, the server sleeps again after 2 minutes. */
const KNOCK_TIMEOUT_SECONDS = 120;

const BOOT_LINES = [
  'Starting minecraft server version %VERSION%',
  'Loading properties',
  'Default game type: SURVIVAL',
  'Generating keypair',
  'Starting Minecraft server on *:25565',
  'Preparing level "world"',
  'Preparing start region for dimension minecraft:overworld',
  'Preparing spawn area: 0%',
  'Preparing spawn area: 45%',
  'Preparing spawn area: 100%',
];

const DEFAULT_PROPERTIES = [
  '#Minecraft server properties',
  'difficulty=easy',
  'gamemode=survival',
  'max-players=20',
  'motd=A Minecraft Server',
  'online-mode=true',
  'pvp=true',
  'white-list=false',
  'allow-flight=false',
  'spawn-protection=16',
  'view-distance=10',
  '',
].join('\n');

/**
 * A stand-in for the Minecraft container, used to develop the interface without Docker.
 * It writes a few files into the data folder so the Files, Options and Log pages have content.
 */
export class FakeRuntime implements Runtime {
  readonly kind = 'fake' as const;

  private exists = false;
  private running = false;
  private startedAt: number | null = null;
  private hash: string | null = null;
  private lines: { ts: number; text: string }[] = [];
  private listeners = new Set<(ts: number, text: string) => void>();
  private endListeners = new Set<() => void>();
  private version = '';
  private runId = 0;
  private ready = false;
  private sleepAfterSeconds: number | null = null;
  private paused = false;
  private sleepTimer: NodeJS.Timeout | undefined;

  /** For tests: how many times the server was started. */
  startCalls = 0;
  /** For tests: whether a stop reached the server before it finished loading, which a real image would ignore. */
  stoppedWhileLoading = false;
  /** For tests: whether a stop reached a frozen server, which could not shut down cleanly. */
  stoppedWhileSleeping = false;

  constructor(private readonly dataDir: string) {}

  async inspect(): Promise<ContainerInfo> {
    return {
      exists: this.exists,
      running: this.running,
      restarting: false,
      startedAt: this.startedAt,
      health: this.running ? (this.ready ? 'healthy' : 'starting') : 'none',
      specHash: this.hash,
      sleeping: this.running && this.paused,
    };
  }

  async specHash(spec: RuntimeSpec): Promise<string> {
    return JSON.stringify([spec.type, spec.version, spec.java, spec.memory, spec.initMemory, spec.timezone, spec.port, spec.sleepAfterSeconds]);
  }

  async ensureImage(_spec: RuntimeSpec, onProgress: (text: string) => void): Promise<void> {
    for (const percent of [10, 55, 100]) {
      onProgress(`Downloading image ${percent}%`);
      await sleep(250);
    }
  }

  async recreate(spec: RuntimeSpec): Promise<void> {
    this.exists = true;
    this.running = false;
    this.version = spec.version;
    this.sleepAfterSeconds = spec.sleepAfterSeconds;
    this.hash = await this.specHash(spec);
  }

  async remove(): Promise<void> {
    this.exists = false;
    this.running = false;
    this.ready = false;
    this.clearSleep();
    this.startedAt = null;
    this.hash = null;
    this.lines = [];
    this.runId++;
  }

  private emit(text: string): void {
    const line = { ts: Date.now(), text };
    this.lines.push(line);
    if (this.lines.length > 2000) this.lines.shift();
    for (const listener of this.listeners) listener(line.ts, line.text);
    void this.appendLogFile(line);
  }

  private async appendLogFile(line: { ts: number; text: string }): Promise<void> {
    try {
      await fs.mkdir(path.join(this.dataDir, 'logs'), { recursive: true });
      await fs.appendFile(path.join(this.dataDir, 'logs', 'latest.log'), `${line.text}\n`);
    } catch {
      // Logging to disk is best effort in the fake runtime.
    }
  }

  private stamp(level = 'INFO', thread = 'Server thread'): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}] [${thread}/${level}]:`;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.ready = false;
    this.startCalls++;
    this.startedAt = Date.now();
    this.lines = [];
    const run = ++this.runId;
    await this.seedFiles();
    await fs.rm(path.join(this.dataDir, 'logs', 'latest.log'), { force: true });

    void (async () => {
      for (const template of BOOT_LINES) {
        await sleep(450);
        if (!this.running || run !== this.runId) return;
        this.emit(`${this.stamp()} ${template.replace('%VERSION%', this.version)}`);
      }
      await sleep(500);
      if (!this.running || run !== this.runId) return;
      this.emit(`${this.stamp()} Done (3.214s)! For help, type "help"`);
      this.ready = true;
      if (this.sleepAfterSeconds !== null) {
        this.emit(`[Autopause loop] MC Server listening for connections - pausing in ${this.sleepAfterSeconds} seconds`);
        this.scheduleSleep(this.sleepAfterSeconds);
      }
    })();
  }

  /** Nobody ever joins the fake server, so it always falls asleep once the timeout passes. */
  private scheduleSleep(seconds: number): void {
    clearTimeout(this.sleepTimer);
    const run = this.runId;
    this.sleepTimer = setTimeout(() => {
      if (run === this.runId && this.running) void this.sleepNow();
    }, (seconds / 60) * SLEEP_MS_PER_MINUTE);
  }

  /** Freezes the server like the image does. Also a test hook to skip the wait. */
  async sleepNow(): Promise<void> {
    if (!this.running || this.paused) return;
    clearTimeout(this.sleepTimer);
    this.emit('[Autopause loop] No client connected since startup / knocked - pausing');
    this.emit(`[${new Date().toISOString()}] [Autopause] Pausing Java process`);
    this.paused = true;
    await fs.writeFile(path.join(this.dataDir, '.paused'), '');
  }

  async wake(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    await fs.rm(path.join(this.dataDir, '.paused'), { force: true });
    if (this.sleepAfterSeconds === null) return;
    this.emit('[Autopause loop] Server was knocked - waiting for clients or timeout');
    this.scheduleSleep(Math.min(KNOCK_TIMEOUT_SECONDS, this.sleepAfterSeconds));
  }

  private clearSleep(): void {
    clearTimeout(this.sleepTimer);
    this.paused = false;
  }

  private async seedFiles(): Promise<void> {
    await fs.mkdir(path.join(this.dataDir, 'plugins'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'world'), { recursive: true });
    const properties = path.join(this.dataDir, 'server.properties');
    try {
      await fs.access(properties);
    } catch {
      await fs.writeFile(properties, DEFAULT_PROPERTIES);
    }
    await fs.writeFile(path.join(this.dataDir, 'eula.txt'), 'eula=true\n');
  }

  async stop(_timeoutSeconds: number): Promise<void> {
    if (!this.running) return;
    if (!this.ready) this.stoppedWhileLoading = true;
    if (this.paused) this.stoppedWhileSleeping = true;
    this.clearSleep();
    this.emit(`${this.stamp()} Stopping the server`);
    await sleep(600);
    this.emit(`${this.stamp()} Saving worlds`);
    await sleep(900);
    this.running = false;
    this.ready = false;
    this.runId++;
    for (const listener of this.endListeners) listener();
  }

  async followLogs(
    options: { sinceMs: number | null; tail: number },
    onLine: (timestamp: number, text: string) => void,
    onEnd: () => void,
  ): Promise<LogHandle> {
    for (const line of this.lines.slice(-options.tail)) onLine(line.ts, line.text);
    this.listeners.add(onLine);
    this.endListeners.add(onEnd);
    return {
      stop: () => {
        this.listeners.delete(onLine);
        this.endListeners.delete(onEnd);
      },
    };
  }

  async exec(command: string[]): Promise<ExecResult> {
    if (!this.running) return { exitCode: 1, output: 'Server is not running' };
    // The image wakes a frozen server when it sees an rcon client waiting, a few seconds later.
    if (this.paused) await this.wake();
    const input = command.slice(1).join(' ').trim();
    const [name = '', ...rest] = input.split(/\s+/);
    switch (name) {
      case 'list':
        return { exitCode: 0, output: 'There are 0 of a max of 20 players online: ' };
      case 'say':
        this.emit(`${this.stamp()} [Rcon] ${rest.join(' ')}`);
        return { exitCode: 0, output: '' };
      case 'whitelist':
      case 'op':
      case 'deop':
      case 'ban':
      case 'pardon':
      case 'ban-ip':
      case 'pardon-ip':
        return { exitCode: 0, output: `Simulated: ${input}` };
      case '':
        return { exitCode: 0, output: '' };
      default:
        return { exitCode: 0, output: 'Unknown or incomplete command, see below for error' };
    }
  }

  async hostMemoryMb(): Promise<number | null> {
    return 16384;
  }

  async stats(): Promise<{ memoryBytes: number } | null> {
    if (!this.running) return null;
    const base = 900 * 1024 * 1024;
    return { memoryBytes: base + Math.floor(Math.random() * 120) * 1024 * 1024 };
  }
}
