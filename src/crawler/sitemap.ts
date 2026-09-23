/**
 * NexVora Deterministic XML Sitemap Parser
 * Supports standard sitemaps and sitemap index files (<sitemapindex>).
 */
import * as cheerio from 'cheerio';
import { normalizeUrl } from '../lib/url-normalizer.ts';
import { validateUrlSafety } from '../security/ssrf.ts';

export interface SitemapUrlEntry {
  url: string;
  normalizedUrl: string;
  domain: string;
  lastmod?: string;
  priority?: number;
}

export interface SitemapParseResult {
  urls: SitemapUrlEntry[];
  childSitemaps: string[];
  isIndex: boolean;
}

export function parseSitemapXml(xmlContent: string): SitemapParseResult {
  const $ = cheerio.load(xmlContent, { xmlMode: true });

  const isIndex = $('sitemapindex').length > 0;
  const childSitemaps: string[] = [];
  const urls: SitemapUrlEntry[] = [];

  if (isIndex) {
    $('sitemap > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc && validateUrlSafety(loc).valid) {
        childSitemaps.push(loc);
      }
    });
  } else {
    $('url').each((_, el) => {
      const loc = $(el).find('loc').text().trim();
      if (!loc) return;

      const safety = validateUrlSafety(loc);
      if (!safety.valid) return;

      const norm = normalizeUrl(loc);
      if (!norm.isValid) return;

      const lastmod = $(el).find('lastmod').text().trim() || undefined;
      const priorityText = $(el).find('priority').text().trim();
      const priority = priorityText ? parseFloat(priorityText) : undefined;

      urls.push({
        url: loc,
        normalizedUrl: norm.normalizedUrl,
        domain: norm.domain,
        lastmod,
        priority: isNaN(priority || NaN) ? undefined : priority,
      });
    });
  }

  return {
    urls,
    childSitemaps,
    isIndex,
  };
}
