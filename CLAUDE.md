# Maicra: project guide for Claude

Read this first in any new conversation. It explains what the project is, how it is built, how to work on it safely, and the things that were learned the hard way. `README.md` is the shorter, user facing description.

## 1. What this is

Maicra is a self-hosted control panel for **one Minecraft: Java Edition server**, with an interface modelled on the Aternos panel. The owner runs it on their own VPS through Coolify and signs in with a single email and password.

Who the user is and what they want:

- A Spanish speaker. **Reply to them in Spanish.** The panel's interface, the code, the comments and the docs are in English.
- They had Minecraft servers on the VPS before but with no interface. They find the Aternos panel the most comfortable one and refuse to install an existing third party panel (Pterodactyl, Crafty and similar). So this is built from scratch.
- At the start they wanted an exact Aternos replica. Later they relaxed that: design details are left to Claude, guided by the screenshots in `ref/aternos/`.
- **Once the server is started it must never stop on its own**, not even when nobody is playing. There is no queue, no idle countdown, no ads and no promo bars.
- Scope decisions: Java only, exactly one server, one user whose login comes from environment variables, English interface. Skipped on purpose for now: Worlds, Access (sharing with other users), Backups, the mobile layout, the Domains button and public mod or plugin search.

### Status (2026-11-23)

Done and working against real Docker (the user ran Paper 1.21.1 with 6 GB of RAM and joined as a player):

- Start, stop, restart, live status, players, RAM and uptime, EULA modal on the first start
- Live console with commands, latest log with download
- Software and version picker for Vanilla, Snapshot, Paper, Spigot, Purpur, Fabric, Quilt, NeoForge and Forge, with the Java version chosen automatically
- Options page (17 `server.properties` fields, MOTD editor with colors, server icon upload, timezone, Java version, maximum RAM) and a Reinstall button
- Players (whitelist, operators, bans), Files (full file manager)
- Mods, Plugins and Datapacks pages (a folder with upload, download and delete)
- Dockerfile, `docker-compose.yml` for Coolify, `docker-compose.local.yml` for local testing

Not done yet:

- Mobile layout, Backups, Worlds and Access.

Deployment (2026-11-23): the code is in the public GitHub repository `alexioficial/maicra` (branch `main`) and the panel runs on the user's Coolify at `https://mc.widube.com` (section 9). Do not commit or push unless the user asks: every push to `main` triggers an automatic redeploy of the panel. The Minecraft server itself has not been started on the VPS yet, because the user does the first start and accepts the EULA.

## 2. Rules for working with this user

