/**
 * NexVora Unified Storage Engine
 * Supports PostgreSQL for production, with resilient local persistent JSON fallback.
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {
  CrawlFrontierRecord,
  DomainRecord,
  FrontierStatus,
  IndexedPageRecord,
  QueryStatRecord,
  SourceFileRecord,
  SourceUrlRecord,
  SystemStats,
} from './schema.ts';

const { Pool } = pg;

export class DatabaseService {
  private pgPool: pg.Pool | null = null;
  private isPostgres = false;
  private localDataPath: string;

  // In-memory working copies synchronized with local storage file
  private sourceFiles: Map<string, SourceFileRecord> = new Map();
  private sourceUrls: Map<string, SourceUrlRecord> = new Map();
  private frontier: Map<string, CrawlFrontierRecord> = new Map();
  private indexed: Map<string, IndexedPageRecord> = new Map();
  private domains: Map<string, DomainRecord> = new Map();
  private queryStats: Map<string, QueryStatRecord> = new Map();
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.localDataPath = path.resolve(process.cwd(), 'data', 'nexvora_store.json');
  }

  public async initialize(): Promise<void> {
    const dbUrl = process.env.DATABASE_URL;

    if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
      try {
        console.log('[DB] Connecting to PostgreSQL database...');
        this.pgPool = await this.connectWithSslFallback(dbUrl);
        this.isPostgres = true;
        console.log('[DB] PostgreSQL connected successfully. Initializing schemas...');
        await this.runPgMigrations();
        return;
      } catch (err) {
        console.warn('[DB] Failed to connect to PostgreSQL. Falling back to local persistent storage adapter.', err);
        this.isPostgres = false;
      }
    }

    // Initialize local persistent storage
    this.initLocalStorage();
  }

  /**
   * Resilient PostgreSQL connection pool creation:
   * Handles Render managed PostgreSQL (both external with SSL and internal Render network where SSL is disabled/not required).
   */
  private async connectWithSslFallback(dbUrl: string): Promise<pg.Pool> {
    const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
    const primarySsl = isLocalhost ? false : { rejectUnauthorized: false };

    let pool = new Pool({
      connectionString: dbUrl,
      ssl: primarySsl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

    try {
      const client = await pool.connect();
      client.release();
      return pool;
    } catch (primaryErr: any) {
      const msg = (primaryErr?.message || '').toLowerCase();
      // If server does not support SSL or SSL handshake failed, retry without SSL
      if (primarySsl && (msg.includes('does not support ssl') || msg.includes('ssl off') || msg.includes('packet size') || msg.includes('unsupported'))) {
        console.log('[DB] Retrying PostgreSQL connection without SSL (internal network mode)...');
        await pool.end().catch(() => {});
        pool = new Pool({
          connectionString: dbUrl,
          ssl: false,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 8000,
        });
        const client = await pool.connect();
        client.release();
        return pool;
      }
      throw primaryErr;
    }
  }

  private lastLocalFileMtime = 0;

  private initLocalStorage(): void {
    try {
      const dataDir = path.dirname(this.localDataPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.localDataPath)) {
        const stats = fs.statSync(this.localDataPath);
        this.lastLocalFileMtime = stats.mtimeMs;
        const raw = fs.readFileSync(this.localDataPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.sourceFiles) Object.entries(parsed.sourceFiles).forEach(([k, v]) => this.sourceFiles.set(k, v as SourceFileRecord));
        if (parsed.sourceUrls) Object.entries(parsed.sourceUrls).forEach(([k, v]) => this.sourceUrls.set(k, v as SourceUrlRecord));
        if (parsed.frontier) Object.entries(parsed.frontier).forEach(([k, v]) => this.frontier.set(k, v as CrawlFrontierRecord));
        if (parsed.indexed) Object.entries(parsed.indexed).forEach(([k, v]) => this.indexed.set(k, v as IndexedPageRecord));
        if (parsed.domains) Object.entries(parsed.domains).forEach(([k, v]) => this.domains.set(k, v as DomainRecord));
        if (parsed.queryStats) Object.entries(parsed.queryStats).forEach(([k, v]) => this.queryStats.set(k, v as QueryStatRecord));
        console.log(`[DB] Local persistent store loaded (${this.indexed.size} indexed pages, ${this.frontier.size} frontier URLs).`);
      } else {
        this.flushLocalStorage();
        console.log('[DB] Initialized fresh local persistent store at:', this.localDataPath);
      }
    } catch (err) {
      console.error('[DB] Error loading local storage:', err);
    }
  }

  public reloadLocalStorageIfChanged(): void {
    if (this.isPostgres) return;
    try {
      if (fs.existsSync(this.localDataPath)) {
        const stats = fs.statSync(this.localDataPath);
        if (stats.mtimeMs > this.lastLocalFileMtime) {
          this.initLocalStorage();
        }
      }
    } catch {}
  }

  private scheduleLocalWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flushLocalStorage();
    }, 1500);
  }

  private flushLocalStorage(): void {
    try {
      const dataDir = path.dirname(this.localDataPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const payload = {
        sourceFiles: Object.fromEntries(this.sourceFiles),
        sourceUrls: Object.fromEntries(this.sourceUrls),
        frontier: Object.fromEntries(this.frontier),
        indexed: Object.fromEntries(this.indexed),
        domains: Object.fromEntries(this.domains),
        queryStats: Object.fromEntries(this.queryStats),
        lastSaved: new Date().toISOString(),
      };

      const tempPath = `${this.localDataPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.localDataPath);
    } catch (err) {
      console.error('[DB] Failed to flush local storage to disk:', err);
    }
  }

  private async runPgMigrations(): Promise<void> {
    if (!this.pgPool) return;

    const migrationSql = `
      CREATE TABLE IF NOT EXISTS source_files (
        id VARCHAR(128) PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        category VARCHAR(64) NOT NULL,
        url_count INT DEFAULT 0,
        last_synced_at TIMESTAMPTZ DEFAULT NOW(),
        file_hash VARCHAR(64) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_urls (
        id VARCHAR(128) PRIMARY KEY,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL UNIQUE,
        domain VARCHAR(255) NOT NULL,
        source_file TEXT NOT NULL,
        category VARCHAR(64) NOT NULL,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS crawl_frontier (
        id VARCHAR(128) PRIMARY KEY,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL UNIQUE,
        domain VARCHAR(255) NOT NULL,
        source TEXT NOT NULL,
        category VARCHAR(64) NOT NULL,
        priority INT DEFAULT 5,
        depth INT DEFAULT 0,
        status VARCHAR(32) DEFAULT 'pending',
        discovered_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        last_crawled_at TIMESTAMPTZ,
        next_crawl_at TIMESTAMPTZ,
        retry_count INT DEFAULT 0,
        http_status INT,
        canonical_url TEXT,
        content_hash VARCHAR(64),
        error_info TEXT,
        worker_id VARCHAR(64),
        lease_expires_at BIGINT
      );

      CREATE INDEX IF NOT EXISTS idx_frontier_status_prio ON crawl_frontier(status, priority DESC, next_crawl_at);
      CREATE INDEX IF NOT EXISTS idx_frontier_domain ON crawl_frontier(domain);

      CREATE TABLE IF NOT EXISTS indexed_pages (
        id VARCHAR(128) PRIMARY KEY,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL UNIQUE,
        domain VARCHAR(255) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        canonical_url TEXT,
        headings JSONB,
        content_preview TEXT,
        tokens JSONB,
        term_frequencies JSONB,
        doc_length INT DEFAULT 0,
        language VARCHAR(16) DEFAULT 'en',
        categories JSONB,
        topics JSONB,
        content_hash VARCHAR(64) NOT NULL,
        indexed_at TIMESTAMPTZ DEFAULT NOW(),
        last_modified TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_indexed_domain ON indexed_pages(domain);
      CREATE INDEX IF NOT EXISTS idx_indexed_content_hash ON indexed_pages(content_hash);

      CREATE TABLE IF NOT EXISTS domains (
        domain VARCHAR(255) PRIMARY KEY,
        robots_txt TEXT,
        crawl_delay_ms INT DEFAULT 1000,
        last_crawled_at TIMESTAMPTZ,
        sitemaps JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS query_stats (
        query VARCHAR(255) PRIMARY KEY,
        count INT DEFAULT 1,
        last_queried_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await this.pgPool.query(migrationSql);
    console.log('[DB] PostgreSQL migrations applied successfully.');
  }

  // --- Source Files & Seed Operations ---

  public async upsertSourceFile(record: SourceFileRecord): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO source_files (id, file_path, category, url_count, last_synced_at, file_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
          file_path = EXCLUDED.file_path,
          category = EXCLUDED.category,
          url_count = EXCLUDED.url_count,
          last_synced_at = EXCLUDED.last_synced_at,
          file_hash = EXCLUDED.file_hash`,
        [record.id, record.filePath, record.category, record.urlCount, record.lastSyncedAt, record.fileHash]
      );
    } else {
      this.sourceFiles.set(record.id, record);
      this.scheduleLocalWrite();
    }
  }

  public async getSourceFiles(): Promise<SourceFileRecord[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM source_files ORDER BY file_path ASC');
      return res.rows.map((r) => ({
        id: r.id,
        filePath: r.file_path,
        category: r.category,
        urlCount: r.url_count,
        lastSyncedAt: r.last_synced_at.toISOString(),
        fileHash: r.file_hash,
      }));
    }
    return Array.from(this.sourceFiles.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  public async upsertSourceUrl(record: SourceUrlRecord): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO source_urls (id, url, normalized_url, domain, source_file, category, added_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (normalized_url) DO UPDATE SET
          source_file = EXCLUDED.source_file,
          category = EXCLUDED.category,
          is_active = EXCLUDED.is_active`,
        [record.id, record.url, record.normalizedUrl, record.domain, record.sourceFile, record.category, record.addedAt, record.isActive]
      );
    } else {
      this.sourceUrls.set(record.normalizedUrl, record);
      this.scheduleLocalWrite();
    }
  }

  public async deleteSourceFile(filePath: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query('DELETE FROM source_files WHERE file_path = $1', [filePath]);
      await this.pgPool.query('UPDATE source_urls SET is_active = FALSE WHERE source_file = $1', [filePath]);
      await this.pgPool.query(
        "UPDATE crawl_frontier SET status = 'failed', last_error = 'Source file deleted' WHERE source = $1 AND status = 'pending'",
        [`seed:${filePath}`]
      );
    } else {
      this.reloadLocalStorageIfChanged();
      for (const [id, f] of this.sourceFiles.entries()) {
        if (f.filePath === filePath) {
          this.sourceFiles.delete(id);
        }
      }
      for (const [url, u] of this.sourceUrls.entries()) {
        if (u.sourceFile === filePath) {
          u.isActive = false;
          this.sourceUrls.set(url, u);
        }
      }
      for (const [url, f] of this.frontier.entries()) {
        if (f.source === `seed:${filePath}` && f.status === 'pending') {
          f.status = 'failed';
          f.errorInfo = 'Source file deleted';
          this.frontier.set(url, f);
        }
      }
      this.scheduleLocalWrite();
    }
  }

  public async deactivateRemovedUrlsForFile(filePath: string, activeNormalizedUrls: Set<string>): Promise<number> {
    let deactivated = 0;
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT normalized_url FROM source_urls WHERE source_file = $1 AND is_active = TRUE', [filePath]);
      for (const row of res.rows) {
        if (!activeNormalizedUrls.has(row.normalized_url)) {
          await this.pgPool.query('UPDATE source_urls SET is_active = FALSE WHERE normalized_url = $1', [row.normalized_url]);
          await this.pgPool.query(
            "UPDATE crawl_frontier SET status = 'failed', last_error = 'Removed from source' WHERE normalized_url = $1 AND status = 'pending'",
            [row.normalized_url]
          );
          deactivated++;
        }
      }
    } else {
      this.reloadLocalStorageIfChanged();
      for (const [url, u] of this.sourceUrls.entries()) {
        if (u.sourceFile === filePath && u.isActive && !activeNormalizedUrls.has(u.normalizedUrl)) {
          u.isActive = false;
          this.sourceUrls.set(url, u);
          const f = this.frontier.get(url);
          if (f && f.status === 'pending') {
            f.status = 'failed';
            f.errorInfo = 'Removed from source';
            this.frontier.set(url, f);
          }
          deactivated++;
        }
      }
      if (deactivated > 0) {
        this.scheduleLocalWrite();
      }
    }
    return deactivated;
  }

  public async getSourceUrlsForFile(filePath: string): Promise<SourceUrlRecord[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM source_urls WHERE source_file = $1', [filePath]);
      return res.rows.map((r) => ({
        id: r.id,
        url: r.url,
        normalizedUrl: r.normalized_url,
        domain: r.domain,
        sourceFile: r.source_file,
        category: r.category,
        addedAt: r.added_at.toISOString(),
        isActive: r.is_active,
      }));
    }
    this.reloadLocalStorageIfChanged();
    return Array.from(this.sourceUrls.values()).filter((u) => u.sourceFile === filePath);
  }

  // --- Crawl Frontier Operations ---

  public async enqueueFrontier(entries: CrawlFrontierRecord[]): Promise<number> {
    if (entries.length === 0) return 0;
    let addedCount = 0;

    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const entry of entries) {
          const res = await client.query(
            `INSERT INTO crawl_frontier (
              id, url, normalized_url, domain, source, category, priority, depth, status,
              discovered_at, retry_count, next_crawl_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (normalized_url) DO UPDATE SET
              priority = GREATEST(crawl_frontier.priority, EXCLUDED.priority)
            RETURNING id`,
            [
              entry.id,
              entry.url,
              entry.normalizedUrl,
              entry.domain,
              entry.source,
              entry.category,
              entry.priority,
              entry.depth,
              entry.status,
              entry.discoveredAt,
              entry.retryCount,
              entry.nextCrawlAt || null,
            ]
          );
          if (res.rowCount && res.rowCount > 0) addedCount++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      for (const entry of entries) {
        if (!this.frontier.has(entry.normalizedUrl)) {
          this.frontier.set(entry.normalizedUrl, entry);
          addedCount++;
        } else {
          // If already in frontier, boost priority if new priority is higher
          const existing = this.frontier.get(entry.normalizedUrl)!;
          if (entry.priority > existing.priority) {
            existing.priority = entry.priority;
          }
        }
      }
      this.scheduleLocalWrite();
    }

    return addedCount;
  }

  /**
   * Leases a batch of pending/scheduled URLs for crawling with heartbeat/lease timeout
   */
  public async leaseFrontierBatch(
    workerId: string,
    batchSize = 5,
    leaseDurationMs = 60000
  ): Promise<CrawlFrontierRecord[]> {
    const now = Date.now();
    const leaseExpires = now + leaseDurationMs;

    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const selectRes = await client.query(
          `SELECT * FROM crawl_frontier
           WHERE (status IN ('pending', 'scheduled', 'retry'))
              OR (status = 'crawling' AND lease_expires_at < $1)
           ORDER BY priority DESC, discovered_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [now, batchSize]
        );

        const records: CrawlFrontierRecord[] = [];
        for (const row of selectRes.rows) {
          await client.query(
            `UPDATE crawl_frontier
             SET status = 'crawling', worker_id = $1, lease_expires_at = $2, started_at = NOW()
             WHERE id = $3`,
            [workerId, leaseExpires, row.id]
          );
          records.push({
            id: row.id,
            url: row.url,
            normalizedUrl: row.normalized_url,
            domain: row.domain,
            source: row.source,
            category: row.category,
            priority: row.priority,
            depth: row.depth,
            status: 'crawling',
            discoveredAt: row.discovered_at.toISOString(),
            retryCount: row.retry_count,
            workerId,
            leaseExpiresAt: leaseExpires,
          });
        }
        await client.query('COMMIT');
        return records;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DB] Error leasing frontier batch:', err);
        return [];
      } finally {
        client.release();
      }
    }

    // Local in-memory / JSON leasing
    const candidates: CrawlFrontierRecord[] = [];
    for (const record of this.frontier.values()) {
      const isExpired = record.status === 'crawling' && (record.leaseExpiresAt || 0) < now;
      const isDue = !record.nextCrawlAt || new Date(record.nextCrawlAt).getTime() <= now;

      if ((record.status === 'pending' || record.status === 'scheduled' || record.status === 'retry' || isExpired) && isDue) {
        candidates.push(record);
      }
    }

    candidates.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    const chosen = candidates.slice(0, batchSize);

    for (const item of chosen) {
      item.status = 'crawling';
      item.workerId = workerId;
      item.leaseExpiresAt = leaseExpires;
      item.startedAt = new Date().toISOString();
    }

    if (chosen.length > 0) {
      this.scheduleLocalWrite();
    }

    return chosen;
  }

  public async completeFrontierJob(
    normalizedUrl: string,
    status: FrontierStatus,
    data: {
      httpStatus?: number;
      canonicalUrl?: string | null;
      contentHash?: string | null;
      errorInfo?: string | null;
      nextCrawlAt?: string | null;
    }
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `UPDATE crawl_frontier
         SET status = $1,
             http_status = $2,
             canonical_url = $3,
             content_hash = $4,
             error_info = $5,
             next_crawl_at = $6,
             completed_at = $7,
             last_crawled_at = $7,
             lease_expires_at = NULL,
             retry_count = CASE WHEN $1 = 'retry' THEN retry_count + 1 ELSE retry_count END
         WHERE normalized_url = $8`,
        [status, data.httpStatus, data.canonicalUrl, data.contentHash, data.errorInfo, data.nextCrawlAt, nowIso, normalizedUrl]
      );
    } else {
      const record = this.frontier.get(normalizedUrl);
      if (record) {
        record.status = status;
        record.httpStatus = data.httpStatus;
        record.canonicalUrl = data.canonicalUrl;
        record.contentHash = data.contentHash;
        record.errorInfo = data.errorInfo;
        record.nextCrawlAt = data.nextCrawlAt;
        record.completedAt = nowIso;
        record.lastCrawledAt = nowIso;
        record.leaseExpiresAt = null;
        if (status === 'retry') {
          record.retryCount = (record.retryCount || 0) + 1;
        }
        this.scheduleLocalWrite();
      }
    }
  }

  // --- Indexed Page Operations ---

  public async saveIndexedPage(page: IndexedPageRecord): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO indexed_pages (
          id, url, normalized_url, domain, title, description, canonical_url,
          headings, content_preview, tokens, term_frequencies, doc_length,
          language, categories, topics, content_hash, indexed_at, last_modified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (normalized_url) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          canonical_url = EXCLUDED.canonical_url,
          headings = EXCLUDED.headings,
          content_preview = EXCLUDED.content_preview,
          tokens = EXCLUDED.tokens,
          term_frequencies = EXCLUDED.term_frequencies,
          doc_length = EXCLUDED.doc_length,
          categories = EXCLUDED.categories,
          topics = EXCLUDED.topics,
          content_hash = EXCLUDED.content_hash,
          indexed_at = EXCLUDED.indexed_at,
          last_modified = EXCLUDED.last_modified`,
        [
          page.id,
          page.url,
          page.normalizedUrl,
          page.domain,
          page.title,
          page.description,
          page.canonicalUrl,
          JSON.stringify(page.headings),
          page.contentPreview,
          JSON.stringify(page.tokens),
          JSON.stringify(page.termFrequencies),
          page.docLength,
          page.language,
          JSON.stringify(page.categories),
          JSON.stringify(page.topics),
          page.contentHash,
          page.indexedAt,
          page.lastModified || null,
        ]
      );
    } else {
      this.indexed.set(page.normalizedUrl, page);
      this.scheduleLocalWrite();
    }
  }

  public async getAllIndexedPages(): Promise<IndexedPageRecord[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM indexed_pages');
      return res.rows.map((r) => ({
        id: r.id,
        url: r.url,
        normalizedUrl: r.normalized_url,
        domain: r.domain,
        title: r.title,
        description: r.description || '',
        canonicalUrl: r.canonical_url,
        headings: typeof r.headings === 'string' ? JSON.parse(r.headings) : r.headings,
        contentPreview: r.content_preview || '',
        tokens: typeof r.tokens === 'string' ? JSON.parse(r.tokens) : r.tokens,
        termFrequencies: typeof r.term_frequencies === 'string' ? JSON.parse(r.term_frequencies) : r.term_frequencies,
        docLength: r.doc_length,
        language: r.language,
        categories: typeof r.categories === 'string' ? JSON.parse(r.categories) : r.categories,
        topics: typeof r.topics === 'string' ? JSON.parse(r.topics) : r.topics,
        contentHash: r.content_hash,
        indexedAt: r.indexed_at.toISOString(),
        lastModified: r.last_modified ? r.last_modified.toISOString() : null,
      }));
    }
    this.reloadLocalStorageIfChanged();
    return Array.from(this.indexed.values());
  }

  public async isContentHashDuplicate(hash: string, exceptUrl?: string): Promise<boolean> {
    if (!hash) return false;

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT normalized_url FROM indexed_pages WHERE content_hash = $1 AND normalized_url != $2 LIMIT 1',
        [hash, exceptUrl || '']
      );
      return res.rows.length > 0;
    }

    for (const page of this.indexed.values()) {
      if (page.contentHash === hash && page.normalizedUrl !== exceptUrl) {
        return true;
      }
    }
    return false;
  }

  // --- Domain Metadata Operations ---

  public async getDomain(domain: string): Promise<DomainRecord | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM domains WHERE domain = $1', [domain]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        domain: r.domain,
        robotsTxt: r.robots_txt,
        crawlDelayMs: r.crawl_delay_ms,
        lastCrawledAt: r.last_crawled_at ? r.last_crawled_at.toISOString() : null,
        sitemaps: typeof r.sitemaps === 'string' ? JSON.parse(r.sitemaps) : r.sitemaps,
        updatedAt: r.updated_at.toISOString(),
      };
    }
    return this.domains.get(domain) || null;
  }

  public async upsertDomain(domainData: DomainRecord): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO domains (domain, robots_txt, crawl_delay_ms, last_crawled_at, sitemaps, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (domain) DO UPDATE SET
          robots_txt = EXCLUDED.robots_txt,
          crawl_delay_ms = EXCLUDED.crawl_delay_ms,
          last_crawled_at = EXCLUDED.last_crawled_at,
          sitemaps = EXCLUDED.sitemaps,
          updated_at = EXCLUDED.updated_at`,
        [
          domainData.domain,
          domainData.robotsTxt || null,
          domainData.crawlDelayMs,
          domainData.lastCrawledAt || null,
          JSON.stringify(domainData.sitemaps || []),
          domainData.updatedAt,
        ]
      );
    } else {
      this.domains.set(domainData.domain, domainData);
      this.scheduleLocalWrite();
    }
  }

  // --- Query Stats & Autocomplete ---

  public async recordQuery(query: string): Promise<void> {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return;

    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO query_stats (query, count, last_queried_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (query) DO UPDATE SET
          count = query_stats.count + 1,
          last_queried_at = NOW()`,
        [q]
      );
    } else {
      const existing = this.queryStats.get(q);
      if (existing) {
        existing.count += 1;
        existing.lastQueriedAt = new Date().toISOString();
      } else {
        this.queryStats.set(q, {
          query: q,
          count: 1,
          lastQueriedAt: new Date().toISOString(),
        });
      }
      this.scheduleLocalWrite();
    }
  }

  public async getQuerySuggestions(prefix: string, limit = 6): Promise<string[]> {
    const p = prefix.trim().toLowerCase();
    if (!p) return [];

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        `SELECT query FROM query_stats
         WHERE query LIKE $1
         ORDER BY count DESC
         LIMIT $2`,
        [`${p}%`, limit]
      );
      return res.rows.map((r) => r.query);
    }

    const matches: QueryStatRecord[] = [];
    for (const stat of this.queryStats.values()) {
      if (stat.query.startsWith(p)) {
        matches.push(stat);
      }
    }
    matches.sort((a, b) => b.count - a.count);
    return matches.slice(0, limit).map((m) => m.query);
  }

  // --- System Stats ---

  public async getStats(): Promise<SystemStats> {
    const categories: Record<string, number> = {};

    if (this.isPostgres && this.pgPool) {
      const [srcFiles, srcUrls, frontierTotal, frontierPending, indexedRes, failedRes, domainRes] = await Promise.all([
        this.pgPool.query('SELECT COUNT(*) FROM source_files'),
        this.pgPool.query('SELECT COUNT(*) FROM source_urls WHERE is_active = TRUE'),
        this.pgPool.query('SELECT COUNT(*) FROM crawl_frontier'),
        this.pgPool.query("SELECT COUNT(*) FROM crawl_frontier WHERE status IN ('pending', 'scheduled', 'retry')"),
        this.pgPool.query('SELECT COUNT(*) FROM indexed_pages'),
        this.pgPool.query("SELECT COUNT(*) FROM crawl_frontier WHERE status = 'failed'"),
        this.pgPool.query('SELECT COUNT(*) FROM domains'),
      ]);

      const catRes = await this.pgPool.query('SELECT categories FROM indexed_pages');
      for (const row of catRes.rows) {
        const cats: string[] = typeof row.categories === 'string' ? JSON.parse(row.categories) : row.categories || [];
        for (const c of cats) {
          categories[c] = (categories[c] || 0) + 1;
        }
      }

      return {
        totalSources: parseInt(srcFiles.rows[0].count, 10),
        totalSourceUrls: parseInt(srcUrls.rows[0].count, 10),
        totalFrontier: parseInt(frontierTotal.rows[0].count, 10),
        pendingFrontier: parseInt(frontierPending.rows[0].count, 10),
        indexedPages: parseInt(indexedRes.rows[0].count, 10),
        failedPages: parseInt(failedRes.rows[0].count, 10),
        domainsTracked: parseInt(domainRes.rows[0].count, 10),
        categories,
        storageType: 'postgresql',
      };
    }

    let pendingCount = 0;
    let failedCount = 0;
    for (const f of this.frontier.values()) {
      if (f.status === 'pending' || f.status === 'scheduled' || f.status === 'retry') pendingCount++;
      if (f.status === 'failed') failedCount++;
    }

    for (const page of this.indexed.values()) {
      for (const c of page.categories || []) {
        categories[c] = (categories[c] || 0) + 1;
      }
    }

    return {
      totalSources: this.sourceFiles.size,
      totalSourceUrls: this.sourceUrls.size,
      totalFrontier: this.frontier.size,
      pendingFrontier: pendingCount,
      indexedPages: this.indexed.size,
      failedPages: failedCount,
      domainsTracked: this.domains.size,
      categories,
      storageType: 'local_persistent',
    };
  }
}

export const dbService = new DatabaseService();
