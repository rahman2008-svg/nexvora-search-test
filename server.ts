/**
 * NexVora Search Engine - Server Entrypoint
 * Express backend powering deterministic BM25 search, autonomous web crawler,
 * GitHub source synchronization, and serving the React frontend.
 */
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { crawlerService } from './src/crawler/crawler-service.ts';
import { dbService } from './src/database/db.ts';
import { gitHubPoller } from './src/github/poller.ts';
import { gitHubSyncEngine } from './src/github/sync-engine.ts';
import { searchEngine } from './src/indexer/search-engine.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Capture raw body for GitHub webhook HMAC verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// --- API Endpoints ---

// 1. Deterministic BM25 Search Endpoint
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const category = (req.query.category as string) || 'All';
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const explain = req.query.explain === 'true' || req.query.explain === '1';

    if (!q.trim()) {
      return res.json({
        query: '',
        parsedQuery: {
          rawQuery: '',
          cleanedTerms: [],
          exactPhrases: [],
          excludedTerms: [],
          inTitleTerms: [],
          inUrlTerms: [],
        },
        totalResults: 0,
        page: 1,
        limit,
        totalPages: 0,
        executionTimeMs: 0,
        results: [],
        suggestions: [],
        availableCategories: ['All', 'Technology', 'Bangladesh', 'Government', 'Education', 'Science', 'Finance', 'Documentation', 'Reference', 'News'],
      });
    }

    const response = await searchEngine.search(q, {
      category,
      page,
      limit,
      explain,
    });

    res.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[API /api/search] Error:', msg);
    res.status(500).json({ error: 'Search failed', message: msg });
  }
});

// 2. Deterministic Suggestions Endpoint
app.get('/api/suggest', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q.trim()) {
      return res.json({ suggestions: [] });
    }
    const suggestions = await searchEngine.generateSuggestions(q);
    res.json({ query: q, suggestions });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to generate suggestions', message: msg });
  }
});

// 3. System Statistics Endpoint
app.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dbService.getStats();
    res.json({
      ...stats,
      poller: gitHubPoller.getStatus(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to fetch stats', message: msg });
  }
});

// 4. Source Registry Information Endpoint
app.get('/api/sources', async (_req: Request, res: Response) => {
  try {
    const files = await dbService.getSourceFiles();
    res.json({
      sourcesCount: files.length,
      files,
      poller: gitHubPoller.getStatus(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to fetch sources', message: msg });
  }
});

// 5. GitHub Status Endpoint (Autonomous Poller & Sync State)
app.get('/api/github/status', async (_req: Request, res: Response) => {
  try {
    res.json(gitHubPoller.getStatus());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to fetch GitHub status', message: msg });
  }
});

// 6. GitHub Webhook Receiver (COMPLETELY OPTIONAL)
// Webhook configuration and GITHUB_WEBHOOK_SECRET are not required; polling operates autonomously.
app.post('/api/github/webhook', async (req: any, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const isValid = gitHubSyncEngine.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature);

    if (!isValid) {
      console.warn('[GitHub Webhook] Webhook signature verification failed.');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event = req.headers['x-github-event'] || 'push';
    console.log(`[GitHub Webhook] Received optional webhook notification (event: ${event}). Triggering immediate poll...`);

    // Trigger immediate polling without blocking webhook response
    gitHubPoller.triggerImmediatePoll('webhook').catch((e) =>
      console.error('[GitHub Webhook] Error during background poll trigger:', e)
    );

    res.json({
      accepted: true,
      mode: 'optional_webhook',
      event,
      poller: gitHubPoller.getStatus(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Webhook processing error', message: msg });
  }
});

// 7. Manual / Internal Sync Trigger Endpoint
app.post('/api/sync/trigger', async (_req: Request, res: Response) => {
  try {
    const pollResult = await gitHubPoller.triggerImmediatePoll('manual_api');
    res.json({ success: true, pollResult, poller: gitHubPoller.getStatus() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Sync failed', message: msg });
  }
});

// 8. Crawler Worker Trigger Endpoint
app.post('/api/crawler/tick', async (req: Request, res: Response) => {
  try {
    const batchSize = parseInt(req.body.batchSize as string, 10) || 5;
    const crawlResult = await crawlerService.processBatch(batchSize);
    res.json({ success: true, result: crawlResult });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Crawl tick failed', message: msg });
  }
});

// --- Bootstrapping Background Services ---
async function startServer() {
  console.log('[NexVora] Initializing database and storage engine...');
  await dbService.initialize();

  console.log('[NexVora] Refreshing search index...');
  const initialStats = await dbService.getStats();
  if (initialStats.indexedPages < 15) {
    const { seedInitialCorpus } = await import('./src/scripts/seed-initial-corpus.ts');
    await seedInitialCorpus();
  }
  await searchEngine.refreshIndex();

  console.log('[NexVora] Running initial GitHub source synchronization...');
  await gitHubPoller.triggerImmediatePoll('boot');

  // Start Autonomous Poller Loop (configurable interval, default 300s)
  gitHubPoller.start();

  // Autonomous Polite Crawler Loop (12-second tick)
  let crawlInProgress = false;
  setInterval(async () => {
    if (crawlInProgress) return;
    try {
      crawlInProgress = true;
      await crawlerService.processBatch(3);
    } catch (e) {
      console.warn('[Crawler Loop] Tick error:', e);
    } finally {
      crawlInProgress = false;
    }
  }, 12000);

  // Mount Vite or static build
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (req.method !== 'GET' || url.startsWith('/api')) {
        return next();
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[NexVora Search] Server running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[NexVora Search] Fatal server startup error:', err);
  process.exit(1);
});
