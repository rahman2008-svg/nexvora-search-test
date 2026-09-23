/**
 * NexVora Search URL & Canonical Routing Utility
 *
 * Enforces NexVora's own custom search domain and standard URL structure:
 * Format: https://www.nexvora.com/search?q={query}
 * Pagination: https://www.nexvora.com/search?q={query}&page=2
 * Category: https://www.nexvora.com/search?q={query}&category={category}
 * Combined: https://www.nexvora.com/search?q={query}&category={category}&page=2
 *
 * Strict Rules:
 * - Never redirects users to Google, Bing, or external engines.
 * - Standard URL encoding (e.g. q=khan+sir, q=python).
 * - No Google-style tracking parameters (gs_ssp, oq, client, sourceid, ie, etc.).
 * - Uses browser History API for shareable, bookmarkable, reloadable search states.
 */

export const DEFAULT_PRODUCTION_DOMAIN = 'https://www.nexvora.com';

/**
 * Resolves the base site URL using environment configuration or default production domain
 */
export function getBaseSiteUrl(): string {
  // Check NEXT_PUBLIC_SITE_URL or VITE_SITE_URL or APP_URL in Node or Vite environments
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  }

  if (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env) {
    const env = (import.meta as { env: Record<string, string> }).env;
    const envUrl = env.NEXT_PUBLIC_SITE_URL || env.VITE_SITE_URL || env.VITE_APP_URL;
    if (envUrl && envUrl.trim().length > 0) {
      return envUrl.trim().replace(/\/+$/, '');
    }
  }

  return DEFAULT_PRODUCTION_DOMAIN;
}

/**
 * Builds the internal relative search path:
 * /search?q={query}
 * /search?q={query}&category={category}
 * /search?q={query}&page={page}
 * /search?q={query}&category={category}&page={page}
 */
export function buildSearchPath(query: string, category = 'All', page = 1): string {
  const trimmed = query.trim();
  if (!trimmed) return '/';

  const params = new URLSearchParams();
  params.set('q', trimmed);

  if (category && category !== 'All') {
    params.set('category', category.toLowerCase());
  }

  if (page && page > 1) {
    params.set('page', page.toString());
  }

  return `/search?${params.toString()}`;
}

/**
 * Builds the full absolute canonical search URL:
 * https://www.nexvora.com/search?q={query}
 */
export function buildCanonicalSearchUrl(query: string, category = 'All', page = 1): string {
  const relativePath = buildSearchPath(query, category, page);
  return `${getBaseSiteUrl()}${relativePath}`;
}

export interface ParsedSearchRoute {
  isSearch: boolean;
  query: string;
  category: string;
  page: number;
}

/**
 * Parses the current window location (pathname & search parameters)
 */
export function parseSearchLocation(pathname: string, search: string): ParsedSearchRoute {
  const params = new URLSearchParams(search);
  const q = (params.get('q') || '').trim();
  const rawCat = (params.get('category') || '').trim();
  const rawPage = parseInt(params.get('page') || '1', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  let category = 'All';
  if (rawCat) {
    category = rawCat;
  }

  const isSearchPath = pathname === '/search' || pathname.startsWith('/search/');
  const isSearch = Boolean(q) || isSearchPath;

  return {
    isSearch,
    query: q,
    category,
    page,
  };
}

/**
 * Updates DOM title, canonical link, and OpenGraph/Twitter meta tags
 */
export function syncDocumentHead(query: string, category = 'All', page = 1): void {
  if (typeof document === 'undefined') return;

  const trimmed = query.trim();
  const canonicalUrl = trimmed
    ? buildCanonicalSearchUrl(trimmed, category, page)
    : `${getBaseSiteUrl()}/`;

  // Update <title>
  if (trimmed) {
    const pageSuffix = page > 1 ? ` (Page ${page})` : '';
    document.title = `${trimmed}${pageSuffix} - NexVora Search`;
  } else {
    document.title = 'NexVora Search – Fast, Autonomous Web Search Engine';
  }

  // Update or insert <link rel="canonical">
  let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonicalLink) {
    canonicalLink = document.createElement('link');
    canonicalLink.setAttribute('rel', 'canonical');
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.setAttribute('href', canonicalUrl);

  // Update or insert <meta property="og:url">
  let ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
  if (!ogUrl) {
    ogUrl = document.createElement('meta');
    ogUrl.setAttribute('property', 'og:url');
    document.head.appendChild(ogUrl);
  }
  ogUrl.setAttribute('content', canonicalUrl);

  // Update <meta property="og:title">
  const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
  if (ogTitle) {
    ogTitle.setAttribute('content', document.title);
  }

  // Update or insert <meta name="twitter:url">
  let twitterUrl = document.querySelector('meta[name="twitter:url"]') as HTMLMetaElement | null;
  if (!twitterUrl) {
    twitterUrl = document.createElement('meta');
    twitterUrl.setAttribute('name', 'twitter:url');
    document.head.appendChild(twitterUrl);
  }
  twitterUrl.setAttribute('content', canonicalUrl);
}
