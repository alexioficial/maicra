import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../errors.js';
import type { AuthMe } from '../types.js';

const loginBody = z.object({ email: z.string().max(320), password: z.string().max(1024) });

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = loginBody.parse(request.body);
    if (!ctx.auth.checkCredentials(email, password)) {
      throw new ApiError(401, 'invalid_credentials', 'Wrong email or password');
    }
    ctx.auth.setCookie(request, reply);
    return { email: ctx.config.adminEmail } satisfies AuthMe;
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    ctx.auth.clearCookie(reply);
    return { ok: true };
  });

  // Protected by the global session check, so a 200 here means the session is valid.
  app.get('/api/auth/me', async () => ({ email: ctx.config.adminEmail }) satisfies AuthMe);
}
