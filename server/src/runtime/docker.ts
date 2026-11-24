import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import Docker from 'dockerode';
import type { Config } from '../config.js';
import type { SoftwareType } from '../types.js';
import type { ContainerInfo, ExecResult, LogHandle, Runtime, RuntimeSpec } from './types.js';

/** Value of the `TYPE` variable understood by the itzg/minecraft-server image. */
const ITZG_TYPE: Record<SoftwareType, string> = {
  vanilla: 'VANILLA',
  snapshot: 'VANILLA',
  paper: 'PAPER',
  spigot: 'SPIGOT',
  purpur: 'PURPUR',
  fabric: 'FABRIC',
  quilt: 'QUILT',
  neoforge: 'NEOFORGE',
  forge: 'FORGE',
};

const MINECRAFT_PORT = '25565/tcp';

/** Server types built on Paper. Their watchdog ignores max-tick-time and is switched off with a JVM flag. */
const PAPER_BASED = new Set<SoftwareType>(['paper', 'purpur']);
/** How long the image waits for a join after a server list ping before it freezes the server again. */
const KNOCK_TIMEOUT_SECONDS = 120;
/** Written by the image right after it freezes Java, and deleted when it wakes it. */
const PAUSED_FILE = '.paused';
/** The script the image's knockd daemon runs when a connection arrives at a frozen server. */
const RESUME_SCRIPT = '/image/scripts/auto/resume.sh';

/** Environment variables of the Minecraft container. Kept to the minimum, see CLAUDE.md. */
export function containerEnv(spec: RuntimeSpec): string[] {
  const env: Record<string, string> = {
    EULA: 'TRUE',
    TYPE: ITZG_TYPE[spec.type],
    VERSION: spec.version,
    MEMORY: spec.memory,
    // Without this the image uses MEMORY for the initial heap too.
    INIT_MEMORY: spec.initMemory,
    TZ: spec.timezone,
    UID: String(spec.uid),
    GID: String(spec.gid),
    RCON_PASSWORD: spec.rconPassword,
  };
  if (spec.sleepAfterSeconds !== null) {
    // The autopause feature of the image. Once nobody has been online for the timeout it saves the
    // world and freezes Java with SIGSTOP. Its knockd daemon unfreezes Java as soon as a connection
    // reaches the Minecraft port, so a joining player gets in at once.
    env.ENABLE_AUTOPAUSE = 'TRUE';
    env.AUTOPAUSE_TIMEOUT_EST = String(spec.sleepAfterSeconds); // after the last player leaves
    env.AUTOPAUSE_TIMEOUT_INIT = String(spec.sleepAfterSeconds); // after a start that nobody joins
    env.AUTOPAUSE_TIMEOUT_KN = String(Math.min(KNOCK_TIMEOUT_SECONDS, spec.sleepAfterSeconds)); // after a ping without a join
    // After a long freeze the first tick seems to have lasted hours, and the watchdog would kill
    // the server just after it wakes. Only the newest builds of the image set this by themselves.
    // It is the one server.properties variable the panel passes, and only while sleeping is on.
    env.MAX_TICK_TIME = '-1';
    if (PAPER_BASED.has(spec.type)) env.JVM_DD_OPTS = 'disable.watchdog:true';
  }
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function statusCode(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

/** Splits a byte stream into lines and calls `onLine` for each complete one. */
function lineWriter(onLine: (line: string) => void): Writable {
  let pending = '';
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      pending += chunk.toString('utf8');
      let index = pending.indexOf('\n');
      while (index !== -1) {
        onLine(pending.slice(0, index).replace(/\r$/, ''));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
      }
      callback();
    },
    final(callback) {
      if (pending !== '') onLine(pending);
      callback();
    },
  });
}

export class DockerRuntime implements Runtime {
  readonly kind = 'docker' as const;
  private readonly docker = new Docker();
  private dataMount: string | null = null;

  constructor(private readonly config: Config) {}

  private container(): Docker.Container {
    return this.docker.getContainer(this.config.mcContainerName);
  }

  private imageName(spec: RuntimeSpec): string {
    return `${this.config.mcImage}:java${spec.java}`;
  }

