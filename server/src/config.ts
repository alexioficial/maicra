import path from 'node:path';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const schema = z.object({
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(8, 'must be at least 8 characters'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('/data'),
  RUNTIME: z.enum(['docker', 'fake']).default('docker'),

  MC_IMAGE: z.string().default('itzg/minecraft-server'),
  MC_CONTAINER_NAME: z.string().default('maicra-minecraft'),
  MC_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MC_MEMORY: z
    .string()
    .regex(/^\d+[MmGg]$/, 'must look like 2G or 1536M')
    .default('2G'),
  MC_PUBLIC_ADDRESS: optionalString,
  MC_DATA_MOUNT: optionalString,
  MC_UID: z.coerce.number().int().default(1000),
  MC_GID: z.coerce.number().int().default(1000),
  TZ: z.string().default('UTC'),

  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  WEB_DIST: optionalString,
});

export interface Config {
  adminEmail: string;
  adminPassword: string;
  sessionSecret: string;
  port: number;
  host: string;
  dataDir: string;
  runtime: 'docker' | 'fake';
  mcImage: string;
  mcContainerName: string;
  mcPort: number;
  /** Java heap size as given by the user, for example "2G". */
  mcMemory: string;
  mcMemoryMb: number;
  mcPublicAddress: string | undefined;
  mcDataMount: string | undefined;
  mcUid: number;
  mcGid: number;
  timezone: string;
  cookieSecure: 'auto' | 'true' | 'false';
  webDist: string | undefined;
}

export function parseMemoryMb(value: string): number {
  const match = /^(\d+)([MmGg])$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2]!.toUpperCase() === 'G' ? amount * 1024 : amount;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid configuration. Fix these environment variables:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    adminEmail: e.ADMIN_EMAIL,
    adminPassword: e.ADMIN_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    port: e.PORT,
    host: e.HOST,
    dataDir: path.resolve(e.DATA_DIR),
    runtime: e.RUNTIME,
    mcImage: e.MC_IMAGE,
    mcContainerName: e.MC_CONTAINER_NAME,
    mcPort: e.MC_PORT,
    mcMemory: e.MC_MEMORY.toUpperCase(),
    mcMemoryMb: parseMemoryMb(e.MC_MEMORY),
    mcPublicAddress: e.MC_PUBLIC_ADDRESS,
    mcDataMount: e.MC_DATA_MOUNT,
    mcUid: e.MC_UID,
    mcGid: e.MC_GID,
    timezone: e.TZ,
    cookieSecure: e.COOKIE_SECURE,
    webDist: e.WEB_DIST,
  };
}
