import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { JAVA_VERSIONS, SOFTWARE_TYPES, type SoftwareInfo } from './types.js';

export interface PanelState {
  eulaAccepted: boolean;
  software: SoftwareInfo;
  timezone: string;
  rconPassword: string;
  /** Maximum Java heap in megabytes. */
  memoryMb: number;
  /** Initial (minimum) Java heap in megabytes. Never above memoryMb. */
  initMemoryMb: number;
  /** Freeze the server while nobody is online (the autopause feature of the image). */
  sleepWhenEmpty: boolean;
  /** Minutes without players before the server is frozen. */
  sleepAfterMinutes: number;
}

/** The image's own default for the autopause timeout is one hour as well. */
export const DEFAULT_SLEEP_AFTER_MINUTES = 60;

/**
 * Older state files have no memory value. They get the default, which is the MC_MEMORY setting.
 * Files written before the minimum RAM option have no initMemoryMb, see withInitMemory.
 * Files written before the sleep option get it switched off, so an existing server keeps running.
 */
function buildSchema(defaultMemoryMb: number) {
  return z.object({
    eulaAccepted: z.boolean(),
    software: z.object({
      type: z.enum(SOFTWARE_TYPES),
      version: z.string().min(1),
      java: z.enum(JAVA_VERSIONS),
    }),
    timezone: z.string().min(1),
    rconPassword: z.string().min(8),
    memoryMb: z.number().int().min(256).default(defaultMemoryMb),
    initMemoryMb: z.number().int().min(256).optional(),
    sleepWhenEmpty: z.boolean().default(false),
    sleepAfterMinutes: z.number().int().min(1).default(DEFAULT_SLEEP_AFTER_MINUTES),
  });
}

/**
 * A state file without a minimum keeps the old behaviour, where minimum and maximum were the same.
 * A minimum above the maximum would make Java refuse to start, so it is lowered to the maximum.
 */
function withInitMemory(parsed: z.infer<ReturnType<typeof buildSchema>>): PanelState {
  return { ...parsed, initMemoryMb: Math.min(parsed.initMemoryMb ?? parsed.memoryMb, parsed.memoryMb) };
}

export const HIDDEN_DIR = '.maicra';

export function newRconPassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Panel settings stored as JSON inside the Minecraft data folder, hidden from the Files page. */
export class StateStore {
  private readonly file: string;
  private readonly schema: ReturnType<typeof buildSchema>;
  private current: PanelState | null = null;

  constructor(dataDir: string, defaults: { memoryMb: number }) {
    this.file = path.join(dataDir, HIDDEN_DIR, 'state.json');
    this.schema = buildSchema(defaults.memoryMb);
  }

  async load(): Promise<PanelState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const parsed = this.schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`State file ${this.file} is invalid: ${parsed.error.message}`);
    }
    this.current = withInitMemory(parsed.data);
    return this.current;
  }

  get(): PanelState {
    if (!this.current) throw new Error('Panel state is not initialised yet');
    return this.current;
  }

  async set(state: PanelState): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    this.current = state;
  }

  async update(patch: Partial<PanelState>): Promise<PanelState> {
    const next = { ...this.get(), ...patch };
    await this.set(next);
    return next;
  }
}
