/**
 * NexVora SSRF Protection & Safe URL Validation
 * Prevents requests to private, loopback, multicast, carrier-grade NAT,
 * and link-local networks. Enforces safe schemes and standard ports.
 */
import dns from 'dns';
import { promisify } from 'util';

const resolve4Async = promisify(dns.resolve4);
const resolve6Async = promisify(dns.resolve6);

// Private IPv4 CIDR ranges
const PRIVATE_IPV4_RANGES = [
  { start: 0x00000000, end: 0x00ffffff }, // 0.0.0.0/8 (Current network)
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8 (Private)
  { start: 0x64400000, end: 0x647fffff }, // 100.64.0.0/10 (Carrier-grade NAT)
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8 (Loopback)
  { start: 0xa9fe0000, end: 0xa9feffff }, // 169.254.0.0/16 (Link-local)
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12 (Private)
  { start: 0xc0000000, end: 0xc00000ff }, // 192.0.0.0/24 (IETF Protocol Assignments)
  { start: 0xc0000200, end: 0xc00002ff }, // 192.0.2.0/24 (TEST-NET-1)
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16 (Private)
  { start: 0xc6120000, end: 0xc613ffff }, // 198.18.0.0/15 (Benchmarking)
  { start: 0xc6336400, end: 0xc63364ff }, // 198.51.100.0/24 (TEST-NET-2)
  { start: 0xcb007100, end: 0xcb0071ff }, // 203.0.113.0/24 (TEST-NET-3)
  { start: 0xe0000000, end: 0xefffffff }, // 224.0.0.0/4 (Multicast)
  { start: 0xf0000000, end: 0xffffffff }, // 240.0.0.0/4 (Reserved)
];

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

export function isPrivateIPv4(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const num = ipToNumber(ip);
  return PRIVATE_IPV4_RANGES.some((range) => num >= range.start && num <= range.end);
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  // fe80::/10 (Link-local)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  // fc00::/7 (Unique local address)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // IPv4-mapped IPv6 (::ffff:192.168.1.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4 = normalized.replace('::ffff:', '');
    return isPrivateIPv4(ipv4);
  }
  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  parsedUrl?: URL;
}

/**
 * Validates a URL for safe public crawling:
 * - Scheme must be http or https
 * - Port must be 80, 443, or empty
 * - Host must not be localhost, internal domains, or private IP
 */
export function validateUrlSafety(rawUrl: string): UrlValidationResult {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `Disallowed protocol: ${parsed.protocol}` };
    }

    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      return { valid: false, reason: `Disallowed port: ${parsed.port}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block common internal/local hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan') ||
      hostname === '0.0.0.0' ||
      hostname === 'metadata.google.internal' ||
      hostname === '169.254.169.254'
    ) {
      return { valid: false, reason: `Blocked local or internal hostname: ${hostname}` };
    }

    // Direct IP check
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
      return { valid: false, reason: `Direct private IP not allowed: ${hostname}` };
    }

    return { valid: true, parsedUrl: parsed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Malformed URL: ${msg}` };
  }
}

/**
 * Performs DNS resolution check to guard against DNS rebinding attacks
 */
export async function assertSafeDns(hostname: string): Promise<boolean> {
  try {
    // If it's already an IP, check directly
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
      return false;
    }

    let ips: string[] = [];
    try {
      const v4 = await resolve4Async(hostname);
      ips.push(...v4);
    } catch {
      // Ignore if no IPv4
    }

    try {
      const v6 = await resolve6Async(hostname);
      ips.push(...v6);
    } catch {
      // Ignore if no IPv6
    }

    if (ips.length === 0) {
      // Cannot resolve hostname
      return false;
    }

    for (const ip of ips) {
      if (isPrivateIPv4(ip) || isPrivateIPv6(ip)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
