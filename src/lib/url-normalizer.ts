/**
 * NexVora Deterministic URL Normalizer
 * Normalizes URLs to prevent duplicates, strips tracking tags,
 * standardizes scheme/host/ports, sorts queries, and strips fragments.
 */
import crypto from 'crypto';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_eid',
  'zanpid',
  'ref',
  'ref_src',
  'ref_url',
  '_ga',
  '_gl',
  'phpsessid',
  'jsessionid',
  'sessionid',
  'sid',
  'spm',
  'aff_id',
  'trk',
]);

export interface NormalizedUrlResult {
  originalUrl: string;
  normalizedUrl: string;
  domain: string;
  hostname: string;
  path: string;
  hash: string;
  isValid: boolean;
  error?: string;
}

/**
 * Extracts the registered domain (e.g., example.com from sub.example.com, or gov.bd from site.gov.bd)
 */
export function extractRootDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  // Handle multi-part ccTLDs like .gov.bd, .ac.bd, .co.uk, .com.au, .edu.bd
  const twoPartTlds = ['gov.bd', 'ac.bd', 'edu.bd', 'com.bd', 'net.bd', 'org.bd', 'co.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'co.jp'];
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Normalizes a URL deterministically
 */
export function normalizeUrl(rawUrl: string): NormalizedUrlResult {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      originalUrl: rawUrl,
      normalizedUrl: '',
      domain: '',
      hostname: '',
      path: '',
      hash: '',
      isValid: false,
      error: 'Empty URL',
    };
  }

  try {
    const url = new URL(trimmed);

    // 1. Enforce lowercase protocol and hostname
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // 2. Strip standard ports
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }

    // 3. Remove hash/fragment
    url.hash = '';

    // 4. Filter and sort query parameters
    const searchParams = new URLSearchParams(url.search);
    const filteredParams = new URLSearchParams();

    // Collect valid params
    const sortedKeys = Array.from(new Set(searchParams.keys())).sort();
    for (const key of sortedKeys) {
      if (!TRACKING_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_')) {
        const values = searchParams.getAll(key);
        for (const val of values) {
          filteredParams.append(key, val);
        }
      }
    }

    const queryStr = filteredParams.toString();
    url.search = queryStr ? `?${queryStr}` : '';

    // 5. Normalize trailing slashes
    // If pathname is just "/" or empty, keep standard "/"
    // If pathname is "/subpath/" and has no extension, remove trailing slash
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname;

    const normalizedString = url.toString();
    const domain = extractRootDomain(url.hostname);
    const hash = crypto.createHash('sha256').update(normalizedString).digest('hex');

    return {
      originalUrl: trimmed,
      normalizedUrl: normalizedString,
      domain,
      hostname: url.hostname,
      path: url.pathname,
      hash,
      isValid: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      originalUrl: trimmed,
      normalizedUrl: '',
      domain: '',
      hostname: '',
      path: '',
      hash: '',
      isValid: false,
      error: msg,
    };
  }
}

/**
 * Resolves a relative URL against a base URL and normalizes it
 */
export function resolveRelativeUrl(relative: string, baseUrl: string): NormalizedUrlResult {
  try {
    const resolved = new URL(relative, baseUrl).toString();
    return normalizeUrl(resolved);
  } catch {
    return {
      originalUrl: relative,
      normalizedUrl: '',
      domain: '',
      hostname: '',
      path: '',
      hash: '',
      isValid: false,
      error: 'Cannot resolve relative URL against base',
    };
  }
}
