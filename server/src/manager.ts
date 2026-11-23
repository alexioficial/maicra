import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import type { Config } from './config.js';
import { ApiError } from './errors.js';
import { wipeServerFiles } from './files.js';
import { computeLimits, describeMemory, MEMORY_STEP_MB, toMemoryArg, type MemoryLimits } from './memory.js';
import type { ContainerInfo, LogHandle, Runtime, RuntimeSpec } from './runtime/types.js';
import { newRconPassword, type StateStore } from './state.js';
import {
  JAVA_VERSIONS,
  type JavaVersion,
  type LogLine,
  type PlayersInfo,
  type RamInfo,
  type ServerSnapshot,
  type ServerStatus,
  type SoftwareInfo,
  type SoftwareType,
} from './types.js';
import type { VersionService } from './versions.js';

const STOP_TIMEOUT_SECONDS = 120;
/** How long a stop waits for a server that is still loading before it gives up and forces the stop. */
const START_WAIT_MS = 5 * 60 * 1000;
const FORCE_STOP_SECONDS = 15;
const POLL_MS = 500;
const TICK_MS = 1500;
const PLAYERS_MS = 5000;
const STATS_MS = 3000;
const LOG_BUFFER_SIZE = 1000;

const DONE_PATTERN = /\bDone \(\d+(?:[.,]\d+)?s\)!/;
// ANSI escape sequences and Minecraft formatting codes.
const CONTROL_CODES = /\u001b\[[0-9;]*[A-Za-z]|§[0-9a-fk-or]/gi;
const LIST_PATTERN = /There are (\d+)(?: of a max of |\/)(\d+) players online:?\s*([\s\S]*)/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Thrown inside the start sequence when the user pressed Stop before the server was running. */
class LaunchCancelled extends Error {}

export function stripCodes(text: string): string {
  return text.replace(CONTROL_CODES, '');
}

/** Turns "[12:00:00] [Server thread/INFO]: Preparing spawn area: 45%" into "Preparing spawn area: 45%". */
export function logMessage(text: string): string {
  return stripCodes(text).replace(/^\[[^\]]*\]\s*\[[^\]]*\]:\s*/, '').trim();
}

export function parsePlayerList(output: string): PlayersInfo | null {
  const match = LIST_PATTERN.exec(stripCodes(output));
  if (!match) return null;
  const names = (match[3] ?? '')
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return { online: Number(match[1]), max: Number(match[2]), names };
}

type Transition = 'preparing' | 'stopping' | null;

export interface ServerManager {
  on(event: 'status', listener: (snapshot: ServerSnapshot) => void): this;
  on(event: 'log', listener: (line: LogLine) => void): this;
  /** Fired when the console history is replaced, for example when a new run starts. */
  on(event: 'history', listener: (lines: LogLine[]) => void): this;
  off(event: 'status', listener: (snapshot: ServerSnapshot) => void): this;
  off(event: 'log', listener: (line: LogLine) => void): this;
  off(event: 'history', listener: (lines: LogLine[]) => void): this;
}

/**
 * Owns the lifecycle of the one Minecraft server. It turns what the runtime reports into a
 * simple status, follows the logs, and publishes changes to anyone listening.
 */
export class ServerManager extends EventEmitter {
  private status: ServerStatus = 'offline';
  private transition: Transition = null;
  private progress: string | null = null;
  private lastError: string | null = null;
  private runStartedAt: number | null = null;
  private online = false;
  private players: PlayersInfo | null = null;
  private ram: RamInfo | null = null;
  private lastLogDetail: string | null = null;
  private logs: LogLine[] = [];
  private follower: LogHandle | null = null;
  private ticking = false;
  private lastPublished = '';
  private timers: NodeJS.Timeout[] = [];
  private limits: MemoryLimits | null = null;
  private reinstalling = false;
  /** Set when Stop is pressed before the container exists or has started. */
  private cancelLaunch = false;
  /** True while a stop waits for Minecraft to finish loading. */
  private waitingForStart = false;

