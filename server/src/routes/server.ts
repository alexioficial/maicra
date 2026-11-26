import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../errors.js';
import { SLEEP_AFTER_MINUTES } from '../manager.js';
import { memoryOptions } from '../memory.js';
import {
  JAVA_VERSIONS,
  SOFTWARE_TYPES,
  type EnvironmentResponse,
  type LogLine,
  type ServerSnapshot,
  type SoftwareCatalogEntry,
  type SoftwareResponse,
  type WsMessage,
} from '../types.js';

const CATALOG: SoftwareCatalogEntry[] = [
  { id: 'vanilla', label: 'Vanilla', badge: null, description: 'The original Minecraft server made by Mojang.', website: 'https://www.minecraft.net' },
  { id: 'snapshot', label: 'Snapshot', badge: null, description: 'Experimental builds of the next Minecraft release.', website: 'https://www.minecraft.net' },
  { id: 'paper', label: 'Paper/Bukkit', badge: 'plugins', description: 'A fast fork of Spigot that runs Bukkit and Spigot plugins.', website: 'https://papermc.io' },
  { id: 'spigot', label: 'Spigot/Bukkit', badge: 'plugins', description: 'The classic plugin server, built with Spigot BuildTools.', website: 'https://www.spigotmc.org' },
  { id: 'purpur', label: 'Purpur/Bukkit', badge: 'plugins', description: 'A Paper fork with many extra gameplay options.', website: 'https://purpurmc.org' },
  { id: 'fabric', label: 'Fabric', badge: 'mods', description: 'A light and fast mod loader.', website: 'https://fabricmc.net' },
  { id: 'quilt', label: 'Quilt', badge: 'mods', description: 'A community mod loader compatible with most Fabric mods.', website: 'https://quiltmc.org' },
  { id: 'neoforge', label: 'NeoForge', badge: 'mods', description: 'The modern continuation of Forge.', website: 'https://neoforged.net' },
  { id: 'forge', label: 'Forge', badge: 'mods', description: 'The long running mod loader with the biggest mod library.', website: 'https://minecraftforge.net' },
];

const commandBody = z.object({ command: z.string().max(500) });
const softwareBody = z.object({ type: z.enum(SOFTWARE_TYPES), version: z.string().min(1).max(64) });
const environmentBody = z.object({
  java: z.enum(JAVA_VERSIONS).optional(),
  timezone: z.string().min(1).max(64).optional(),
  memoryMb: z.number().int().optional(),
  initMemoryMb: z.number().int().optional(),
  sleepWhenEmpty: z.boolean().optional(),
  sleepAfterMinutes: z.number().int().optional(),
});

export async function serverRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { manager, versions } = ctx;

  app.get('/api/server', async () => manager.snapshot());

  app.post('/api/server/start', async (_request, reply) => {
    await manager.start();
    return reply.code(202).send(manager.snapshot());
  });

  app.post('/api/server/stop', async (_request, reply) => {
    await manager.stop();
    return reply.code(202).send(manager.snapshot());
  });

  app.post('/api/server/restart', async (_request, reply) => {
    await manager.restart();
    return reply.code(202).send(manager.snapshot());
  });

  // Irreversible, so the caller has to send the confirmation word on purpose.
  app.post('/api/server/reinstall', async (request, reply) => {
    z.object({ confirm: z.literal('REINSTALL') }).parse(request.body);
    await manager.reinstall();
    return reply.code(202).send(manager.snapshot());
  });

  app.post('/api/server/eula', async (request) => {
    z.object({ accept: z.literal(true) }).parse(request.body);
    await manager.acceptEula();
    return manager.snapshot();
  });

  // The icon Minecraft shows in the multiplayer list. 404 when none was uploaded.
  app.get('/api/server/icon', async (_request, reply) => {
    try {
      const { stream, size } = await ctx.files.openRead('/server-icon.png');
      reply.header('content-type', 'image/png');
      reply.header('content-length', size);
      reply.header('cache-control', 'no-cache');
      return await reply.send(stream);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return reply.code(404).send({ error: 'not_found', message: 'No server icon' });
      }
      throw error;
    }
  });

  app.get('/api/software', async (): Promise<SoftwareResponse> => ({ current: manager.snapshot().software, catalog: CATALOG }));

  app.get('/api/software/:type/versions', async (request) => {
    const { type } = z.object({ type: z.enum(SOFTWARE_TYPES) }).parse(request.params);
    return { versions: await versions.list(type) };
  });

  app.put('/api/software', async (request) => {
    const { type, version } = softwareBody.parse(request.body);
    await manager.setSoftware(type, version);
    return manager.snapshot().software;
  });

  const environment = async (): Promise<EnvironmentResponse> => {
    const { java, timezone, memoryMb, initMemoryMb, limits, sleepWhenEmpty, sleepAfterMinutes } = await manager.environment();
    // Intl does not list "UTC" itself, and the saved zone must always be selectable.
    const timezones = [...new Set(['UTC', timezone, ...Intl.supportedValuesOf('timeZone')])];
    return {
      java,
      javaVersions: [...JAVA_VERSIONS],
      timezone,
      timezones,
      memoryMb,
      initMemoryMb,
      memoryOptionsMb: memoryOptions(limits, memoryMb),
      hostMemoryMb: limits.hostMb,
      recommendedMemoryMb: limits.recommendedMb,
      sleepWhenEmpty,
      sleepAfterMinutes,
      // The saved value stays selectable even if the list of choices changes later.
      sleepAfterOptionsMinutes: [...new Set([...SLEEP_AFTER_MINUTES, sleepAfterMinutes])].sort((a, b) => a - b),
    };
  };

  app.get('/api/environment', async (): Promise<EnvironmentResponse> => environment());

  app.put('/api/environment', async (request): Promise<EnvironmentResponse> => {
    await manager.setEnvironment(environmentBody.parse(request.body));
    return environment();
  });

  app.post('/api/console/command', async (request) => {
    const { command } = commandBody.parse(request.body);
    return { output: await manager.command(command) };
  });

  // One socket carries status changes and console lines.
  app.get('/api/ws', { websocket: true }, (socket) => {
    const send = (message: WsMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const onStatus = (data: ServerSnapshot) => send({ type: 'status', data });
    const onLog = (line: LogLine) => send({ type: 'log', line });
    const onHistory = (lines: LogLine[]) => send({ type: 'history', lines });

    send({ type: 'status', data: manager.snapshot() });
    send({ type: 'history', lines: manager.history() });
    manager.on('status', onStatus);
    manager.on('log', onLog);
    manager.on('history', onHistory);

    // Keeps the connection alive through proxies that close idle sockets.
    const heartbeat = setInterval(() => socket.ping(), 30_000);
    socket.on('close', () => {
      clearInterval(heartbeat);
      manager.off('status', onStatus);
      manager.off('log', onLog);
      manager.off('history', onHistory);
    });
  });
}
