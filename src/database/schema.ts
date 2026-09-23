/**
 * NexVora Database Schema & Type Definitions
 */

export interface SourceFileRecord {
  id: string;
  filePath: string;
  category: string;
  urlCount: number;
  lastSyncedAt: string;
  fileHash: string;
}

export interface SourceUrlRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceFile: string;
  category: string;
  addedAt: string;
  isActive: boolean;
}

export type FrontierStatus = 'pending' | 'crawling' | 'indexed' | 'scheduled' | 'retry' | 'failed' | 'blocked';

export interface CrawlFrontierRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  source: string;
  category: string;
  priority: number; // 1 (lowest) - 10 (highest)
  depth: number;
  status: FrontierStatus;
  discoveredAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastCrawledAt?: string | null;
  nextCrawlAt?: string | null;
  retryCount: number;
  httpStatus?: number | null;
  canonicalUrl?: string | null;
  contentHash?: string | null;
  errorInfo?: string | null;
  workerId?: string | null;
  leaseExpiresAt?: number | null; // epoch ms
}

export interface IndexedPageRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  description: string;
  canonicalUrl: string | null;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  contentPreview: string;
  tokens: string[];
  termFrequencies: Record<string, number>;
  docLength: number;
  language: string;
  categories: string[];
  topics: string[];
  contentHash: string;
  indexedAt: string;
  lastModified?: string | null;
}

export interface DomainRecord {
  domain: string;
  robotsTxt?: string | null;
  crawlDelayMs: number;
  lastCrawledAt?: string | null;
  sitemaps?: string[];
  updatedAt: string;
}

export interface QueryStatRecord {
  query: string;
  count: number;
  lastQueriedAt: string;
}

export interface SystemStats {
  totalSources: number;
  totalSourceUrls: number;
  totalFrontier: number;
  pendingFrontier: number;
  indexedPages: number;
  failedPages: number;
  domainsTracked: number;
  categories: Record<string, number>;
  storageType: 'postgresql' | 'local_persistent';
}