1. **Never accept the Minecraft EULA or start the real Minecraft server on the user's behalf.** The harness blocked this once and the user wants to test the whole flow themselves. Limit your own checks to build, container health, `/api/health` and logs.
2. **Never touch the user's real Minecraft container or data.** Locally that is the container `maicra-minecraft` and the volume `maicra_minecraft-data`. They hold the user's worlds. Stop, Start and Reinstall are the user's actions.
3. To check the interface, use a **throwaway instance** instead of the user's panel: run the dev server with `RUNTIME=fake` on another port (see section 8), then stop it and delete its data. Never click Reinstall or any destructive button in the user's own panel.
4. When the user says "restart the container so the changes apply", rebuild **only the panel** with `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`. Minecraft runs in a separate container and keeps running. Afterwards tell the user to hard refresh the browser (Ctrl+F5): an open tab keeps the old JavaScript bundle and will not show new features.
5. Verify before reporting: `npm run typecheck`, both test suites, `npm run build`, and a look at the result in a browser when the change is visual. State plainly what was not verified.
6. Text that is saved (code, comments, docs, commit messages) is written in complete plain English. Chat replies can be short.
7. `.env` and `backups/` are git ignored on purpose. Files in `backups/` may contain the real RCON password.
8. Do not use real personal data (the user's email and so on) in files or in requests to outside services. The development login is the fake `admin@example.com`.

## 3. Stack and repository layout

TypeScript everywhere, npm workspaces (`server` and `web`), Node 22 or newer (Node 24 is used locally). Main libraries: Fastify 5, zod 4, dockerode 5 (it ships no types, `@types/dockerode` is used), React 19, react-router 8, Vite 8, lucide-react, TypeScript 7. Tests use the built in `node:test` runner through `tsx`.

```
maicra/
├─ CLAUDE.md, README.md
├─ Dockerfile                 two stage build, runs as root on purpose (docker socket, chown)
├─ docker-compose.yml         what Coolify deploys: only the panel service + the data volume
├─ docker-compose.local.yml   adds "3000:3000" for trying the panel on a PC
├─ .env / .env.example        development settings (RUNTIME=fake) / documented template
├─ ref/aternos/               14 screenshots of the real Aternos panel, design reference (git ignored: the repository is public)
├─ backups/                   local copies of files taken for inspection (git ignored)
├─ server/                    the API and the Docker control
│  └─ src/
│     ├─ index.ts             entry point: load config, start, graceful shutdown
│     ├─ app.ts               builds the Fastify app: plugins, auth hook, origin check, static files
│     ├─ config.ts            environment variables, validated with zod
│     ├─ manager.ts           ServerManager: the status machine and every action
│     ├─ runtime/             types.ts (interface), docker.ts (real), fake.ts (development)
│     ├─ state.ts             StateStore: panel settings in /data/.maicra/state.json
│     ├─ files.ts             FileService (confined file access) and wipeServerFiles
│     ├─ players.ts           whitelist, operators and bans
│     ├─ properties.ts        read and update server.properties keeping comments
│     ├─ versions.ts          version lists and required Java version
│     ├─ memory.ts            RAM limits and options
│     ├─ auth.ts, errors.ts, context.ts, types.ts
│     ├─ routes/              auth, server, options, files, players
│     └─ *.test.ts            app (integration), memory, properties, state
└─ web/                       the React interface
   └─ src/
      ├─ main.tsx, App.tsx    providers and routes
      ├─ api.ts               fetch wrapper, ApiError, XHR upload with progress
      ├─ hooks.ts, format.ts, mc.ts, software.ts
      ├─ state/               Auth.tsx, Server.tsx (WebSocket), Toast.tsx
      ├─ components/          Layout.tsx, ui.tsx, Terminal.tsx, Motd.tsx
      ├─ pages/               Server, Options, Console, Log, Players, Software, Files, Addons, Login
      ├─ styles.css           design tokens and all styles (no CSS framework)
      └─ mc.test.ts
```

The web app imports API types from the server with `import type ... from '@api/types'`. That alias points at `server/src/*` in `web/tsconfig.json`. The imports are type only, so nothing from the server reaches the browser. Keep `server/src/types.ts` free of runtime dependencies.

## 4. Architecture

```
Browser ──HTTPS──> Maicra panel (Fastify + React) ──/var/run/docker.sock──> itzg/minecraft-server container
                          │                                                          │
                          └────────────── shared volume mounted at /data ────────────┘
```

- The panel is one container. It creates and controls a **separate** Minecraft container from the `itzg/minecraft-server` image through the Docker API. Redeploying or restarting the panel does not stop Minecraft. The user accepted the security cost of mounting `docker.sock`.
- The image tag is `${MC_IMAGE}:java${java}`, for example `itzg/minecraft-server:java21`. Container name defaults to `maicra-minecraft`, restart policy is `unless-stopped`, `StopTimeout` is 120 seconds, Docker logs rotate at 10 MB.
- The Minecraft container joins the network `MC_NETWORK` (default `maicra`), a user defined bridge that the panel creates when missing. **Do not put it back on Docker's default `bridge` network.** On the user's VPS the default bridge could not resolve names: the image looped on `[init] [ERROR] Failed to download paper` with `Failed to resolve 'fill.papermc.io'`, while the panel on Coolify's network resolved fine. User defined networks use Docker's embedded DNS server.
- Both containers mount the same data volume at `/data`. The panel finds the real volume name by inspecting **its own container** and reading the mount whose destination is `DATA_DIR`. Coolify prefixes volume names, so never hard code the name. `MC_DATA_MOUNT` overrides this.
- Panel settings live in `/data/.maicra/state.json` (software, Java version, timezone, RAM, EULA flag, a pinned RCON password). The `.maicra` folder is hidden from the Files page and refused by the file API.
- Console commands, the player list and graceful shutdown use `rcon-cli` through `docker exec` inside the Minecraft container. The RCON port is never published.

### Facts about the itzg image that shaped the design (checked in its source)

- Property variables are applied to `server.properties` only when set. The panel passes only `EULA`, `TYPE`, `VERSION`, `MEMORY`, `TZ`, `UID`, `GID` and `RCON_PASSWORD`, so edits made in the Options page survive every restart. **Do not add variables such as `MOTD`, `DIFFICULTY` or `MAX_PLAYERS`**, they would overwrite the user's edits on each start.
- The RCON password is random on every start unless `RCON_PASSWORD` is set. The panel pins one in `state.json`; otherwise `rcon-cli` would stop matching the file.
- The image has a healthcheck (`mc-health`, start period 2 minutes). The panel treats the server as online when it sees the `Done (x.xxxs)!` log line, with `healthy` as a fallback.
- **A stop sent while Minecraft is still loading is ignored by the image**, and Docker kills the server after the timeout (exit code 137). The panel therefore waits until the server is ready before stopping it (section 5).
- Files are owned by user and group 1000 (`MC_UID`, `MC_GID`). The panel runs as root and gives every file or folder it creates that owner. A folder created as root, such as `world`, would break the server.
- Because of `unless-stopped`, typing `/stop` in the game restarts the container. Stop in the panel stays stopped.
- Java tags used: 8, 11, 17, 21, 25. Minecraft 26.x needs Java 25, 1.21.x needs 21, 1.18 to 1.20.4 need 17, older need 8.

## 5. Server internals

### Runtime abstraction (`server/src/runtime`)

`Runtime` is the interface the manager talks to: `inspect`, `specHash`, `ensureImage`, `recreate`, `remove`, `start`, `stop`, `followLogs`, `exec`, `stats`, `hostMemoryMb`. `DockerRuntime` implements it with dockerode. `FakeRuntime` pretends to be a server: it prints realistic boot lines, writes sample files and answers a few commands. It exists so the interface can be developed and tested without Docker. It also has test hooks (`startCalls`, `stoppedWhileLoading`).

`recreate` builds the container from a spec. The spec hash (image, environment, mount, port) is stored in the container label `maicra.spec`. Changing the software, Java version, RAM, timezone or RCON password changes the hash, and the next start recreates the container. The data volume is never touched by that.

### ServerManager (`server/src/manager.ts`)

Status is one of `offline`, `starting`, `online`, `stopping`. It is derived on every tick (1.5 s) from the real container, never trusted from memory. A transition (`preparing` or `stopping`) forces the status while an action runs. Players are polled every 5 s with `rcon-cli list`, RAM every 3 s. Changes are published to listeners (the WebSocket) as snapshots, and console lines are kept in a ring buffer of 1000.

Actions:

- `start`: needs the EULA accepted (otherwise API error `eula`, which makes the UI open the EULA modal), pulls the image if missing, recreates the container if the spec changed, starts it. A Stop pressed while the image downloads or the container is created **cancels the start** (`cancelLaunch`).
- `stop` and `restart`: `stopGracefully()` first **waits until the server is ready** (up to 5 minutes), then calls `docker stop` with the 120 s timeout. If it never becomes ready the stop is forced after 15 s. While waiting, the detail text says so.
- `reinstall`: only when offline. Removes the container, deletes everything in `/data` except `.maicra`, resets the software to the newest Vanilla and the RCON password. Keeps the EULA flag, RAM and timezone. Runs in the background; the snapshot has `reinstalling: true` meanwhile and Start is blocked. The API requires the body `{ "confirm": "REINSTALL" }` and the UI asks the user to type that word.
- `setSoftware`, `setEnvironment` (Java, timezone, RAM): offline only (API error `must_be_offline`). Software changes keep worlds and files.
- `command` and `runSilent`: run through rcon, only while online.

### Software and versions (`versions.ts`)

Version lists are fetched and cached for 15 minutes: Vanilla and Snapshot from the Mojang manifest, Paper from `fill.papermc.io/v3`, Purpur from `api.purpurmc.org`, Fabric from `meta.fabricmc.net`. Quilt, NeoForge, Spigot and Forge use cut offs on the Mojang release list (1.18.2, 1.20.2, 1.8, 1.7.10). The Java version is read from the `javaVersion` field of Mojang's per version JSON and mapped to the smallest available tag. Forge before 1.18 is forced to Java 8. The first state uses the newest Vanilla; if there is no internet it falls back to `LATEST` and Java 25.

### Memory (`memory.ts`)

The user can set the maximum RAM from Options. Minimum 1 GB, step 256 MB, maximum is the machine's memory minus 1 GB (read from `docker info`), and the page warns above 75 % of the machine. The setting is stored in `state.json`; `MC_MEMORY` is only the default for a fresh install and for old state files without the field. The image's `MEMORY` variable sets the minimum and maximum heap to the same value.

### Files (`files.ts`)

Every path is normalised to stay inside `DATA_DIR`, symbolic links are resolved and checked, `.maicra` is refused, text files over 2 MB are not edited, uploads stream to a temp file and are renamed into place. `ensureDirs` creates folders with their parents and the right owner. `wipeServerFiles` refuses to run on a filesystem root.

### Players (`players.ts`)

While the server is online the lists change through console commands, because the server owns the JSON files then. While offline the JSON files are edited directly: the UUID comes from the Mojang API, or is computed from `OfflinePlayer:<name>` when `online-mode=false`. Names are validated (`[A-Za-z0-9_]{1,16}`), which also keeps them safe inside rcon commands.

### Authentication and security (`auth.ts`, `app.ts`)

One user. The session is a signed token in an HttpOnly, SameSite=Lax cookie (30 days); the signing key is derived from `SESSION_SECRET`, the email and the password, so changing any of them signs everyone out. Login compares hashes in constant time and is limited to 10 attempts per minute. A global hook requires a session on every `/api/*` route except login, logout and `/api/health`, and rejects unsafe or WebSocket requests whose `Origin` host differs from the request host. Helmet sets the headers.

## 6. HTTP API

All routes are under `/api` and need a session unless marked public. Errors are `{ "error": code, "message": text }`.

| Route | Purpose |
| --- | --- |
| `GET /health` (public) | Liveness for Docker and Coolify |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session |
| `GET /ws` | WebSocket: messages `status`, `history`, `log` |
| `GET /server` | Snapshot: status, detail, address, software, players, RAM, uptime, `reinstalling` |
| `POST /server/start`, `/stop`, `/restart`, `/eula`, `/reinstall` | Actions (start, stop, restart and reinstall answer 202) |
| `GET /server/icon` | The `server-icon.png`, 404 when missing |
| `GET /software`, `GET /software/:type/versions`, `PUT /software` | Catalog, versions, choose software |
| `GET /environment`, `PUT /environment` | Java, timezone and RAM with the allowed options |
| `GET /options/properties`, `PUT /options/properties` | Read and update `server.properties` |
| `POST /console/command` | Run a command (the answer also arrives over the WebSocket) |
| `GET /log`, `GET /log/download` | Latest log |
| `GET/POST/DELETE /players/:list` | `whitelist`, `ops`, `banned-players`, `banned-ips` |
| `GET /files`, `GET/PUT /files/content`, `POST /files/folder` (optional `parents`), `/files/file`, `/files/rename`, `DELETE /files`, `POST /files/upload`, `GET /files/download` | File manager |

The server serves `web/dist` as static files, with `index.html` as the fallback for client side routes.

## 7. Web app

- Layout: top bar, collapsible left sidebar (state kept in localStorage), content. Sidebar order: Server, Options, Console, Log, Players, Software, **Mods** (only with Fabric, Quilt, NeoForge or Forge), **Plugins** (only with Paper, Spigot or Purpur), **Datapacks** (always), Files. The helper functions are in `web/src/software.ts`.
- `state/Server.tsx` keeps one WebSocket, applies console lines once per animation frame, reconnects with backoff and polls `/api/server` while disconnected (which also notices an expired session through a 401).
- `pages/Addons.tsx` is one generic page configured three times (mods, plugins, datapacks): list a folder, upload with drag and drop, download, delete with confirmation. Datapacks resolve their folder as `<level-name>/datapacks` by reading `level-name` from the properties. It creates a missing folder through `POST /files/folder` with `parents`.
- `pages/Options.tsx` is data driven (`FIELDS`). The "Cracked" toggle is the inverse of `online-mode`. Text fields decode and encode Java properties escapes (`mc.ts`): the file stores `\u00A7` for the section sign and `\n` for line breaks. The resource pack prompt is a JSON string. Edits are saved 600 ms after the last change.
- Design tokens come from the real Aternos CSS: font Play (UI), Roboto Mono (console), Pixelify Sans (MOTD card); main `#2b87d3`, success `#1fd78d`, warn `#eb7b59`, danger `#f62451`; grays from `#f0f0f0` to `#161c21`; buttons are flat with 2 px radius. Icons are lucide (Aternos uses a paid Font Awesome set). The Aternos name and logo are not used on purpose.
- The `ref/aternos` screenshots were taken at roughly 125 to 150 % zoom, so pixel sizes in them are not CSS pixels.

## 8. Development workflow

Setup and commands (run from the repository root):

```bash
npm install
npm run dev                  # API on :3000 and Vite on :5173 (the Vite proxy forwards /api and the WebSocket)
npm run typecheck            # both workspaces
npm test -w server           # 37 tests, about 25 s, uses FakeRuntime
npm test -w web              # 7 tests
npm run build                # web/dist and server/dist
```

The root `.env` is for development: `RUNTIME=fake`, `DATA_DIR=./dev-data` (relative to `server/`), login `admin@example.com` with password `maicra-dev-password`. These credentials are for development only.

Trying the panel against real Docker on this PC (Docker Desktop must be running):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build   # panel on http://localhost:3000
docker logs -f maicra-maicra-1                                                     # panel logs
docker logs maicra-minecraft --tail 50                                             # Minecraft logs
docker events --since 30m --filter container=maicra-minecraft                      # who stopped or killed it
```

Names locally: project `maicra`, panel container `maicra-maicra-1`, Minecraft container `maicra-minecraft`, volume `maicra_minecraft-data`.

### Verifying the interface with a throwaway instance

The user's Docker panel occupies port 3000, so use another port. A process environment variable wins over `.env`, so `PORT` overrides it:

```bash
PORT=3200 npm run dev -w server        # fake runtime, data in server/dev-data
```

Then drive it with the `agent-browser` CLI (installed globally; run `agent-browser skills get core` for its guide, and use a named session such as `AGENT_BROWSER_SESSION=maicra-test`). The `browser-use` MCP server sometimes fails to connect, which is why this CLI is the reliable choice. The fake runtime never needs the real EULA, but do not click Start in the user's panel.

**Clean up afterwards**: stop the dev server (find the node and tsx processes), then delete `server/dev-data`. On Windows the delete fails while a shell has that folder as its working directory, so move out of it first.

### Windows and tooling notes

- The shell here is Git Bash or PowerShell on Windows 11. Paths such as `C:\Users\pc\...` map to `/c/Users/pc/...` in Bash.
- BusyBox `ls` inside the panel container lacks `--time-style`.
- npm 12 blocks install scripts of `ssh2`, `cpu-features`, `esbuild` and `protobufjs`; the warnings are harmless, the pure JavaScript fallbacks work.
- Once `npm install -w web <packages>` did not save the dependencies; check `web/package.json` after installing.
- Go templates in `docker inspect --format` print `invalid IP` for an empty host IP in port bindings. It is cosmetic.

## 9. Deploying on Coolify

Current setup, created through the Coolify MCP server (Coolify application `xfc09nzauxwxexxtbgyeauds`, project "Maicra", environment `production`, GitHub App source `widube`):

- **Build pack: Dockerfile**, not Docker Compose. The Coolify API available through the MCP server cannot set the compose file location or the per service domain, and it rejects host path bind mounts. `docker-compose.yml` is therefore not what runs on Coolify. It stays for people who deploy with the Docker Compose build pack by hand (set the service domain to `https://<domain>:3000` in the Coolify interface).
- Domain `https://mc.widube.com`, port 3000. In Cloudflare that record is **DNS only** (grey cloud) and points at the VPS, because Minecraft players connect to the same name on port 25565 and Cloudflare does not proxy that traffic.
- Storage: a named volume mounted at `/data`, plus a **Host File Mount** of `/var/run/docker.sock` at the same path. `custom_docker_run_options` with `-v` is ignored by Coolify, so do not use it for the socket.
- Health check: path `/api/health`, port 3000, and host `127.0.0.1`. The default host `localhost` resolves to IPv6 first inside the Alpine image and the panel only listens on IPv4, so the check fails with "Connection refused".
- Environment variables are runtime only (never build time, so secrets do not become build arguments): `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `MC_PUBLIC_ADDRESS=mc.widube.com`, `MC_PORT=25565`, `MC_MEMORY=2G`. Read them from Coolify when needed instead of writing them in files.
- Port 25565 must be open in the VPS firewall. The first start downloads the Minecraft image, which takes a few minutes.
- If a future change needs a different setup, redeploy with the Coolify deploy tool and check `https://mc.widube.com/api/health`.

Steps for a fresh Docker Compose deployment by hand:

1. Create a resource with the **Docker Compose** build pack using `docker-compose.yml`.
2. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (at least 32 random characters) and `MC_PUBLIC_ADDRESS`. Optional: `MC_PORT`, `MC_MEMORY`, `TZ`.
3. Give the `maicra` service a domain on port 3000. Coolify handles HTTPS.
4. Open the Minecraft port in the VPS firewall. If the VPS already runs another Minecraft server on that port, change `MC_PORT`.

### Environment variables (`server/src/config.ts`)

Required: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8 or more characters), `SESSION_SECRET` (32 or more). Optional with defaults: `PORT` 3000, `HOST` 0.0.0.0, `DATA_DIR` /data, `RUNTIME` docker (or `fake`), `MC_IMAGE` itzg/minecraft-server, `MC_CONTAINER_NAME` maicra-minecraft, `MC_PORT` 25565, `MC_MEMORY` 2G (initial value only), `MC_PUBLIC_ADDRESS`, `MC_DATA_MOUNT` (auto detected), `MC_NETWORK` maicra, `MC_UID` and `MC_GID` 1000, `TZ` UTC, `COOKIE_SECURE` auto, `WEB_DIST`, `LOG_LEVEL`.

## 10. Conventions

- TypeScript is strict, with `noUncheckedIndexedAccess`. In the server, relative imports end in `.js` (NodeNext).
- Request bodies and query strings are validated with zod. Problems the caller can fix are thrown as `ApiError(status, code, message)`. Unexpected errors become a 500 with a generic message.
- Comments explain why, not what. Keep them in plain English.
- Tests: the integration test in `server/src/app.test.ts` builds the whole app with `FakeRuntime` and a temp folder. Add a test for every new endpoint or rule. Long tests wait for status with `waitForStatus`.
- New settings that change the container must go into the spec so the container is recreated.
- Anything the panel writes into `/data` needs `own()` (chown to `MC_UID` and `MC_GID`).
- Never publish the RCON port, never pass property variables to the image, never stop the server with a short timeout while it is online.

## 11. Ideas not built yet

Backups, Worlds, Access for other users, mobile layout, a "force stop" button for a server stuck while starting, enabling and disabling mods by renaming files, reinstalling only the software jar, a container memory limit above the Java heap, hiding the `.rcon-cli.*` dot files from the Files page (they contain the RCON password).
