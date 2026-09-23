/**
 * NexVora Deterministic HTML Parser
 * Extracts structured metadata, headings, text content, and safe discovery links.
 * Strips noise, script tags, navbars, and advertisements.
 */
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { resolveRelativeUrl } from '../lib/url-normalizer.ts';
import { validateUrlSafety } from '../security/ssrf.ts';

export interface ParsedPageData {
  title: string;
  description: string;
  canonicalUrl: string | null;
  language: string;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  contentPreview: string;
  fullText: string;
  tokens: string[];
  termFrequencies: Record<string, number>;
  docLength: number;
  contentHash: string;
  links: string[];
  publishedAt: string | null;
  contentType: string;
}

// Media file extensions to ignore during crawling
const IGNORED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.mp3', '.wav', '.flac', '.aac', '.ogg',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dmg', '.iso', '.bin',
  '.css', '.js', '.map', '.json', '.xml', '.rss', '.woff', '.woff2', '.ttf', '.eot'
]);

// Common English stopwords for search index tokenization
export const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours'
]);

export function tokenizeText(text: string): string[] {
  if (!text) return [];
  // Tokenize words, numbers, and hyphens
  const rawTokens = text.toLowerCase().match(/[a-z0-9\u00C0-\u024F\u0980-\u09FF]+(?:-[a-z0-9\u00C0-\u024F\u0980-\u09FF]+)*/gi) || [];
  return rawTokens.filter((token) => token.length >= 2 && !STOPWORDS.has(token.toLowerCase()));
}

export function parseHtmlPage(html: string, pageUrl: string): ParsedPageData {
  const $ = cheerio.load(html);

  // 1. Extract canonical URL if present
  let canonicalUrl = $('link[rel="canonical"]').attr('href') || null;
  if (canonicalUrl) {
    const res = resolveRelativeUrl(canonicalUrl, pageUrl);
    canonicalUrl = res.isValid ? res.normalizedUrl : null;
  }

  // 2. Extract title
  let title = $('title').first().text().trim();
  if (!title) {
    title = $('meta[property="og:title"]').attr('content')?.trim() ||
            $('meta[name="twitter:title"]').attr('content')?.trim() ||
            $('h1').first().text().trim() ||
            'Untitled Document';
  }
  // Clean excessive whitespace in title
  title = title.replace(/\s+/g, ' ');

  // 3. Extract description
  let description = $('meta[name="description"]').attr('content')?.trim() ||
                    $('meta[property="og:description"]').attr('content')?.trim() ||
                    $('meta[name="twitter:description"]').attr('content')?.trim() ||
                    '';
  description = description.replace(/\s+/g, ' ');

  // 4. Extract language
  let language = $('html').attr('lang')?.trim() ||
                 $('meta[http-equiv="content-language"]').attr('content')?.trim() ||
                 'en';
  if (language.includes('-')) {
    language = language.split('-')[0].toLowerCase();
  }

  // 5. Extract publication time
  const publishedAt = $('meta[property="article:published_time"]').attr('content') ||
                      $('meta[name="publication_date"]').attr('content') ||
                      $('meta[name="date"]').attr('content') ||
                      $('time').attr('datetime') ||
                      null;

  // 6. Extract Headings
  const headings = {
    h1: [] as string[],
    h2: [] as string[],
    h3: [] as string[],
  };

  $('h1').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 2 && !headings.h1.includes(text)) {
      headings.h1.push(text);
    }
  });

  $('h2').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 2 && !headings.h2.includes(text) && headings.h2.length < 15) {
      headings.h2.push(text);
    }
  });

  $('h3').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 2 && !headings.h3.includes(text) && headings.h3.length < 20) {
      headings.h3.push(text);
    }
  });

  // 7. Extract links before stripping elements
  const discoveredLinks = new Set<string>();
  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href')?.trim();
    if (!rawHref) return;

    // Skip javascript:, mailto:, tel:, anchor-only links
    if (
      rawHref.startsWith('#') ||
      rawHref.startsWith('javascript:') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('tel:') ||
      rawHref.startsWith('data:')
    ) {
      return;
    }

    const resolved = resolveRelativeUrl(rawHref, pageUrl);
    if (!resolved.isValid) return;

    // Check media file extension
    try {
      const parsedPath = new URL(resolved.normalizedUrl).pathname.toLowerCase();
      const dotIdx = parsedPath.lastIndexOf('.');
      if (dotIdx !== -1) {
        const ext = parsedPath.slice(dotIdx);
        if (IGNORED_EXTENSIONS.has(ext)) {
          return;
        }
      }
    } catch {
      return;
    }

    // SSRF safety check
    const safety = validateUrlSafety(resolved.normalizedUrl);
    if (!safety.valid) return;

    discoveredLinks.add(resolved.normalizedUrl);
  });

  // 8. Strip boilerplate and noisy elements for main textual content
  $(
    'script, style, noscript, iframe, svg, canvas, audio, video, ' +
    'nav, header, footer, aside, form, dialog, .nav, .menu, .sidebar, ' +
    '.footer, .header, .ad, .advertisement, [aria-hidden="true"]'
  ).remove();

  // Extract clean text
  const mainText = ($('main').length ? $('main').text() : $('article').length ? $('article').text() : $('body').text())
    .replace(/\s+/g, ' ')
    .trim();

  // If no meta description, create a concise snippet from main text
  if (!description && mainText) {
    description = mainText.slice(0, 180).trim() + (mainText.length > 180 ? '...' : '');
  }

  // Tokenize title, headings, and body
  const allTextForTokens = `${title} ${headings.h1.join(' ')} ${headings.h2.join(' ')} ${description} ${mainText}`;
  const tokens = tokenizeText(allTextForTokens);

  // Calculate term frequencies
  const termFrequencies: Record<string, number> = {};
  for (const t of tokens) {
    termFrequencies[t] = (termFrequencies[t] || 0) + 1;
  }

  // Compute deterministic content hash for duplicate detection
  const contentHash = crypto.createHash('sha256').update(mainText.slice(0, 10000)).digest('hex');

  return {
    title,
    description: description.slice(0, 300),
    canonicalUrl,
    language,
    headings,
    contentPreview: mainText.slice(0, 320),
    fullText: mainText.slice(0, 50000), // Cap stored textual index for efficiency
    tokens,
    termFrequencies,
    docLength: tokens.length,
    contentHash,
    links: Array.from(discoveredLinks).slice(0, 100), // Politeness limit per page
    publishedAt,
    contentType: 'text/html',
  };
}
