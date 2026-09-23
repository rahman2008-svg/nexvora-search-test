/**
 * NexVora GitHub Source Synchronization Engine
 * Automatically scans GitHub source registries (sources/<Category>/<file>.txt),
 * detects added/changed/deleted files & URLs, verifies webhook HMAC signatures,
 * normalizes URLs, deduplicates, and populates the persistent crawl frontier.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { dbService } from '../database/db.ts';
import { CrawlFrontierRecord, SourceFileRecord, SourceUrlRecord } from '../database/schema.ts';
import { normalizeUrl } from '../lib/url-normalizer.ts';
import { validateUrlSafety } from '../security/ssrf.ts';

export interface SyncStats {
  scannedFiles: number;
  newFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  totalUrlsScanned: number;
  validUrlsAdded: number;
  urlsDeactivated: number;
  frontierEnqueued: number;
  hasChanges: boolean;
  errors: string[];
}

export class GitHubSyncEngine {
  private sourcesRootDir: string;

  constructor() {
    this.sourcesRootDir = path.resolve(process.cwd(), 'sources');
  }

  /**
   * Verifies GitHub Webhook HMAC-SHA256 signature.
   * GITHUB_WEBHOOK_SECRET is completely optional:
   * If not configured, webhooks are accepted safely without requiring a secret.
   */
  public verifyWebhookSignature(payloadBuffer: Buffer | string, signatureHeader?: string, secret?: string): boolean {
    const webhookSecret = secret || process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.log('[GitHub Sync] GITHUB_WEBHOOK_SECRET not set; webhook accepted as optional push notification.');
      return true;
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      console.warn('[GitHub Sync] Webhook rejected: missing or invalid sha256 prefix in header.');
      return false;
    }

    const expectedSignature = signatureHeader.slice(7);
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(payloadBuffer);
    const calculatedSignature = hmac.digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(calculatedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }

  /**
   * Scans sources/ folder (synchronized with GitHub repository).
   * Detects added, modified, renamed, and deleted files, as well as added or removed URLs.
   */
  public async syncSources(): Promise<SyncStats> {
    const stats: SyncStats = {
      scannedFiles: 0,
      newFiles: 0,
      modifiedFiles: 0,
      deletedFiles: 0,
      totalUrlsScanned: 0,
      validUrlsAdded: 0,
      urlsDeactivated: 0,
      frontierEnqueued: 0,
      hasChanges: false,
      errors: [],
    };

    if (!fs.existsSync(this.sourcesRootDir)) {
      console.warn('[GitHub Sync] Sources root directory not found at:', this.sourcesRootDir);
      return stats;
    }

    const sourceFiles = this.findAllSourceFiles(this.sourcesRootDir);
    stats.scannedFiles = sourceFiles.length;

    const currentOnDiskRelativePaths = new Set<string>();

    const existingDbFiles = await dbService.getSourceFiles();
    const existingFileMap = new Map(existingDbFiles.map((f) => [f.filePath, f]));

    const urlsToEnqueue: CrawlFrontierRecord[] = [];

    // 1. Process files present on disk
    for (const filePath of sourceFiles) {
      try {
        const relativePath = path.relative(process.cwd(), filePath).split(path.sep).join('/');
        currentOnDiskRelativePaths.add(relativePath);

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');

        // Extract category from folder name (e.g. sources/Bangladesh/education.txt -> Bangladesh)
        const pathSegments = relativePath.split('/');
        const sourcesIndex = pathSegments.indexOf('sources');
        let category = 'General';
        if (sourcesIndex !== -1 && pathSegments.length > sourcesIndex + 2) {
          category = pathSegments[sourcesIndex + 1];
        }

        const existingRecord = existingFileMap.get(relativePath);
        const isNew = !existingRecord;
        const isModified = existingRecord && existingRecord.fileHash !== fileHash;

        if (isNew) stats.newFiles++;
        if (isModified) stats.modifiedFiles++;

        // Parse URLs (one per line, ignoring comments and blanks)
        const lines = fileContent.split(/\r?\n/);
        const rawUrls: string[] = [];
        const activeNormalizedUrls = new Set<string>();

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          rawUrls.push(line);
        }

        stats.totalUrlsScanned += rawUrls.length;

        // Upsert source file metadata
        const fileRecord: SourceFileRecord = {
          id: crypto.createHash('md5').update(relativePath).digest('hex'),
          filePath: relativePath,
          category,
          urlCount: rawUrls.length,
          lastSyncedAt: new Date().toISOString(),
          fileHash,
        };
        await dbService.upsertSourceFile(fileRecord);

        // Process URLs
        for (const rawUrl of rawUrls) {
          const norm = normalizeUrl(rawUrl);
          if (!norm.isValid) {
            stats.errors.push(`Invalid URL in ${relativePath}: ${rawUrl} (${norm.error})`);
            continue;
          }

          // SSRF safety validation
          const safety = validateUrlSafety(norm.normalizedUrl);
          if (!safety.valid) {
            stats.errors.push(`Unsafe URL blocked in ${relativePath}: ${rawUrl} (${safety.reason})`);
            continue;
          }

          activeNormalizedUrls.add(norm.normalizedUrl);
          stats.validUrlsAdded++;

          // Record in source_urls
          const sourceUrlRecord: SourceUrlRecord = {
            id: norm.hash.slice(0, 16),
            url: rawUrl,
            normalizedUrl: norm.normalizedUrl,
            domain: norm.domain,
            sourceFile: relativePath,
            category,
            addedAt: new Date().toISOString(),
            isActive: true,
          };
          await dbService.upsertSourceUrl(sourceUrlRecord);

          // Add to crawl frontier queue with high priority
          urlsToEnqueue.push({
            id: norm.hash.slice(0, 16),
            url: norm.normalizedUrl,
            normalizedUrl: norm.normalizedUrl,
            domain: norm.domain,
            source: `seed:${relativePath}`,
            category,
            priority: 9,
            depth: 0,
            status: 'pending',
            discoveredAt: new Date().toISOString(),
            retryCount: 0,
          });
        }

        // Deactivate any URLs previously active for this file that have been deleted
        const deactivatedCount = await dbService.deactivateRemovedUrlsForFile(relativePath, activeNormalizedUrls);
        if (deactivatedCount > 0) {
          stats.urlsDeactivated += deactivatedCount;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push(`Error reading source file ${filePath}: ${msg}`);
      }
    }

    // 2. Detect deleted files (present in database, but no longer on disk)
    for (const [dbPath] of existingFileMap.entries()) {
      if (dbPath.startsWith('sources/') && !currentOnDiskRelativePaths.has(dbPath)) {
        console.log(`[GitHub Sync] Detected deleted source file: ${dbPath}. Purging from active registry...`);
        await dbService.deleteSourceFile(dbPath);
        stats.deletedFiles++;
      }
    }

    if (urlsToEnqueue.length > 0) {
      stats.frontierEnqueued = await dbService.enqueueFrontier(urlsToEnqueue);
    }

    stats.hasChanges =
      stats.newFiles > 0 ||
      stats.modifiedFiles > 0 ||
      stats.deletedFiles > 0 ||
      stats.urlsDeactivated > 0 ||
      stats.frontierEnqueued > 0;

    console.log(
      `[GitHub Sync] Completed sync: ${stats.scannedFiles} files, ${stats.newFiles} new, ${stats.modifiedFiles} modified, ${stats.deletedFiles} deleted, ${stats.totalUrlsScanned} URLs, ${stats.frontierEnqueued} new seeds enqueued.`
    );
    return stats;
  }

  /**
   * Helper to write or update a file fetched from remote GitHub
   */
  public saveFileFromRemote(relativePath: string, content: string): void {
    const fullPath = path.resolve(process.cwd(), relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  /**
   * Helper to remove a deleted file locally
   */
  public deleteLocalSourceFile(relativePath: string): void {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  /**
   * Recursively finds all .txt source files
   */
  private findAllSourceFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findAllSourceFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.txt')) {
        results.push(fullPath);
      }
    }
    return results;
  }
}

export const gitHubSyncEngine = new GitHubSyncEngine();
