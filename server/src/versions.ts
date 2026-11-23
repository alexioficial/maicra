import { ApiError } from './errors.js';
import { JAVA_VERSIONS, type JavaVersion, type SoftwareType } from './types.js';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_URL = 'https://fill.papermc.io/v3/projects/paper';
const PURPUR_URL = 'https://api.purpurmc.org/v2/purpur';
const FABRIC_URL = 'https://meta.fabricmc.net/v2/versions/game';

const SHORT_TTL = 15 * 60 * 1000;
const FOREVER = Number.POSITIVE_INFINITY;

interface Manifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string }[];
}

/** Compares dotted version ids such as "1.21.4" and "26.3". Non numeric parts count as zero. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Keeps versions from the newest down to and including `oldest`. Input is newest first. */
function downTo(releases: string[], oldest: string): string[] {
  return releases.filter((id) => compareVersions(id, oldest) >= 0);
}

export class VersionService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'maicra-panel/0.1', accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      throw new ApiError(502, 'versions_unavailable', `Could not load version list: ${(error as Error).message}`);
    }
  }

  private manifest(): Promise<Manifest> {
    return this.cached('manifest', SHORT_TTL, () => this.fetchJson<Manifest>(MANIFEST_URL));
  }

  async latestRelease(): Promise<string> {
    return (await this.manifest()).latest.release;
  }

  /** Version ids available for a software type, newest first. */
  async list(type: SoftwareType): Promise<string[]> {
    const manifest = await this.manifest();
    const releases = manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);

    switch (type) {
      case 'vanilla':
        return releases;
      case 'snapshot':
        return manifest.versions.filter((v) => v.type === 'snapshot').slice(0, 40).map((v) => v.id);
      case 'paper': {
        const supported = await this.cached('paper', SHORT_TTL, async () => {
          const data = await this.fetchJson<{ versions: Record<string, string[]> }>(PAPER_URL);
          return new Set(Object.values(data.versions).flat());
        });
        return releases.filter((id) => supported.has(id));
      }
      case 'purpur': {
        const supported = await this.cached('purpur', SHORT_TTL, async () => {
          const data = await this.fetchJson<{ versions: string[] }>(PURPUR_URL);
          return new Set(data.versions);
        });
        return releases.filter((id) => supported.has(id));
      }
      case 'fabric': {
        const supported = await this.cached('fabric', SHORT_TTL, async () => {
          const data = await this.fetchJson<{ version: string; stable: boolean }[]>(FABRIC_URL);
          return new Set(data.filter((v) => v.stable).map((v) => v.version));
        });
        return releases.filter((id) => supported.has(id));
      }
      case 'quilt':
        return downTo(releases, '1.18.2');
      case 'neoforge':
        return downTo(releases, '1.20.2');
      case 'spigot':
        return downTo(releases, '1.8');
      case 'forge':
        return downTo(releases, '1.7.10');
    }
  }

  /** The smallest supported Java version that can run the given Minecraft version. */
  async javaFor(type: SoftwareType, version: string): Promise<JavaVersion> {
    // Forge before 1.18 only runs on Java 8, even though Mojang's own requirement is newer.
    if (type === 'forge' && compareVersions(version, '1.18') < 0) return '8';

    const manifest = await this.manifest();
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) return '25';

    const major = await this.cached(`java:${version}`, FOREVER, async () => {
      const data = await this.fetchJson<{ javaVersion?: { majorVersion?: number } }>(entry.url);
      return data.javaVersion?.majorVersion ?? 8;
    });
    return JAVA_VERSIONS.find((java) => Number(java) >= major) ?? '25';
  }
}
