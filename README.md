# Maicra

A self-hosted control panel for one Minecraft: Java Edition server, with an interface inspired by the Aternos panel. You run it on your own VPS (for example with Coolify), sign in with one email and password, and manage the server from the browser.

Unlike Aternos, the server does not shut down by itself when nobody is playing. Once you start it, it stays on until you press Stop.

## Features

- Start, stop and restart, with live status (Offline, Starting, Online, Stopping), players, RAM and uptime
- Minecraft EULA prompt on the first start
- Live console with command input, and the latest log with download
- Software and version picker: Vanilla, Snapshot, Paper, Spigot, Purpur, Fabric, Quilt, NeoForge and Forge. The right Java version is chosen from Mojang's own data
- Options page that edits `server.properties` (slots, gamemode, difficulty, whitelist, cracked mode, PVP, command blocks, fly, animals, monsters, villagers, nether, spawn protection, resource pack and more), plus timezone, Java version and the maximum RAM. The RAM picker only offers sizes the machine can give (it keeps 1 GB free for the system) and warns above 75% of the machine's memory. A change applies on the next start
- A server card on the Options page where you write the description (MOTD) with Minecraft colors and styles and see it live, and upload the server icon (converted to the 64x64 PNG Minecraft expects)
- Reinstall (Options page): deletes every server file (worlds, plugins, configs, player lists, logs) and goes back to a fresh install of the newest Vanilla. It only works while the server is offline and asks you to type `REINSTALL`. The panel login, the accepted EULA, the RAM and the timezone are kept
- Mods, Plugins and Datapacks pages: each one is a folder of the server with drag and drop upload, download and delete, and no online search. **Mods** (the `mods` folder) appears only with Fabric, Quilt, NeoForge or Forge. **Plugins** (the `plugins` folder) appears only with Paper, Spigot or Purpur. **Datapacks** is always there and uses `<world>/datapacks`, where the world name comes from `level-name` in `server.properties`. Changes load on the next start (datapacks also with `/reload`)
- Players: whitelist, operators, banned players and banned IPs
- File manager: browse, upload (drag and drop), download, edit text files, create, rename and delete

Not included for now: worlds, access sharing for other users, backups, searching public plugin and mod catalogs, and the mobile layout.

## How it works

```
Browser ──HTTPS──> Maicra panel (Fastify + React) ──/var/run/docker.sock──> itzg/minecraft-server container
                          │                                                          │
                          └────────────── shared volume mounted at /data ────────────┘
```

- The panel creates one Minecraft container from the `itzg/minecraft-server` image and starts, stops and watches it through the Docker API.
- Console commands, player counts and graceful shutdown use the `rcon-cli` tool inside the Minecraft container. The RCON port is never published.
- Panel settings are kept in `/data/.maicra/state.json`. That folder is hidden from the Files page.
- The Minecraft container uses `restart: unless-stopped`. It comes back after a crash or a VPS reboot, and stays stopped after you press Stop.
- Options write straight to `server.properties`, and the panel does not pass property variables to the image, so your changes are not overwritten on start.

## Run it locally (no Docker needed)

You need Node.js 22 or newer.

```bash
npm install
cp .env.example .env      # then edit it. Set RUNTIME=fake to simulate a server without Docker.
npm run dev               # panel on http://localhost:5173, API on http://localhost:3000
```

`RUNTIME=fake` starts a pretend server that prints realistic log lines, so you can work on the interface without Docker or a Minecraft download.

Useful commands: `npm test --workspace server`, `npm run typecheck`, `npm run build`.

## Deploy with Coolify

1. Push this repository to GitHub or GitLab.
2. In Coolify create a new resource from the repository and choose the **Docker Compose** build pack. Use `docker-compose.yml` from the root.
3. Set these environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (generate it with `openssl rand -hex 32`) and `MC_PUBLIC_ADDRESS` (the address players will use, for example `mc.example.com`). Optional: `MC_PORT`, `MC_MEMORY`, `TZ`.
4. Give the `maicra` service a domain, for example `https://panel.example.com`, and set its port to `3000`. Coolify takes care of HTTPS.
5. Open port `25565` (or your `MC_PORT`) in the VPS firewall. Players connect to it directly, not through the panel domain.
6. Deploy, sign in, press Start and accept the EULA. The first start downloads the Minecraft image, which takes a few minutes.

If another Minecraft server on the same VPS already uses port 25565, set `MC_PORT` to a different port or stop the other server first.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_EMAIL` | required | Email used to sign in |
| `ADMIN_PASSWORD` | required | Password, at least 8 characters |
| `SESSION_SECRET` | required | Signs the session cookie, at least 32 characters. Changing it, the email or the password signs everyone out |
| `MC_PUBLIC_ADDRESS` | `localhost` | Address shown in the panel for players to connect |
| `MC_PORT` | `25565` | Host port published for Minecraft |
| `MC_MEMORY` | `2G` | Starting Java heap size for a new install, for example `4G` or `1536M`. After that, change it on the Options page |
| `MC_IMAGE` | `itzg/minecraft-server` | Docker image. The panel adds the Java tag, for example `:java25` |
| `MC_CONTAINER_NAME` | `maicra-minecraft` | Name of the Minecraft container |
| `MC_DATA_MOUNT` | detected | Volume name or host path mounted at `/data` in the Minecraft container. Detected from the panel's own mount of `DATA_DIR` |
| `MC_UID`, `MC_GID` | `1000` | Owner of Minecraft files. Files the panel writes get the same owner |
| `DATA_DIR` | `/data` | Where the panel sees the Minecraft data |
| `PORT` | `3000` | Panel HTTP port |
| `TZ` | `UTC` | Default timezone of the Minecraft container |
| `RUNTIME` | `docker` | `fake` simulates a server for development |
| `COOKIE_SECURE` | `auto` | `auto` sets the Secure flag when the request came over HTTPS |

## Security notes

- Mounting `/var/run/docker.sock` gives the panel full control of Docker on the host. That is equivalent to root access, so anyone who can sign in to the panel can control the VPS. Use a long password, keep the panel on HTTPS and do not share the login.
- Login attempts are limited to 10 per minute per address. Sessions are signed, HttpOnly cookies, and requests from other websites are rejected.
- The file manager cannot leave the Minecraft data folder, including through symbolic links.
- Plugins and mods run inside the Minecraft container with the access of that container only. They cannot reach the Docker socket.
