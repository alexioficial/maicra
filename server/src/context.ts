import type { Auth } from './auth.js';
import type { Config } from './config.js';
import type { FileService } from './files.js';
import type { ServerManager } from './manager.js';
import type { PlayersService } from './players.js';
import type { VersionService } from './versions.js';

/** Everything the route handlers need, created once at startup. */
export interface AppContext {
  config: Config;
  auth: Auth;
  manager: ServerManager;
  files: FileService;
  versions: VersionService;
  players: PlayersService;
}