  constructor(
    private readonly config: Config,
    private readonly runtime: Runtime,
    private readonly store: StateStore,
    private readonly versions: VersionService,
  ) {
    super();
  }

  async init(): Promise<void> {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    if (!(await this.store.load())) {
      await this.store.set({
        eulaAccepted: false,
        software: await this.defaultSoftware(),
        timezone: this.config.timezone,
        rconPassword: newRconPassword(),
        memoryMb: this.config.mcMemoryMb,
      });
    }
    await this.tick();
    this.timers.push(
      setInterval(() => void this.tick(), TICK_MS),
      setInterval(() => void this.pollPlayers(), PLAYERS_MS),
      setInterval(() => void this.pollStats(), STATS_MS),
    );
  }

  /** Vanilla at the newest release, which is what a fresh install starts with. */
  private async defaultSoftware(): Promise<SoftwareInfo> {
    let version = 'LATEST';
    let java: JavaVersion = '25';
    try {
      version = await this.versions.latestRelease();
      java = await this.versions.javaFor('vanilla', version);
    } catch {
      // No internet right now. The server will resolve LATEST by itself when it starts.
    }
    return { type: 'vanilla', version, java };
  }

  shutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.follower?.stop();
    this.follower = null;
  }

  // ---- reading state ------------------------------------------------------

  snapshot(): ServerSnapshot {
    const state = this.store.get();
    return {
      status: this.status,
      detail: this.detail(),
      address: this.address(),
      software: state.software,
      eulaAccepted: state.eulaAccepted,
      startedAt: this.runStartedAt,
      players: this.status === 'online' ? this.players : null,
      ram: this.runStartedAt !== null ? this.ram : null,
      reinstalling: this.reinstalling,
      runtime: this.runtime.kind,
    };
  }

  history(): LogLine[] {
    return [...this.logs];
  }

  async environment(): Promise<{ java: JavaVersion; timezone: string; memoryMb: number; limits: MemoryLimits }> {
    const state = this.store.get();
    return { java: state.software.java, timezone: state.timezone, memoryMb: state.memoryMb, limits: await this.memoryLimits() };
  }

  /** How much memory the server may be given on this machine. The machine's size does not change, so it is read once. */
  async memoryLimits(): Promise<MemoryLimits> {
    if (!this.limits) {
      const hostMb = await this.runtime.hostMemoryMb().catch(() => null);
      this.limits = computeLimits(hostMb);
    }
    return this.limits;
  }

  isOnline(): boolean {
    return this.status === 'online';
  }

  /** True while the data folder may be changed safely by the panel. */
  isOffline(): boolean {
    return this.status === 'offline' && this.transition === null && !this.reinstalling;
  }

  private address(): string {
    const host = this.config.mcPublicAddress ?? 'localhost';
    if (host.includes(':') || this.config.mcPort === 25565) return host;
    return `${host}:${this.config.mcPort}`;
  }

  private detail(): string | null {
    switch (this.status) {
      case 'offline':
        return this.reinstalling ? 'Deleting all files and resetting the software' : this.lastError;
      case 'starting':
        return this.progress ?? this.lastLogDetail;
      case 'stopping':
        if (this.cancelLaunch) return 'Cancelling the start';
        if (this.waitingForStart) return 'Waiting for the server to finish loading, then stopping it safely';
        return 'Saving and shutting down';
      case 'online':
        return null;
    }
  }

  private spec(): RuntimeSpec {
    const state = this.store.get();
    return {
      type: state.software.type,
      version: state.software.version,
      java: state.software.java,
      memory: toMemoryArg(state.memoryMb),
      timezone: state.timezone,
      rconPassword: state.rconPassword,
      port: this.config.mcPort,
      uid: this.config.mcUid,
      gid: this.config.mcGid,
    };
  }

  // ---- publishing ---------------------------------------------------------

  private publish(): void {
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastPublished) return;
    this.lastPublished = serialized;
    this.emit('status', snapshot);
  }

  private pushLog(kind: LogLine['kind'], text: string, ts = Date.now()): void {
    const line: LogLine = { ts, text, kind };
    this.logs.push(line);
    if (this.logs.length > LOG_BUFFER_SIZE) this.logs.shift();
    this.emit('log', line);
  }

  private setProgress(text: string): void {
    this.progress = text;
    this.publish();
  }

  // ---- watching the container --------------------------------------------

  /** Compares the real container with what we expect and updates the status. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const info = await this.runtime.inspect();
      const running = info.exists && (info.running || info.restarting);

      if (running) {
        if (info.startedAt !== this.runStartedAt) {
          this.runStartedAt = info.startedAt;
          this.online = false;
          this.players = null;
          this.ram = null;
          this.lastLogDetail = null;
          this.logs = [];
          this.emit('history', []);
          await this.attachLogs(info.startedAt);
        }
      } else if (this.runStartedAt !== null) {
        this.runStartedAt = null;
        this.online = false;
        this.players = null;
        this.ram = null;
        this.lastLogDetail = null;
        this.detachLogs();
      }

      if (this.transition === 'stopping') this.status = 'stopping';
      else if (running && !info.restarting && (this.online || info.health === 'healthy')) this.status = 'online';
      else if (running || this.transition === 'preparing') this.status = 'starting';
      else this.status = 'offline';

      if (this.status === 'online') this.lastError = null;
    } catch (error) {
      this.lastError = `Cannot reach the container runtime: ${(error as Error).message}`;
    } finally {
      this.ticking = false;
      this.publish();
    }
  }

  private async attachLogs(startedAt: number | null): Promise<void> {
    this.detachLogs();
    try {
      this.follower = await this.runtime.followLogs(
        { sinceMs: startedAt, tail: 500 },
        (ts, text) => this.onContainerLine(ts, text),
        () => {
          this.follower = null;
        },
      );
    } catch (error) {
      this.pushLog('sys', `Could not read the server log: ${(error as Error).message}`);
    }
  }

  private detachLogs(): void {
    this.follower?.stop();
    this.follower = null;
  }

  private onContainerLine(ts: number, rawText: string): void {
    const text = stripCodes(rawText);
    this.pushLog('out', text, ts);
    this.lastLogDetail = logMessage(text).slice(0, 90) || this.lastLogDetail;
    if (!this.online && DONE_PATTERN.test(text)) {
      this.online = true;
      void this.tick();
    } else if (this.status === 'starting') {
      this.publish();
    }
  }

  private async pollPlayers(): Promise<void> {
    if (this.status !== 'online') return;
    try {
      const result = await this.runtime.exec(['rcon-cli', 'list']);
      const parsed = result.exitCode === 0 ? parsePlayerList(result.output) : null;
      if (parsed) {
        this.players = parsed;
        this.publish();
      }
    } catch {
      // The next poll will try again.
    }
  }

  private async pollStats(): Promise<void> {
    if (this.runStartedAt === null) return;
    try {
      const stats = await this.runtime.stats();
      if (!stats) return;
      this.ram = { usedMb: Math.round(stats.memoryBytes / (1024 * 1024)), limitMb: this.store.get().memoryMb };
      this.publish();
    } catch {
      // Statistics are optional.
    }
  }

  // ---- actions ------------------------------------------------------------

  async start(): Promise<void> {
    if (!this.store.get().eulaAccepted) {
      throw new ApiError(409, 'eula', 'The Minecraft EULA must be accepted before the first start');
    }
    if (this.status !== 'offline' || this.transition !== null || this.reinstalling) {
      throw new ApiError(409, 'busy', 'The server is already running or changing state');
    }
    this.lastError = null;
    this.transition = 'preparing';
    this.progress = 'Preparing';
    this.status = 'starting';
    this.publish();
    void this.launch();
  }

  async stop(): Promise<void> {
    if (this.transition === 'stopping') return;
    if (this.status === 'offline' && this.transition === null) return;

    // Still downloading the image or creating the container. Nothing is running yet, so the
    // start is cancelled at its next checkpoint instead of stopping anything.
    if (this.transition === 'preparing') {
      this.cancelLaunch = true;
      this.transition = 'stopping';
      this.status = 'stopping';
      this.publish();
      return;
    }

    this.transition = 'stopping';
    this.status = 'stopping';
    this.publish();
    void (async () => {
      try {
        await this.stopGracefully();
      } catch (error) {
        this.lastError = `Failed to stop: ${(error as Error).message}`;
        this.pushLog('sys', this.lastError);
      } finally {
        this.transition = null;
        await this.tick();
      }
    })();
  }

  /**
   * Stops the server without losing data. While Minecraft is still loading, the image is not ready
   * to handle a stop: it ignores the signal and Docker kills the server once the timeout runs out.
   * So this waits until the server is up, and then stops it the normal way.
   */
  private async stopGracefully(): Promise<void> {
    const deadline = Date.now() + START_WAIT_MS;
    let info = await this.runtime.inspect();
    if (info.running && !this.isReady(info)) {
      this.waitingForStart = true;
      this.publish();
      try {
        while (info.running && !this.isReady(info) && Date.now() < deadline) {
          await sleep(POLL_MS);
          info = await this.runtime.inspect();
        }
      } finally {
        this.waitingForStart = false;
      }
    }
    if (!info.running && !info.restarting) return; // It ended by itself while we waited.
    // If it never finished loading, it is stuck. Give it a short moment, then Docker ends it.
    await this.runtime.stop(this.isReady(info) ? STOP_TIMEOUT_SECONDS : FORCE_STOP_SECONDS);
  }

  private isReady(info: ContainerInfo): boolean {
    return this.online || info.health === 'healthy';
  }

  async restart(): Promise<void> {
    if (this.transition !== null || (this.status !== 'online' && this.status !== 'starting')) {
      throw new ApiError(409, 'busy', 'The server is not running');
    }
    this.transition = 'stopping';
    this.status = 'stopping';
    this.publish();
    void (async () => {
      try {
        await this.stopGracefully();
      } catch (error) {
        this.lastError = `Failed to stop: ${(error as Error).message}`;
        this.pushLog('sys', this.lastError);
        this.transition = null;
        await this.tick();
        return;
      }
      this.lastError = null;
      this.transition = 'preparing';
      this.progress = 'Restarting';
      this.status = 'starting';
      this.publish();
      await this.launch();
    })();
  }

  /** Builds whatever is missing and starts the container. Always clears the transition when done. */
  private async launch(): Promise<void> {
    try {
      const spec = this.spec();
      await this.runtime.ensureImage(spec, (text) => this.setProgress(text));
      this.throwIfCancelled();
      this.setProgress('Creating the server');
      const info = await this.runtime.inspect();
      if (!info.exists || info.specHash !== (await this.runtime.specHash(spec))) {
        await this.runtime.recreate(spec);
      }
      this.throwIfCancelled();
      this.setProgress('Starting the server');
      await this.runtime.start();
      // Stop was pressed while the container was being started. It is running now, so stop it properly.
      if (this.cancelLaunch) await this.stopGracefully();
    } catch (error) {
      if (error instanceof LaunchCancelled) {
        this.pushLog('sys', 'Start cancelled');
      } else {
        this.lastError = `Failed to start: ${(error as Error).message}`;
        this.pushLog('sys', this.lastError);
      }
    } finally {
      this.cancelLaunch = false;
      this.transition = null;
      this.progress = null;
      await this.tick();
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelLaunch) throw new LaunchCancelled();
  }

  /**
   * Starts over: removes the container, deletes every file of the server and goes back to the
   * newest Vanilla. The panel login, the accepted EULA, the RAM and the timezone are kept.
   * The deletion runs in the background because a big world can take a while.
   */
  async reinstall(): Promise<void> {
    if (this.reinstalling) throw new ApiError(409, 'busy', 'A reinstall is already running');
    this.requireOffline();
    this.reinstalling = true;
    this.lastError = null;
    this.publish();
    void this.runReinstall();
  }

  private async runReinstall(): Promise<void> {
    try {
      await this.runtime.remove();
      await wipeServerFiles(this.config.dataDir);
      await this.store.update({ software: await this.defaultSoftware(), rconPassword: newRconPassword() });
      this.logs = [];
      this.emit('history', []);
    } catch (error) {
      this.lastError = `Reinstall failed: ${(error as Error).message}`;
      this.pushLog('sys', this.lastError);
    } finally {
      this.reinstalling = false;
      await this.tick();
    }
  }

  async acceptEula(): Promise<void> {
    await this.store.update({ eulaAccepted: true });
    this.publish();
  }

  async setSoftware(type: SoftwareType, version: string): Promise<void> {
    this.requireOffline();
    const available = await this.versions.list(type);
    if (!available.includes(version)) {
      throw new ApiError(400, 'invalid_version', `${version} is not available for this software`);
    }
    const java = await this.versions.javaFor(type, version);
    await this.store.update({ software: { type, version, java } });
    this.lastError = null;
    this.publish();
  }

  async setEnvironment(patch: { java?: JavaVersion; timezone?: string; memoryMb?: number }): Promise<void> {
    this.requireOffline();
    const state = this.store.get();
    if (patch.memoryMb !== undefined) {
      const limits = await this.memoryLimits();
      if (!Number.isInteger(patch.memoryMb) || patch.memoryMb % MEMORY_STEP_MB !== 0 || patch.memoryMb < limits.minMb) {
        throw new ApiError(400, 'invalid_memory', `RAM must be at least ${describeMemory(limits.minMb)}, in steps of ${MEMORY_STEP_MB} MB`);
      }
      if (patch.memoryMb > limits.maxMb) {
        const machine = limits.hostMb === null ? '' : `This machine has ${describeMemory(limits.hostMb)} in total. `;
        throw new ApiError(400, 'invalid_memory', `${machine}The most you can give the server is ${describeMemory(limits.maxMb)}, so the system keeps some memory.`);
      }
    }
    if (patch.java !== undefined && !JAVA_VERSIONS.includes(patch.java)) {
      throw new ApiError(400, 'invalid_java', 'Unsupported Java version');
    }
    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
      } catch {
        throw new ApiError(400, 'invalid_timezone', 'Unknown timezone');
      }
    }
    await this.store.update({
      software: { ...state.software, java: patch.java ?? state.software.java },
      timezone: patch.timezone ?? state.timezone,
      memoryMb: patch.memoryMb ?? state.memoryMb,
    });
    this.publish();
  }

  async command(text: string): Promise<string> {
    if (this.status !== 'online') {
      throw new ApiError(409, 'not_online', 'The server must be online to run commands');
    }
    if (/[\r\n]/.test(text)) throw new ApiError(400, 'invalid_command', 'A command must be a single line');
    const command = text.trim().replace(/^\//, '');
    if (command === '') return '';

    this.pushLog('cmd', `> ${command}`);
    const result = await this.runtime.exec(['rcon-cli', command]);
    const output = stripCodes(result.output).trim();
    for (const line of output === '' ? [] : output.split('\n')) this.pushLog('out', line);
    return output;
  }

  /** Runs a console command without echoing it, for features such as the player lists. */
  async runSilent(command: string): Promise<string> {
    if (this.status !== 'online') throw new ApiError(409, 'not_online', 'The server must be online');
    const result = await this.runtime.exec(['rcon-cli', command]);
    return stripCodes(result.output).trim();
  }

  private requireOffline(): void {
    if (!this.isOffline()) {
      throw new ApiError(409, 'must_be_offline', 'Stop the server before changing this setting');
    }
  }
}
