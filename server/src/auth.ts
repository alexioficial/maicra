import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export const SESSION_COOKIE = 'maicra_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Single user authentication. The session is a signed token in an HttpOnly cookie, so nothing is
 * stored on the server. The signing key also depends on the login, which means changing the email
 * or the password in the environment signs everyone out.
 */
export class Auth {
  private readonly key: Buffer;

  constructor(private readonly config: Config) {
    this.key = createHash('sha256')
      .update(`${config.sessionSecret}\0${config.adminEmail.toLowerCase()}\0${config.adminPassword}`)
      .digest();
  }

  checkCredentials(email: string, password: string): boolean {
    // Compare hashes so the time taken does not depend on how many characters match.
    const emailOk = timingSafeEqual(digest(email.trim().toLowerCase()), digest(this.config.adminEmail.toLowerCase()));
    const passwordOk = timingSafeEqual(digest(password), digest(this.config.adminPassword));
    return emailOk && passwordOk;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  createToken(): string {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
      return typeof exp === 'number' && exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }

  private isSecure(request: FastifyRequest): boolean {
    if (this.config.cookieSecure === 'true') return true;
    if (this.config.cookieSecure === 'false') return false;
    return request.protocol === 'https';
  }

  setCookie(request: FastifyRequest, reply: FastifyReply): void {
    reply.setCookie(SESSION_COOKIE, this.createToken(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_SECONDS,
      secure: this.isSecure(request),
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