  /** The Docker volume or host path that holds the Minecraft data. */
  private async resolveDataMount(): Promise<string> {
    if (this.config.mcDataMount) return this.config.mcDataMount;
    if (this.dataMount) return this.dataMount;

    const candidates = [os.hostname()];
    try {
      const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8');
      const match = /\/containers\/([0-9a-f]{64})\//.exec(mountinfo);
      if (match) candidates.push(match[1]!);
    } catch {
      // Not running on Linux or not in a container.
    }

    for (const candidate of candidates) {
      try {
        const info = await this.docker.getContainer(candidate).inspect();
        const mount = info.Mounts.find((m) => path.posix.normalize(m.Destination) === path.posix.normalize(this.config.dataDir));
        if (mount) {
          this.dataMount = mount.Type === 'volume' && mount.Name ? mount.Name : mount.Source;
          return this.dataMount;
        }
      } catch (error) {
        if (statusCode(error) !== 404) throw error;
      }
    }
    throw new Error(
      `Cannot find which Docker volume is mounted at ${this.config.dataDir}. ` +
        'Set MC_DATA_MOUNT to a volume name or host path.',
    );
  }

  async specHash(spec: RuntimeSpec): Promise<string> {
    const payload = {
      image: this.imageName(spec),
      env: containerEnv(spec),
      mount: await this.resolveDataMount(),
      port: spec.port,
      network: this.config.mcNetwork,
    };
    return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Creates the network the Minecraft container joins, unless it already exists.
   *
   * The container is not left on Docker's default "bridge" network on purpose. There it gets a
   * copy of the host's /etc/resolv.conf, and on some hosts those name servers do not answer from
   * inside a container (seen on a VPS: the image failed with "Failed to resolve 'fill.papermc.io'"
   * while the panel, on a user defined network, resolved it fine). A user defined network uses
   * Docker's embedded DNS server instead, which is what Docker Compose and Coolify use as well.
   */
  private async ensureNetwork(): Promise<void> {
    const name = this.config.mcNetwork;
    if (name === 'bridge' || name === 'host' || name === 'none') return; // Built in, always present.
    try {
      await this.docker.getNetwork(name).inspect();
      return;
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
    try {
      await this.docker.createNetwork({ Name: name, Driver: 'bridge', Labels: { 'maicra.managed': 'true' } });
    } catch (error) {
      // 409 means another call created it in the meantime, which is fine.
      if (statusCode(error) !== 409) throw error;
    }
  }

  async inspect(): Promise<ContainerInfo> {
    try {
      const info = await this.container().inspect();
      const parsedStart = Date.parse(info.State.StartedAt);
      const startedAt = Number.isNaN(parsedStart) || parsedStart < 0 ? null : parsedStart;
      return {
        exists: true,
        running: info.State.Running,
        restarting: info.State.Restarting,
        startedAt,
        health: (info.State.Health?.Status as ContainerInfo['health'] | undefined) ?? 'none',
        specHash: info.Config.Labels?.['maicra.spec'] ?? null,
        sleeping: info.State.Running && startedAt !== null && (await this.pausedSince(startedAt)),
      };
    } catch (error) {
      if (statusCode(error) === 404) {
        return { exists: false, running: false, restarting: false, startedAt: null, health: 'none', specHash: null, sleeping: false };
      }
      throw error;
    }
  }

  /**
   * Docker cannot tell that Java is frozen, but the image leaves a marker file in the shared data
   * folder while it is. A marker older than the current run was left behind by a container that
   * was stopped while frozen, and is ignored.
   */
  private async pausedSince(startedAt: number): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(this.config.dataDir, PAUSED_FILE));
      return stat.mtimeMs >= startedAt;
    } catch {
      return false;
    }
  }

  async wake(): Promise<void> {
    const result = await this.exec([RESUME_SCRIPT]);
    if (result.exitCode !== 0) throw new Error(result.output.trim() || `The resume script failed with code ${result.exitCode}`);
  }

  async ensureImage(spec: RuntimeSpec, onProgress: (text: string) => void): Promise<void> {
    const image = this.imageName(spec);
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }

    onProgress(`Downloading ${image}`);
    const stream = await this.docker.pull(image);
    const layers = new Map<string, { current: number; total: number }>();
    let lastPercent = -1;
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (error: Error | null) => (error ? reject(error) : resolve()),
        (event: { id?: string; status?: string; progressDetail?: { current?: number; total?: number } }) => {
          if (event.id && event.status === 'Downloading' && event.progressDetail?.total) {
            layers.set(event.id, { current: event.progressDetail.current ?? 0, total: event.progressDetail.total });
          } else if (event.id && event.status === 'Download complete') {
            const layer = layers.get(event.id);
            if (layer) layer.current = layer.total;
          }
          let current = 0;
          let total = 0;
          for (const layer of layers.values()) {
            current += layer.current;
            total += layer.total;
          }
          const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress(`Downloading ${image} ${percent}%`);
          }
        },
      );
    });
  }

  async recreate(spec: RuntimeSpec): Promise<void> {
    const existing = await this.inspect();
    if (existing.exists) await this.container().remove({ force: true, v: false });

    const mount = await this.resolveDataMount();
    await this.ensureNetwork();
    await this.docker.createContainer({
      name: this.config.mcContainerName,
      Image: this.imageName(spec),
      Env: containerEnv(spec),
      Labels: { 'maicra.managed': 'true', 'maicra.spec': await this.specHash(spec) },
      ExposedPorts: { [MINECRAFT_PORT]: {} },
      StopTimeout: 120,
      HostConfig: {
        Binds: [`${mount}:/data`],
        NetworkMode: this.config.mcNetwork,
        PortBindings: { [MINECRAFT_PORT]: [{ HostPort: String(spec.port) }] },
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });
  }

  async remove(): Promise<void> {
    try {
      await this.container().remove({ force: true, v: false });
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
  }

  async start(): Promise<void> {
    try {
      await this.container().start();
    } catch (error) {
      if (statusCode(error) !== 304) throw error;
    }
  }

  async stop(timeoutSeconds: number): Promise<void> {
    try {
      await this.container().stop({ t: timeoutSeconds });
    } catch (error) {
      const code = statusCode(error);
      if (code !== 304 && code !== 404) throw error;
    }
  }

  async followLogs(
    options: { sinceMs: number | null; tail: number },
    onLine: (timestamp: number, text: string) => void,
    onEnd: () => void,
  ): Promise<LogHandle> {
    const stream = (await this.container().logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      ...(options.sinceMs !== null ? { since: Math.floor(options.sinceMs / 1000) } : { tail: options.tail }),
    })) as unknown as NodeJS.ReadableStream & { destroy(): void };

    const handleLine = (line: string) => {
      const space = line.indexOf(' ');
      const parsed = space > 0 ? Date.parse(line.slice(0, space)) : Number.NaN;
      if (Number.isNaN(parsed)) onLine(Date.now(), line);
      else onLine(parsed, line.slice(space + 1));
    };
    const out = lineWriter(handleLine);
    const err = lineWriter(handleLine);
    this.docker.modem.demuxStream(stream, out, err);

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      onEnd();
    };
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);

    return {
      stop: () => {
        ended = true;
        stream.destroy();
      },
    };
  }

  async exec(command: string[]): Promise<ExecResult> {
    const exec = await this.container().exec({ Cmd: command, AttachStdout: true, AttachStderr: true, Tty: false });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    this.docker.modem.demuxStream(stream, sink, sink);
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('close', resolve);
      stream.on('error', reject);
    });
    const result = await exec.inspect();
    return { exitCode: result.ExitCode ?? 0, output: Buffer.concat(chunks).toString('utf8') };
  }

  async hostMemoryMb(): Promise<number | null> {
    try {
      const info = (await this.docker.info()) as { MemTotal?: number };
      return info.MemTotal ? Math.floor(info.MemTotal / (1024 * 1024)) : null;
    } catch {
      return null;
    }
  }

  async stats(): Promise<{ memoryBytes: number } | null> {
    try {
      const stats = await this.container().stats({ stream: false });
      const memory = stats.memory_stats;
      const cache = memory.stats?.inactive_file ?? memory.stats?.cache ?? 0;
      return { memoryBytes: Math.max(0, (memory.usage ?? 0) - cache) };
    } catch {
      return null;
    }
  }
}
