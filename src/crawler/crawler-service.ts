/**
 * NexVora Production Crawler Worker Engine
 * Multi-worker ready, polite domain rate-limiting, robots.txt compliance,
 * SSRF-safe fetching, SHA-256 deduplication, link discovery, and sitemap parsing.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { categorizeDocument } from './categorizer.ts';
import { parseHtmlPage } from './parser.ts';
import { robotsManager } from './robots.ts';
import { parseSitemapXml } from './sitemap.ts';
import { dbService } from '../database/db.ts';
import { CrawlFrontierRecord, IndexedPageRecord } from '../database/schema.ts';
import { searchEngine } from '../indexer/search-engine.ts';
import { normalizeUrl } from '../lib/url-normalizer.ts';
import { assertSafeDns, validateUrlSafety } from '../security/ssrf.ts';

const USER_AGENT = 'NexVoraBot/1.0 (+https://github.com/nexvora-search; privacy-first search engine; no-ai)';
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5 MB limit
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

export class CrawlerService {
  private isRunning = false;
  private workerId: string;
  private lastDomainCrawlTime: Map<string, number> = new Map();
  private activeDomainLocks: Set<string> = new Set();
  private maxDepth = 3;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Runs a crawl tick: leases a batch of frontier URLs and processes them politely
   */
  public async processBatch(batchSize = 5): Promise<{ processed: number; indexed: number; errors: number }> {
    let processed = 0;
    let indexed = 0;
    let errors = 0;

    const batch = await dbService.leaseFrontierBatch(this.workerId, batchSize);
    if (batch.length === 0) {
      return { processed: 0, indexed: 0, errors: 0 };
    }

    for (const job of batch) {
      processed++;
      try {
        const result = await this.crawlSingleUrl(job);
        if (result.success && result.isIndexed) {
          indexed++;
        } else if (!result.success) {
          errors++;
        }
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Crawler] Unhandled error crawling ${job.url}:`, msg);
        await dbService.completeFrontierJob(job.normalizedUrl, 'failed', {
          errorInfo: msg,
        });
      }
    }

    // Refresh in-memory search index if new pages were indexed
    if (indexed > 0) {
      await searchEngine.refreshIndex();
      this.updateGeneratedRegistries().catch((e) => console.warn('[Generated] Error writing files:', e));
    }

    return { processed, indexed, errors };
  }

  /**
   * Crawls a single URL respecting robots.txt, politeness, and safety
   */
  public async crawlSingleUrl(job: CrawlFrontierRecord): Promise<{ success: boolean; isIndexed: boolean }> {
    const { url, normalizedUrl, domain, depth, category: sourceCategory } = job;

    // 1. SSRF Safety Check
    const safety = validateUrlSafety(url);
    if (!safety.valid || !safety.parsedUrl) {
      await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
        errorInfo: safety.reason || 'SSRF safety check failed',
      });
      return { success: false, isIndexed: false };
    }

    // 2. DNS Resolution Safety Check
    const safeDns = await assertSafeDns(safety.parsedUrl.hostname);
    if (!safeDns) {
      await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
        errorInfo: 'DNS resolved to private or unroutable IP range',
      });
      return { success: false, isIndexed: false };
    }

    // 3. Robots.txt Check & Politeness Delay
    const robots = await this.ensureDomainRobots(domain, safety.parsedUrl.origin);
    const pathToCheck = safety.parsedUrl.pathname + safety.parsedUrl.search;
    if (!robotsManager.isAllowed(pathToCheck, robots)) {
      await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
        errorInfo: 'Blocked by robots.txt',
      });
      return { success: false, isIndexed: false };
    }

    // Politeness crawl-delay enforcement
    await this.enforcePoliteness(domain, robots.crawlDelayMs);

    // 4. Fetch the webpage
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      this.activeDomainLocks.add(domain);
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);
      this.lastDomainCrawlTime.set(domain, Date.now());

      const status = response.status;

      // Handle HTTP errors / redirects / rate limits
      if (status === 429 || status === 503) {
        // Retry-After logic
        const retryAfterHeader = response.headers.get('retry-after');
        let delaySec = 60;
        if (retryAfterHeader) {
          const parsedSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSec)) delaySec = Math.min(parsedSec, 3600);
        }
        const nextCrawl = new Date(Date.now() + delaySec * 1000).toISOString();
        await dbService.completeFrontierJob(normalizedUrl, 'retry', {
          httpStatus: status,
          errorInfo: `Rate limited (HTTP ${status})`,
          nextCrawlAt: nextCrawl,
        });
        return { success: false, isIndexed: false };
      }

      if (!response.ok) {
        // Schedule retry with exponential backoff if retry_count < 3
        const retryCount = job.retryCount || 0;
        if (retryCount < 3) {
          const backoffMinutes = Math.pow(3, retryCount + 1); // 3m, 9m, 27m
          const nextCrawl = new Date(Date.now() + backoffMinutes * 60000).toISOString();
          await dbService.completeFrontierJob(normalizedUrl, 'retry', {
            httpStatus: status,
            errorInfo: `HTTP ${status}`,
            nextCrawlAt: nextCrawl,
          });
        } else {
          await dbService.completeFrontierJob(normalizedUrl, 'failed', {
            httpStatus: status,
            errorInfo: `Failed with HTTP ${status} after max retries`,
          });
        }
        return { success: false, isIndexed: false };
      }

      // Check Content-Type (must be HTML or XML)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('xml')) {
        await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
          httpStatus: status,
          errorInfo: `Ignored non-HTML content type: ${contentType}`,
        });
        return { success: false, isIndexed: false };
      }

      // Check Content-Length header
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader && parseInt(contentLengthHeader, 10) > MAX_CONTENT_LENGTH) {
        await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
          httpStatus: status,
          errorInfo: `Content size exceeded limit: ${contentLengthHeader} bytes`,
        });
        return { success: false, isIndexed: false };
      }

      // Read text with size ceiling
      const text = await response.text();
      if (text.length > MAX_CONTENT_LENGTH) {
        await dbService.completeFrontierJob(normalizedUrl, 'blocked', {
          httpStatus: status,
          errorInfo: 'Payload size exceeded 5MB',
        });
        return { success: false, isIndexed: false };
      }

      // 5. Parse the HTML Page
      const parsedData = parseHtmlPage(text, response.url || url);

      // Check Canonical URL duplicate
      if (parsedData.canonicalUrl && parsedData.canonicalUrl !== normalizedUrl) {
        // Enqueue canonical URL if safe
        const canonNorm = normalizeUrl(parsedData.canonicalUrl);
        if (canonNorm.isValid) {
          await dbService.enqueueFrontier([
            {
              id: canonNorm.hash.slice(0, 16),
              url: canonNorm.normalizedUrl,
              normalizedUrl: canonNorm.normalizedUrl,
              domain: canonNorm.domain,
              source: `canonical_from:${normalizedUrl}`,
              category: sourceCategory,
              priority: Math.max(1, job.priority - 1),
              depth: depth + 1,
              status: 'pending',
              discoveredAt: new Date().toISOString(),
              retryCount: 0,
            },
          ]);
        }
      }

      // Check SHA-256 Exact Content Duplicate
      const isDuplicate = await dbService.isContentHashDuplicate(parsedData.contentHash, normalizedUrl);
      if (isDuplicate) {
        await dbService.completeFrontierJob(normalizedUrl, 'indexed', {
          httpStatus: status,
          canonicalUrl: parsedData.canonicalUrl,
          contentHash: parsedData.contentHash,
          errorInfo: 'Duplicate content hash; aliased to existing page',
        });
        return { success: true, isIndexed: false };
      }

      // 6. Automatic Categorization
      const headingsJoined = [
        ...parsedData.headings.h1,
        ...parsedData.headings.h2,
        ...parsedData.headings.h3,
      ].join(' ');

      const catResult = categorizeDocument(
        normalizedUrl,
        domain,
        parsedData.title,
        headingsJoined,
        parsedData.contentPreview,
        sourceCategory
      );

      // 7. Save Indexed Page in persistent database
      const indexedRecord: IndexedPageRecord = {
        id: crypto.createHash('md5').update(normalizedUrl).digest('hex'),
        url: response.url || url,
        normalizedUrl,
        domain,
        title: parsedData.title,
        description: parsedData.description,
        canonicalUrl: parsedData.canonicalUrl,
        headings: parsedData.headings,
        contentPreview: parsedData.contentPreview,
        tokens: parsedData.tokens,
        termFrequencies: parsedData.termFrequencies,
        docLength: parsedData.docLength,
        language: parsedData.language,
        categories: catResult.categories,
        topics: catResult.topics,
        contentHash: parsedData.contentHash,
        indexedAt: new Date().toISOString(),
        lastModified: response.headers.get('last-modified') || parsedData.publishedAt,
      };

      await dbService.saveIndexedPage(indexedRecord);

      // 8. Discover and enqueue new URLs if within maxDepth
      if (depth < this.maxDepth && parsedData.links.length > 0) {
        const newFrontierEntries: CrawlFrontierRecord[] = [];
        const seen = new Set<string>();

        for (const link of parsedData.links) {
          const norm = normalizeUrl(link);
          if (!norm.isValid || seen.has(norm.normalizedUrl)) continue;
          seen.add(norm.normalizedUrl);

          // Internal links have higher priority than external links
          const isInternal = norm.domain === domain;
          const linkPriority = isInternal ? Math.max(1, job.priority - 1) : Math.max(1, job.priority - 2);

          newFrontierEntries.push({
            id: norm.hash.slice(0, 16),
            url: link,
            normalizedUrl: norm.normalizedUrl,
            domain: norm.domain,
            source: `discovered_from:${normalizedUrl}`,
            category: isInternal ? catResult.primaryCategory : 'General',
            priority: linkPriority,
            depth: depth + 1,
            status: 'pending',
            discoveredAt: new Date().toISOString(),
            retryCount: 0,
          });
        }

        if (newFrontierEntries.length > 0) {
          await dbService.enqueueFrontier(newFrontierEntries);
        }
      }

      // 9. Mark Job Completed & Schedule Recrawl (e.g. 7 days or based on headers)
      const nextCrawlDays = 7;
      const nextCrawlAt = new Date(Date.now() + nextCrawlDays * 24 * 3600 * 1000).toISOString();

      await dbService.completeFrontierJob(normalizedUrl, 'indexed', {
        httpStatus: status,
        canonicalUrl: parsedData.canonicalUrl,
        contentHash: parsedData.contentHash,
        nextCrawlAt,
      });

      return { success: true, isIndexed: true };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const msg = isAbort ? 'Request timed out' : err instanceof Error ? err.message : String(err);

      await dbService.completeFrontierJob(normalizedUrl, 'failed', {
        errorInfo: msg,
      });
      return { success: false, isIndexed: false };
    } finally {
      this.activeDomainLocks.delete(domain);
    }
  }

  /**
   * Fetches or retrieves cached robots.txt for domain
   */
  private async ensureDomainRobots(domain: string, origin: string): Promise<any> {
    const cached = robotsManager.getCached(domain);
    if (cached) return cached;

    // Check DB cache
    const dbDomain = await dbService.getDomain(domain);
    if (dbDomain && dbDomain.robotsTxt) {
      const parsed = robotsManager.parse(dbDomain.robotsTxt, domain);
      robotsManager.setCache(domain, parsed);
      return parsed;
    }

    // Fetch live robots.txt
    try {
      const robotsUrl = `${origin}/robots.txt`;
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });

      let rawText = '';
      if (res.ok) {
        rawText = await res.text();
      }

      const parsed = robotsManager.parse(rawText, domain);
      robotsManager.setCache(domain, parsed);

      await dbService.upsertDomain({
        domain,
        robotsTxt: rawText,
        crawlDelayMs: parsed.crawlDelayMs,
        lastCrawledAt: new Date().toISOString(),
        sitemaps: parsed.sitemaps,
        updatedAt: new Date().toISOString(),
      });

      // If sitemaps were declared in robots.txt, enqueue them for discovery
      if (parsed.sitemaps.length > 0) {
        this.discoverSitemaps(parsed.sitemaps, domain).catch((e) =>
          console.warn('[Sitemap] Background sitemap error:', e)
        );
      }

      return parsed;
    } catch {
      // Default fallback if robots.txt is unreachable
      const fallback = robotsManager.parse('', domain);
      robotsManager.setCache(domain, fallback);
      return fallback;
    }
  }

  /**
   * Discovers and parses sitemap.xml files
   */
  public async discoverSitemaps(sitemapUrls: string[], domain: string): Promise<number> {
    let discoveredCount = 0;

    for (const smUrl of sitemapUrls.slice(0, 3)) {
      try {
        const safety = validateUrlSafety(smUrl);
        if (!safety.valid) continue;

        const res = await fetch(smUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;
        const xml = await res.text();
        const parsed = parseSitemapXml(xml);

        // Enqueue discovered URLs
        const entries: CrawlFrontierRecord[] = parsed.urls.slice(0, 50).map((u) => ({
          id: crypto.createHash('sha256').update(u.normalizedUrl).digest('hex').slice(0, 16),
          url: u.url,
          normalizedUrl: u.normalizedUrl,
          domain: u.domain,
          source: `sitemap:${smUrl}`,
          category: 'General',
          priority: Math.round((u.priority || 0.5) * 8),
          depth: 1,
          status: 'pending',
          discoveredAt: new Date().toISOString(),
          retryCount: 0,
        }));

        if (entries.length > 0) {
          discoveredCount += await dbService.enqueueFrontier(entries);
        }
      } catch (err) {
        console.warn(`[Sitemap] Failed to parse sitemap ${smUrl}:`, err);
      }
    }

    return discoveredCount;
  }

  /**
   * Enforces politeness crawl-delay per domain
   */
  private async enforcePoliteness(domain: string, requiredDelayMs: number): Promise<void> {
    const lastTime = this.lastDomainCrawlTime.get(domain) || 0;
    const elapsed = Date.now() - lastTime;
    const waitMs = Math.max(0, requiredDelayMs - elapsed);

    if (waitMs > 0 && waitMs <= 10000) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  /**
   * Updates lightweight generated metadata files in generated/
   * (categories, topics, domains, manifests)
   */
  public async updateGeneratedRegistries(): Promise<void> {
    const pages = await dbService.getAllIndexedPages();
    if (pages.length === 0) return;

    const baseDir = path.resolve(process.cwd(), 'generated');

    // 1. Group by Categories
    const categoryMap = new Map<string, string[]>();
    // 2. Group by Topics
    const topicMap = new Map<string, string[]>();
    // 3. Group by Domains
    const domainMap = new Map<string, string[]>();
    // 4. Group by Languages
    const langMap = new Map<string, string[]>();

    for (const p of pages) {
      for (const cat of p.categories || []) {
        let list = categoryMap.get(cat);
        if (!list) {
          list = [];
          categoryMap.set(cat, list);
        }
        list.push(`${p.normalizedUrl} | ${p.title.replace(/\|/g, '-')}`);
      }

      for (const top of p.topics || []) {
        let list = topicMap.get(top);
        if (!list) {
          list = [];
          topicMap.set(top, list);
        }
        list.push(`${p.normalizedUrl} | ${p.title.replace(/\|/g, '-')}`);
      }

      let dList = domainMap.get(p.domain);
      if (!dList) {
        dList = [];
        domainMap.set(p.domain, dList);
      }
      dList.push(`${p.normalizedUrl} | ${p.title.replace(/\|/g, '-')}`);

      const lang = p.language || 'en';
      let lList = langMap.get(lang);
      if (!lList) {
        lList = [];
        langMap.set(lang, lList);
      }
      lList.push(p.normalizedUrl);
    }

    // Write category files
    const catDir = path.join(baseDir, 'categories');
    if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
    for (const [cat, urls] of categoryMap) {
      const fileName = `${cat.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.txt`;
      fs.writeFileSync(path.join(catDir, fileName), urls.join('\n') + '\n', 'utf-8');
    }

    // Write top topic files
    const topDir = path.join(baseDir, 'topics');
    if (!fs.existsSync(topDir)) fs.mkdirSync(topDir, { recursive: true });
    for (const [top, urls] of topicMap) {
      if (urls.length >= 2) {
        const fileName = `${top.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.txt`;
        fs.writeFileSync(path.join(topDir, fileName), urls.join('\n') + '\n', 'utf-8');
      }
    }

    // Write top domain files
    const domDir = path.join(baseDir, 'domains');
    if (!fs.existsSync(domDir)) fs.mkdirSync(domDir, { recursive: true });
    for (const [dom, urls] of domainMap) {
      const fileName = `${dom.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}.txt`;
      fs.writeFileSync(path.join(domDir, fileName), urls.join('\n') + '\n', 'utf-8');
    }

    // Write manifest
    const manDir = path.join(baseDir, 'manifests');
    if (!fs.existsSync(manDir)) fs.mkdirSync(manDir, { recursive: true });
    const manifest = {
      engine: 'NexVora Search Index Manifest',
      generatedAt: new Date().toISOString(),
      totalPages: pages.length,
      categoriesCount: categoryMap.size,
      domainsCount: domainMap.size,
      languagesCount: langMap.size,
      version: '1.0.0',
    };
    fs.writeFileSync(path.join(manDir, 'index-summary.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  }
}

export const crawlerService = new CrawlerService();
