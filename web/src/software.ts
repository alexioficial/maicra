import type { SoftwareType } from '@api/types';

/** Software that loads mods from the mods folder. */
const MOD_LOADERS: readonly SoftwareType[] = ['fabric', 'quilt', 'neoforge', 'forge'];

export function isModLoader(type: SoftwareType): boolean {
  return MOD_LOADERS.includes(type);
}

/** Software that loads plugins from the plugins folder. */
const PLUGIN_SERVERS: readonly SoftwareType[] = ['paper', 'spigot', 'purpur'];

export function isPluginServer(type: SoftwareType): boolean {
  return PLUGIN_SERVERS.includes(type);
}

const NAMES: Record<SoftwareType, string> = {
  vanilla: 'Vanilla',
  snapshot: 'Snapshot',
  paper: 'Paper',
  spigot: 'Spigot',
  purpur: 'Purpur',
  fabric: 'Fabric',
  quilt: 'Quilt',
  neoforge: 'NeoForge',
  forge: 'Forge',
};

export function softwareName(type: SoftwareType): string {
  return NAMES[type];
}
