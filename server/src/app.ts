import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { Auth, SESSION_COOKIE } from './auth.js';
import { loadConfig, type Config } from './config.js';
import type { AppContext } from './context.js';
import { ApiError } from './errors.js';
import { FileService } from './files.js';
import { ServerManager } from './manager.js';
import { PlayersService } from './players.js';
import { authRoutes } from './routes/auth.js';
import { fileRoutes } from './routes/files.js';
import { optionRoutes } from './routes/options.js';
import { playerRoutes } from './routes/players.js';
import { serverRoutes } from './routes/server.js';
import { DockerRuntime } from './runtime/docker.js';
import { FakeRuntime } from './runtime/fake.js';
import type { Runtime } from './runtime/types.js';
import { StateStore } from './state.js';
import { VersionService } from './versions.js';

const PUBLIC_API_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/health']);

function createRuntime(config: Config): Runtime {
  return config.runtime === 'fake' ? new FakeRuntime(config.dataDir) : new DockerRuntime(config);
}

export async function buildApp(config: Config, deps: { versions?: VersionService; runtime?: Runtime } = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const store = new StateStore(config.dataDir, { memoryMb: config.mcMemoryMb });
  const versions = deps.versions ?? new VersionService();
  const manager = new ServerManager(config, deps.runtime ?? createRuntime(config), store, versions);
  const files = new FileService(config.dataDir, config.mcUid, config.mcGid);
  const ctx: AppContext = {
    config,
    auth: new Auth(config),
    manager,
    files,
    versions,
    players: new PlayersService(files, manager),
  };

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 ** 3, files: 50 } });

  // Every /api request needs a valid session, except logging in and out.
  app.addHook('onRequest', async (request) => {
    const pathname = request.url.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/')) return;

    // Blocks requests that a browser sends from another website.
    const origin = request.headers.origin;
    const isSocket = request.headers.upgrade?.toLowerCase() === 'websocket';
    const isUnsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (origin && (isUnsafe || isSocket)) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        // Malformed origin. Treated as a mismatch below.
      }
      if (originHost !== request.host) throw new ApiError(403, 'bad_origin', 'Cross-site request blocked');
    }

    if (PUBLIC_API_PATHS.has(pathname)) return;
    if (!ctx.auth.verifyToken(request.cookies[SESSION_COOKIE])) {
      throw new ApiError(401, 'unauthorized', 'Sign in to continue');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      return reply.code(400).send({ error: 'invalid_request', message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as { code?: string }).code ?? 'bad_request', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on the server' });
  });

  // Used by the Docker healthcheck and by Coolify. It reveals nothing about the server.
  app.get('/api/health', async () => ({ ok: true }));

  await authRoutes(app, ctx);
  await serverRoutes(app, ctx);
  await optionRoutes(app, ctx);
  await fileRoutes(app, ctx);
  await playerRoutes(app, ctx);

  // The built web app, with a fallback to index.html so client side routes work on reload.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = config.webDist ?? path.resolve(here, '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      setHeaders(res, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', message: 'Unknown API route' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`Web app not found at ${webDist}. Run "npm run build" or use "npm run dev".`);
  }

  return { app, manager };
}

