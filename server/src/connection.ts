import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { z } from 'zod';

export const MINECRAFT_PORT = 25565;
export const portSchema = z.number().int().min(1).max(65535);

/** Hosts are stored without a port; IPv6 brackets are added when formatting the address. */
export const publicAddressSchema = z.string().trim().min(1).max(253).refine((value) => {
  return !value.startsWith('[') || (value.endsWith(']') && isIP(value.slice(1, -1)) === 6);
}, 'Brackets are only valid around an IPv6 address').transform((value) => {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}).refine((host) => {
  if (isIP(host)) return true;
  if (/[\s/:\[\]@?#%\\]/.test(host) || /^[\d.]+$/.test(host)) return false;
  const ascii = domainToASCII(host).replace(/\.$/, '');
  return ascii.length > 0 && ascii.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
}, 'Enter an IP address or domain without a protocol, path or port');

/** Older MC_PUBLIC_ADDRESS values may already contain a port. The public port setting now owns it. */
export function addressHost(value: string): string {
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'));
  return isIP(value) ? value : value.replace(/:\d+$/, '');
}

export function formatAddress(host: string, port: number): string {
  const displayHost = isIP(host) === 6 ? `[${host}]` : host;
  return port === MINECRAFT_PORT ? displayHost : `${displayHost}:${port}`;
}
