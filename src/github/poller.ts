/**
 * NexVora GitHub Autonomous Source Poller
 * Primary automatic synchronization mechanism for NexVora Search.
 *
 * Features:
 * - Completely autonomous background polling at configurable intervals (GITHUB_POLL_INTERVAL_SEC).
 * - Zero requirement for GITHUB_WEBHOOK_SECRET or webhook setup.
 * - Ultra-efficient GitHub API usage with ETag caching (304 Not Modified) and Git Tree diffs.
 * - Detects added, modified, renamed, and deleted source .txt files and individual seed URLs.
 * - Triggers the automated sync -> crawl -> categorize -> index pipeline upon detected changes.
 * - Built-in duplicate-processing protection, retry/exponential backoff, and transparent logging.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { crawlerService } from '../crawler/crawler-service.ts';
import { dbService } from '../database/db.ts';
import { gitHubSyncEngine, SyncStats } from './sync-engine.ts';
import { searchEngine } from '../indexer/search-engine.ts';

export interface GitHubPollerConfig {
  repo?: string; // owner/repo or https://github.com/owner/repo
  branch: string;
  sourcesPath: string;
  token?: string;
  pollIntervalSec: number;
}

export interface PollResult {
  hasChanges: boolean;
  reason?: string;
  scannedFiles?: number;
  newFiles?: number;
  modifiedFiles?: number;
  deletedFiles?: number;
  enqueuedUrls?: number;
  indexedCount?: number;
  commitSha?: string | null;
  error?: string;
  timestamp: string;
}

export interface PollerStatus {
  enabled: boolean;
  isPolling: boolean;
  mode: 'remote_github' | 'local_sources';
  repo: string | null;
  branch: string;
  sourcesPath: string;
  pollIntervalSec: number;
  lastPollTime: string | null;
  lastPollStatus: string;
  lastCommitSha: string | null;
  lastCommitEtag: string | null;
  nextScheduledPollTime: string | null;
  failureCount: number;
  webhooksSupported: boolean;
  webhookSecretConfigured: boolean;
  hasToken: boolean;
}

export class GitHubPoller {
  private config: GitHubPollerConfig;
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private queuedPoll = false;

  private lastPollTime: string | null = null;
  private lastPollStatus: 'idle' | 'success' | 'not_modified' | 'rate_limited' | 'error' = 'idle';
  private lastCommitSha: string | null = null;
  private lastCommitEtag: string | null = null;
  private lastTreeEtag: string | null = null;
  private failureCount = 0;
  private nextScheduledPollTime: string | null = null;

  // Cache of known Git blob SHAs or local hashes per file path
  private fileBlobShas: Map<string, string> = new Map();

  constructor() {
    const rawInterval = parseInt(process.env.GITHUB_POLL_INTERVAL_SEC || '300', 10);
    const pollIntervalSec = !isNaN(rawInterval) && rawInterval >= 5 ? rawInterval : 300;

    // GITHUB_TOKEN is completely optional. Public GitHub repositories work seamlessly without any token.
    const token = process.env.GITHUB_TOKEN?.trim() || undefined;

    this.config = {
      repo: process.env.GITHUB_REPO?.trim() || undefined,
      branch: process.env.GITHUB_BRANCH?.trim() || 'main',
      sourcesPath: process.env.GITHUB_SOURCES_PATH?.trim() || 'sources',
      token: token && token.length > 0 ? token : undefined,
      pollIntervalSec,
    };
  }

  /**
   * Constructs GitHub API headers.
   * Authorization header is ONLY included if a token is explicitly configured.
   * Public repositories make requests without any Authorization header.
   */
  public getGitHubHeaders(etag?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'NexVora-Search-Engine/1.0',
    };

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    return headers;
  }

  /**
   * Starts autonomous periodic background polling
   */
  public start(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const intervalMs = this.config.pollIntervalSec * 1000;
    console.log(
      `[GitHub Poller] Starting autonomous source poller (Interval: ${this.config.pollIntervalSec}s, Target: ${
        this.config.repo || 'Local sources/ repository'
      })`
    );

    this.scheduleNextPoll(intervalMs);
  }

  /**
   * Stops background polling
   */
  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[GitHub Poller] Autonomous source poller stopped.');
  }

  /**
   * Schedules next poll iteration with support for backoff delay
   */
  private scheduleNextPoll(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.nextScheduledPollTime = new Date(Date.now() + delayMs).toISOString();

    this.timer = setTimeout(async () => {
      try {
        await this.pollOnce();
      } catch (err) {
        console.error('[GitHub Poller] Unhandled poll error:', err);
      }
    }, delayMs);
  }

  /**
   * Triggers an immediate poll (e.g. from optional webhook, manual trigger, or initial boot)
   */
  public async triggerImmediatePoll(source = 'manual'): Promise<PollResult> {
    console.log(`[GitHub Poller] Immediate poll requested (source: ${source})`);
    if (this.isPolling) {
      this.queuedPoll = true;
      return {
        hasChanges: false,
        reason: 'Poll already in progress; queued for immediate execution',
        timestamp: new Date().toISOString(),
      };
    }
    return this.pollOnce();
  }

  /**
   * Executes a single polling cycle with duplicate-processing protection
   */
  public async pollOnce(): Promise<PollResult> {
    if (this.isPolling) {
      this.queuedPoll = true;
      return {
        hasChanges: false,
        reason: 'Concurrent poll prevented by lock',
        timestamp: new Date().toISOString(),
      };
    }

    this.isPolling = true;
    this.lastPollTime = new Date().toISOString();

    let result: PollResult;

    try {
      if (this.config.repo) {
        result = await this.pollRemoteGitHub();
      } else {
        result = await this.pollLocalSources();
      }

      // Success: reset failure count
      this.failureCount = 0;
      this.lastPollStatus = result.hasChanges ? 'success' : (result.reason === 'not_modified' ? 'not_modified' : 'success');

      // Schedule next standard poll
      const standardIntervalMs = this.config.pollIntervalSec * 1000;
      this.scheduleNextPoll(standardIntervalMs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failureCount++;
      this.lastPollStatus = 'error';

      // Exponential backoff: base interval * 1.5^(failures), max 10 minutes
      const backoffMultiplier = Math.min(Math.pow(1.5, Math.min(this.failureCount, 5)), 6);
      const backoffMs = Math.min(this.config.pollIntervalSec * 1000 * backoffMultiplier, 600000);

      console.warn(
        `[GitHub Poller] Poll failed (attempt ${this.failureCount}): ${msg}. Retrying in ${Math.round(
          backoffMs / 1000
        )}s...`
      );

      result = {
        hasChanges: false,
        error: msg,
        timestamp: new Date().toISOString(),
      };

      this.scheduleNextPoll(backoffMs);
    } finally {
      this.isPolling = false;

      // Check if a queued poll was requested during execution
      if (this.queuedPoll) {
        this.queuedPoll = false;
        setTimeout(() => this.pollOnce().catch(() => {}), 200);
      }
    }

    return result;
  }

  /**
   * Remote GitHub API polling with ETag caching and Git Trees API
   */
  private async pollRemoteGitHub(): Promise<PollResult> {
    const repoInfo = this.parseGitHubRepo(this.config.repo);
    if (!repoInfo) {
      throw new Error(`Invalid GITHUB_REPO format: "${this.config.repo}". Expected "owner/repo" or GitHub URL.`);
    }

    const { owner, repo } = repoInfo;
    const branch = this.config.branch;

    // 1. Efficient commit lookup with ETag caching
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
    const headers = this.getGitHubHeaders(this.lastCommitEtag);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let commitRes: Response;
    try {
      commitRes = await fetch(commitUrl, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    // 304 Not Modified: GitHub confirms zero repository changes since last poll
    if (commitRes.status === 304) {
      console.log(`[GitHub Poller] Repository ${owner}/${repo}@${branch}: ETag 304 Not Modified. No changes.`);
      return {
        hasChanges: false,
        reason: 'not_modified',
        commitSha: this.lastCommitSha,
        timestamp: new Date().toISOString(),
      };
    }

    // Handle rate limiting (e.g. 60 req/hr for unauthenticated public requests or 5000 req/hr with token)
    if (commitRes.status === 403 || commitRes.status === 429) {
      const resetHeader = commitRes.headers.get('x-ratelimit-reset');
      const resetDate = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toLocaleTimeString() : 'soon';
      console.warn(
        `[GitHub Poller] GitHub API rate limit reached (HTTP ${commitRes.status}). Resets at ${resetDate}. Public repositories work without a token; GITHUB_TOKEN can optionally be configured to increase rate limits.`
      );
      this.lastPollStatus = 'rate_limited';
      return {
        hasChanges: false,
        reason: 'rate_limited',
        error: `GitHub API rate limit exceeded until ${resetDate}`,
        timestamp: new Date().toISOString(),
      };
    }

    if (!commitRes.ok) {
      throw new Error(`GitHub API error fetching commit (${commitRes.status}): ${commitRes.statusText}`);
    }

    const commitData = (await commitRes.json()) as { sha: string };
    const latestCommitSha = commitData.sha;
    const newCommitEtag = commitRes.headers.get('etag');

    // If commit SHA hasn't changed, return immediately without further API requests
    if (latestCommitSha === this.lastCommitSha) {
      this.lastCommitEtag = newCommitEtag || this.lastCommitEtag;
      return {
        hasChanges: false,
        reason: 'same_commit',
        commitSha: latestCommitSha,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(
      `[GitHub Poller] New commit detected on ${owner}/${repo}@${branch}: ${latestCommitSha.slice(0, 7)} (was: ${
        this.lastCommitSha ? this.lastCommitSha.slice(0, 7) : 'none'
      })`
    );

    // 2. Fetch recursive Git Tree for the commit to inspect source files
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${latestCommitSha}?recursive=1`;
    const treeHeaders = this.getGitHubHeaders();

    const treeRes = await fetch(treeUrl, { headers: treeHeaders });
    if (!treeRes.ok) {
      throw new Error(`GitHub API error fetching tree (${treeRes.status}): ${treeRes.statusText}`);
    }

    interface GitTreeItem {
      path: string;
      mode: string;
      type: 'blob' | 'tree';
      sha: string;
      size?: number;
      url?: string;
    }
    const treeData = (await treeRes.json()) as { tree: GitTreeItem[] };
    const sourcesPrefix = this.config.sourcesPath.replace(/^\/+|\/+$/g, '') + '/';

    const remoteSourceFiles = new Map<string, GitTreeItem>();
    for (const item of treeData.tree || []) {
      if (item.type === 'blob' && item.path.startsWith(sourcesPrefix) && item.path.endsWith('.txt')) {
        remoteSourceFiles.set(item.path, item);
      }
    }

    // Detect added, modified, renamed, and deleted files
    let addedFiles = 0;
    let modifiedFiles = 0;
    let deletedFiles = 0;

    // Check remote files against local cache
    for (const [filePath, item] of remoteSourceFiles.entries()) {
      const prevSha = this.fileBlobShas.get(filePath);
      if (!prevSha) {
        addedFiles++;
      } else if (prevSha !== item.sha) {
        modifiedFiles++;
      }

      // If new or modified, download blob content and write to disk
      if (!prevSha || prevSha !== item.sha) {
        const content = await this.fetchBlobContent(owner, repo, item.sha);
        gitHubSyncEngine.saveFileFromRemote(filePath, content);
        this.fileBlobShas.set(filePath, item.sha);
      }
    }

    // Detect deleted files
    for (const [cachedPath] of this.fileBlobShas.entries()) {
      if (cachedPath.startsWith(sourcesPrefix) && !remoteSourceFiles.has(cachedPath)) {
        console.log(`[GitHub Poller] Remote file deleted: ${cachedPath}`);
        deletedFiles++;
        gitHubSyncEngine.deleteLocalSourceFile(cachedPath);
        await dbService.deleteSourceFile(cachedPath);
        this.fileBlobShas.delete(cachedPath);
      }
    }

    this.lastCommitSha = latestCommitSha;
    this.lastCommitEtag = newCommitEtag || this.lastCommitEtag;

    // 3. Trigger the full sync -> crawl -> categorize -> index pipeline
    const pipelineResult = await this.executePipeline();

    return {
      hasChanges: addedFiles > 0 || modifiedFiles > 0 || deletedFiles > 0 || pipelineResult.syncStats.hasChanges,
      newFiles: addedFiles,
      modifiedFiles,
      deletedFiles,
      enqueuedUrls: pipelineResult.syncStats.frontierEnqueued,
      indexedCount: pipelineResult.crawlIndexed,
      commitSha: latestCommitSha,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Fetches blob content from GitHub API
   */
  private async fetchBlobContent(owner: string, repo: string, blobSha: string): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`;
    const headers = this.getGitHubHeaders();

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch blob ${blobSha} (${res.status})`);
    }

    const json = (await res.json()) as { content: string; encoding: string };
    if (json.encoding === 'base64') {
      return Buffer.from(json.content, 'base64').toString('utf-8');
    }
    return json.content;
  }

  /**
   * Local filesystem source polling (monitors local sources/ folder)
   */
  private async pollLocalSources(): Promise<PollResult> {
    const syncStats = await gitHubSyncEngine.syncSources();

    let crawlIndexed = 0;

    if (syncStats.hasChanges) {
      console.log(
        `[GitHub Poller] Local sources changed (New: ${syncStats.newFiles}, Mod: ${syncStats.modifiedFiles}, Del: ${syncStats.deletedFiles}, URLs Enqueued: ${syncStats.frontierEnqueued}). Triggering pipeline...`
      );

      const pipelineResult = await this.executePipeline();
      crawlIndexed = pipelineResult.crawlIndexed;
    }

    return {
      hasChanges: syncStats.hasChanges,
      scannedFiles: syncStats.scannedFiles,
      newFiles: syncStats.newFiles,
      modifiedFiles: syncStats.modifiedFiles,
      deletedFiles: syncStats.deletedFiles,
      enqueuedUrls: syncStats.frontierEnqueued,
      indexedCount: crawlIndexed,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Executes the automated sync -> crawl -> categorize -> index pipeline
   */
  private async executePipeline(): Promise<{ syncStats: SyncStats; crawlIndexed: number }> {
    console.log('[Pipeline] Initiating sync → crawl → categorize → index pipeline...');

    // 1. Sync sources
    const syncStats = await gitHubSyncEngine.syncSources();

    let crawlIndexed = 0;

    // 2. Crawl newly discovered seed URLs
    if (syncStats.frontierEnqueued > 0) {
      const batchSize = Math.min(syncStats.frontierEnqueued, 25);
      console.log(`[Pipeline] Crawling batch of ${batchSize} seed URLs...`);
      const crawlResult = await crawlerService.processBatch(batchSize);
      crawlIndexed = crawlResult.indexed;
      console.log(`[Pipeline] Crawl batch finished: ${crawlResult.indexed} indexed, ${crawlResult.errors} errors.`);
    }

    // 3. Re-index search engine
    await searchEngine.refreshIndex();
    console.log('[Pipeline] Search engine BM25 index refreshed successfully.');

    return { syncStats, crawlIndexed };
  }

  /**
   * Parses GitHub repository string
   */
  private parseGitHubRepo(repoString?: string): { owner: string; repo: string } | null {
    if (!repoString) return null;
    const cleaned = repoString
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  }

  /**
   * Returns current poller status
   */
  public getStatus(): PollerStatus {
    return {
      enabled: true,
      isPolling: this.isPolling,
      mode: this.config.repo ? 'remote_github' : 'local_sources',
      repo: this.config.repo || null,
      branch: this.config.branch,
      sourcesPath: this.config.sourcesPath,
      pollIntervalSec: this.config.pollIntervalSec,
      lastPollTime: this.lastPollTime,
      lastPollStatus: this.lastPollStatus,
      lastCommitSha: this.lastCommitSha,
      lastCommitEtag: this.lastCommitEtag,
      nextScheduledPollTime: this.nextScheduledPollTime,
      failureCount: this.failureCount,
      webhooksSupported: true,
      webhookSecretConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
      hasToken: Boolean(this.config.token && this.config.token.length > 0),
    };
  }
}

export const gitHubPoller = new GitHubPoller();
