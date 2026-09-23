/**
 * NexVora Deterministic Robots.txt Engine
 * Parses robots.txt rules, handles User-agent matching, Crawl-delay, and Sitemaps.
 * Features TTL caching to avoid repeatedly querying servers.
 */

export interface RobotsRule {
  pathPattern: string;
  allow: boolean;
}

export interface DomainRobotsInfo {
  domain: string;
  rules: RobotsRule[];
  crawlDelayMs: number;
  sitemaps: string[];
  fetchedAt: number;
  rawText: string;
}

export class RobotsManager {
  private cache: Map<string, DomainRobotsInfo> = new Map();
  private readonly defaultCacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours
  private readonly defaultCrawlDelayMs = 1000; // 1 second polite minimum default

  /**
   * Parses raw robots.txt content into structured rules
   */
  public parse(rawText: string, domain: string): DomainRobotsInfo {
    const lines = rawText.split(/\r?\n/);
    const rules: RobotsRule[] = [];
    const sitemaps: string[] = [];
    let crawlDelayMs = this.defaultCrawlDelayMs;

    let inTargetAgent = false;
    let hasNexVoraSpecific = false;

    // First pass: check if there is an explicit 'NexVoraBot' or 'NexVora' agent section
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.toLowerCase().startsWith('user-agent:')) {
        const agent = line.slice(11).trim().toLowerCase();
        if (agent === 'nexvorabot' || agent === 'nexvora') {
          hasNexVoraSpecific = true;
          break;
        }
      }
    }

    const targetAgentPattern = hasNexVoraSpecific ? /^nexvora(bot)?$/i : /^\*$/;

    for (const rawLine of lines) {
      const cleanLine = rawLine.split('#')[0].trim();
      if (!cleanLine) continue;

      const colonIdx = cleanLine.indexOf(':');
      if (colonIdx === -1) continue;

      const directive = cleanLine.slice(0, colonIdx).trim().toLowerCase();
      const value = cleanLine.slice(colonIdx + 1).trim();

      if (directive === 'user-agent') {
        inTargetAgent = targetAgentPattern.test(value);
      } else if (directive === 'sitemap') {
        if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
          sitemaps.push(value);
        }
      } else if (inTargetAgent) {
        if (directive === 'disallow') {
          if (value === '') {
            // Empty disallow means allow all
            rules.push({ pathPattern: '/', allow: true });
          } else {
            rules.push({ pathPattern: value, allow: false });
          }
        } else if (directive === 'allow') {
          if (value) {
            rules.push({ pathPattern: value, allow: true });
          }
        } else if (directive === 'crawl-delay') {
          const delaySec = parseFloat(value);
          if (!isNaN(delaySec) && delaySec >= 0) {
            crawlDelayMs = Math.max(1000, Math.min(30000, Math.round(delaySec * 1000)));
          }
        }
      }
    }

    return {
      domain,
      rules,
      crawlDelayMs,
      sitemaps,
      fetchedAt: Date.now(),
      rawText,
    };
  }

  /**
   * Determines if a URL path is permitted by robots rules
   */
  public isAllowed(path: string, robots: DomainRobotsInfo): boolean {
    const cleanPath = path || '/';

    // If no rules specified, default to allowed
    if (!robots.rules || robots.rules.length === 0) {
      return true;
    }

    // Evaluate matching rules; longest matching prefix wins
    let bestMatch: RobotsRule | null = null;
    let longestLength = -1;

    for (const rule of robots.rules) {
      const pattern = rule.pathPattern;
      if (this.matchesPattern(cleanPath, pattern)) {
        if (pattern.length > longestLength) {
          longestLength = pattern.length;
          bestMatch = rule;
        }
      }
    }

    if (bestMatch) {
      return bestMatch.allow;
    }

    // Default allowed if no rule matches
    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (!pattern) return true;
    if (pattern === '/') return true;

    // Convert wildcards * and $ to RegExp
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${escaped}`);
    return regex.test(path);
  }

  public getCached(domain: string): DomainRobotsInfo | null {
    const cached = this.cache.get(domain);
    if (!cached) return null;
    if (Date.now() - cached.fetchedAt > this.defaultCacheTtlMs) {
      this.cache.delete(domain);
      return null;
    }
    return cached;
  }

  public setCache(domain: string, info: DomainRobotsInfo): void {
    this.cache.set(domain, info);
  }
}

export const robotsManager = new RobotsManager();
