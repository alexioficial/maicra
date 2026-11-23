/** Helpers for the memory (Java heap) setting of the Minecraft server. All sizes are in megabytes. */

export const MIN_MEMORY_MB = 1024;
export const MEMORY_STEP_MB = 256;

/** Memory kept free for the operating system, Docker and the panel. */
const SYSTEM_RESERVE_MB = 1024;
/** Used when the amount of memory in the machine cannot be read. */
const UNKNOWN_HOST_MAX_MB = 65536;

export interface MemoryLimits {
  /** Total memory of the machine that runs Docker, or null when unknown. */
  hostMb: number | null;
  minMb: number;
  /** The most the server may be given. Anything above is rejected. */
  maxMb: number;
  /** The most that is safe to use. Above it the panel shows a warning. */
  recommendedMb: number;
}

const floorToStep = (mb: number) => Math.floor(mb / MEMORY_STEP_MB) * MEMORY_STEP_MB;

export function computeLimits(hostMb: number | null): MemoryLimits {
  if (hostMb === null) {
    return { hostMb, minMb: MIN_MEMORY_MB, maxMb: UNKNOWN_HOST_MAX_MB, recommendedMb: UNKNOWN_HOST_MAX_MB };
  }
  const maxMb = Math.max(MIN_MEMORY_MB, floorToStep(hostMb - SYSTEM_RESERVE_MB));
  const recommendedMb = Math.min(maxMb, Math.max(MIN_MEMORY_MB, floorToStep(hostMb * 0.75)));
  return { hostMb, minMb: MIN_MEMORY_MB, maxMb, recommendedMb };
}

/** Sizes offered in the picker: fine steps for small servers, wider steps as they grow. */
function candidates(): number[] {
  const sizes = [1024, 1536, 2048];
  for (let gb = 3; gb <= 16; gb++) sizes.push(gb * 1024);
  for (let gb = 18; gb <= 32; gb += 2) sizes.push(gb * 1024);
  for (let gb = 36; gb <= 128; gb += 4) sizes.push(gb * 1024);
  return sizes;
}

/** The sizes the picker shows. The current value is always included so it never disappears. */
export function memoryOptions(limits: MemoryLimits, currentMb: number): number[] {
  const sizes = new Set(candidates().filter((mb) => mb >= limits.minMb && mb <= limits.maxMb));
  sizes.add(currentMb);
  return [...sizes].sort((a, b) => a - b);
}

/** The value of the MEMORY variable of the Minecraft image, for example "4G" or "1536M". */
export function toMemoryArg(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024}G` : `${mb}M`;
}

/** Human readable size, for example "4 GB" or "1.5 GB". */
export function describeMemory(mb: number): string {
  return mb >= 1024 ? `${Number((mb / 1024).toFixed(2))} GB` : `${mb} MB`;
}
