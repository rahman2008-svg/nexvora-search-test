/**
 * NexVora Search Automated Test Suite
 * Validates URL normalization, SSRF protection, Robots.txt, Sitemap parser,
 * Content parsing & hashing, Categorizer, BM25 Search Engine, Search Operators,
 * GitHub Webhook HMAC validation, and End-to-End indexing & query flow.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { categorizeDocument } from '../src/crawler/categorizer.ts';
import { parseHtmlPage, tokenizeText } from '../src/crawler/parser.ts';
import { robotsManager } from '../src/crawler/robots.ts';
import { parseSitemapXml } from '../src/crawler/sitemap.ts';
import { dbService } from '../src/database/db.ts';
import { gitHubPoller, GitHubPoller } from '../src/github/poller.ts';
import { gitHubSyncEngine } from '../src/github/sync-engine.ts';
import { searchEngine } from '../src/indexer/search-engine.ts';
import { extractRootDomain, normalizeUrl, resolveRelativeUrl } from '../src/lib/url-normalizer.ts';
import { isPrivateIPv4, isPrivateIPv6, validateUrlSafety } from '../src/security/ssrf.ts';
import {
  buildSearchPath,
  buildCanonicalSearchUrl,
  parseSearchLocation,
  getBaseSiteUrl,
  DEFAULT_PRODUCTION_DOMAIN,
} from '../src/lib/search-url.ts';

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passedTests++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

async function runTests() {
  console.log('\n=============================================');
  console.log('       NEXVORA SEARCH TEST SUITE');
  console.log('=============================================\n');

  // --- 1. URL Normalization Tests ---
  console.log('Group 1: URL Normalization & Domain Detection');
  await test('strips tracking query parameters (utm_*, fbclid, etc.)', () => {
    const raw = 'https://example.com/page?utm_source=twitter&utm_medium=social&id=123&fbclid=XYZ123';
    const res = normalizeUrl(raw);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.normalizedUrl, 'https://example.com/page?id=123');
  });

  await test('normalizes hostnames to lowercase and strips default ports', () => {
    const raw = 'HTTPS://WWW.EXAMPLE.COM:443/Path/Doc/';
    const res = normalizeUrl(raw);
    assert.strictEqual(res.normalizedUrl, 'https://www.example.com/Path/Doc');
    assert.strictEqual(res.domain, 'example.com');
  });

  await test('extracts multi-part ccTLDs correctly (e.g. .gov.bd, .co.uk)', () => {
    assert.strictEqual(extractRootDomain('pmo.gov.bd'), 'pmo.gov.bd');
    assert.strictEqual(extractRootDomain('sub.portal.gov.bd'), 'portal.gov.bd');
    assert.strictEqual(extractRootDomain('docs.python.org'), 'python.org');
  });

  await test('resolves relative URLs safely', () => {
    const res = resolveRelativeUrl('/docs/intro.html#anchor', 'https://example.com/category/sub/');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.normalizedUrl, 'https://example.com/docs/intro.html');
  });

  // --- 2. SSRF Protection Tests ---
  console.log('\nGroup 2: SSRF & Safe IP Validation');
  await test('blocks loopback and private IPv4 ranges', () => {
    assert.strictEqual(isPrivateIPv4('127.0.0.1'), true);
    assert.strictEqual(isPrivateIPv4('10.0.0.5'), true);
    assert.strictEqual(isPrivateIPv4('192.168.1.1'), true);
    assert.strictEqual(isPrivateIPv4('172.16.0.1'), true);
    assert.strictEqual(isPrivateIPv4('169.254.169.254'), true);
    assert.strictEqual(isPrivateIPv4('8.8.8.8'), false);
    assert.strictEqual(isPrivateIPv4('93.184.216.34'), false);
  });

  await test('blocks IPv6 private & unique local ranges', () => {
    assert.strictEqual(isPrivateIPv6('::1'), true);
    assert.strictEqual(isPrivateIPv6('fc00::1'), true);
    assert.strictEqual(isPrivateIPv6('fe80::1'), true);
    assert.strictEqual(isPrivateIPv6('2606:4700:4700::1111'), false);
  });

  await test('validates URL safety and rejects invalid schemes/ports/internal hosts', () => {
    assert.strictEqual(validateUrlSafety('http://localhost:3000/').valid, false);
    assert.strictEqual(validateUrlSafety('ftp://example.com/file').valid, false);
    assert.strictEqual(validateUrlSafety('http://169.254.169.254/latest/meta-data').valid, false);
    assert.strictEqual(validateUrlSafety('https://example.com:8443/').valid, false);
    assert.strictEqual(validateUrlSafety('https://bangladesh.gov.bd/').valid, true);
  });

  // --- 3. Robots.txt Engine Tests ---
  console.log('\nGroup 3: Robots.txt Deterministic Evaluation');
  await test('correctly evaluates allow/disallow and longest-match rule', () => {
    const robotsSample = `
      User-agent: *
      Disallow: /admin
      Disallow: /private/
      Allow: /private/public-preview
      Crawl-delay: 2.5
      Sitemap: https://example.com/sitemap.xml
    `;
    const parsed = robotsManager.parse(robotsSample, 'example.com');
    assert.strictEqual(parsed.crawlDelayMs, 2500);
    assert.strictEqual(parsed.sitemaps[0], 'https://example.com/sitemap.xml');
    assert.strictEqual(robotsManager.isAllowed('/', parsed), true);
    assert.strictEqual(robotsManager.isAllowed('/admin/login', parsed), false);
    assert.strictEqual(robotsManager.isAllowed('/private/secret', parsed), false);
    assert.strictEqual(robotsManager.isAllowed('/private/public-preview', parsed), true);
  });

  // --- 4. XML Sitemap Parser Tests ---
  console.log('\nGroup 4: XML Sitemap Parser');
  await test('parses standard XML sitemaps with loc, priority, lastmod', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://example.com/page1</loc>
        <lastmod>2026-01-01</lastmod>
        <priority>0.8</priority>
      </url>
      <url>
        <loc>https://example.com/page2</loc>
        <priority>0.5</priority>
      </url>
    </urlset>`;
    const parsed = parseSitemapXml(xml);
    assert.strictEqual(parsed.isIndex, false);
    assert.strictEqual(parsed.urls.length, 2);
    assert.strictEqual(parsed.urls[0].normalizedUrl, 'https://example.com/page1');
    assert.strictEqual(parsed.urls[0].priority, 0.8);
  });

  // --- 5. HTML Parser & Content Extraction Tests ---
  console.log('\nGroup 5: Deterministic HTML Parser & Duplicate Hashing');
  await test('extracts metadata, clean headings, body text, and removes scripts/nav', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>Python Tutorial - Learn Fast</title>
          <meta name="description" content="A comprehensive tutorial on Python programming language." />
          <link rel="canonical" href="https://example.com/python-guide" />
          <script>console.log("noisy tracking script");</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <nav>Home | Contact | Terms</nav>
          <main>
            <h1>Introduction to Python</h1>
            <p>Python is an interpreted, high-level, general-purpose programming language.</p>
            <h2>Functions and Modules</h2>
            <p>Reusable blocks of code are defined using the def keyword.</p>
            <a href="/docs/modules">Modules Guide</a>
            <a href="mailto:support@example.com">Email Us</a>
          </main>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    const parsed = parseHtmlPage(html, 'https://example.com/python-tutorial');
    assert.strictEqual(parsed.title, 'Python Tutorial - Learn Fast');
    assert.strictEqual(parsed.canonicalUrl, 'https://example.com/python-guide');
    assert.strictEqual(parsed.headings.h1[0], 'Introduction to Python');
    assert.strictEqual(parsed.headings.h2[0], 'Functions and Modules');
    assert.strictEqual(parsed.fullText.includes('noisy tracking script'), false);
    assert.strictEqual(parsed.fullText.includes('interpreted, high-level'), true);
    assert.strictEqual(parsed.links.length, 1);
    assert.strictEqual(parsed.links[0], 'https://example.com/docs/modules');
    assert.ok(parsed.contentHash.length === 64);
  });

  // --- 6. Deterministic Categorization Tests ---
  console.log('\nGroup 6: Deterministic Categorizer');
  await test('classifies Bangladesh government sites', () => {
    const res = categorizeDocument(
      'https://pmo.gov.bd/site/page/citizens-charter',
      'pmo.gov.bd',
      'Prime Minister Office of Bangladesh',
      'Citizen Charter and Public Administration',
      'Official policies of the Bangladesh government and ministries',
      'Bangladesh'
    );
    assert.ok(res.categories.includes('Bangladesh'));
    assert.ok(res.categories.includes('Government'));
  });

  await test('classifies programming and documentation resources', () => {
    const res = categorizeDocument(
      'https://docs.python.org/3/tutorial/index.html',
      'python.org',
      'The Python Tutorial - Python Documentation',
      'Getting Started with Python Code',
      'Tutorial for programming with Python syntax, functions, and standard library',
      'Technology'
    );
    assert.ok(res.categories.includes('Programming') || res.categories.includes('Technology'));
    assert.ok(res.categories.includes('Documentation'));
  });

  // --- 7. GitHub Webhook Signature Verification ---
  console.log('\nGroup 7: GitHub Webhook HMAC Verification');
  await test('verifies HMAC-SHA256 signatures with secret', () => {
    const secret = 'nexvora_secret_key_123';
    const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [] });
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const validHeader = `sha256=${hmac}`;

    assert.strictEqual(gitHubSyncEngine.verifyWebhookSignature(payload, validHeader, secret), true);
    assert.strictEqual(gitHubSyncEngine.verifyWebhookSignature(payload, 'sha256=invalidhash', secret), false);
  });

  // --- 8. BM25 Search Engine & Operators Tests ---
  console.log('\nGroup 8: BM25 Ranking & Search Operators');
  await test('parses operators (site:, intitle:, inurl:, "", -)', () => {
    const parsed = searchEngine.parseQuery('python tutorial site:python.org intitle:guide -deprecated "open source"');
    assert.strictEqual(parsed.siteFilter, 'python.org');
    assert.strictEqual(parsed.inTitleTerms[0], 'guide');
    assert.strictEqual(parsed.excludedTerms[0], 'deprecated');
    assert.strictEqual(parsed.exactPhrases[0], 'open source');
    assert.ok(parsed.cleanedTerms.includes('python'));
    assert.ok(parsed.cleanedTerms.includes('tutorial'));
  });

  // --- 9. End-to-End Sync -> Index -> Search Flow ---
  console.log('\nGroup 9: End-to-End GitHub Sync -> Seed Enqueue -> Index -> BM25 Search');
  await test('performs complete workflow', async () => {
    await dbService.initialize();

    // 1. Sync from sources/
    const syncStats = await gitHubSyncEngine.syncSources();
    assert.ok(syncStats.scannedFiles > 0, 'Should have scanned source files');
    assert.ok(syncStats.totalUrlsScanned > 0, 'Should have scanned source URLs');

    // 2. Insert synthetic high-quality test document into index
    const testDocId = crypto.randomBytes(8).toString('hex');
    const samplePage = {
      id: testDocId,
      url: 'https://bangladesh.gov.bd/about',
      normalizedUrl: 'https://bangladesh.gov.bd/about',
      domain: 'bangladesh.gov.bd',
      title: 'National Web Portal of Bangladesh',
      description: 'Single access point for all citizen services, government ministries, and digital services in Dhaka.',
      canonicalUrl: 'https://bangladesh.gov.bd/about',
      headings: {
        h1: ['Welcome to Bangladesh National Portal'],
        h2: ['Digital Public Services and Citizen Gateway', 'Ministries and Divisions'],
        h3: ['Dhaka Central Administration'],
      },
      contentPreview: 'The National Web Portal of Bangladesh provides unified access to public information, government directives, and citizen benefits.',
      tokens: tokenizeText('National Web Portal of Bangladesh digital public services citizen gateway ministries divisions Dhaka'),
      termFrequencies: {
        national: 2,
        portal: 2,
        bangladesh: 3,
        digital: 1,
        citizen: 2,
        dhaka: 1,
        ministries: 1,
      },
      docLength: 45,
      language: 'en',
      categories: ['Bangladesh', 'Government'],
      topics: ['citizen', 'portal', 'ministries'],
      contentHash: crypto.createHash('sha256').update('National Web Portal of Bangladesh sample').digest('hex'),
      indexedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    await dbService.saveIndexedPage(samplePage);
    await searchEngine.refreshIndex();

    // 3. Search query: "bangladesh national portal"
    const searchRes = await searchEngine.search('bangladesh national portal', { explain: true });
    assert.ok(searchRes.totalResults > 0, 'Should return results for bangladesh national portal');
    assert.ok(
      searchRes.results.some((r) => r.normalizedUrl === 'https://bangladesh.gov.bd/about'),
      'Should include the indexed test document'
    );
    assert.ok(searchRes.results[0].score > 0, 'Score should be positive');
    assert.ok(searchRes.results[0].explain, 'Explain score should be present');
    assert.ok(searchRes.results[0].explain!.bm25Base > 0, 'BM25 base score should be calculated');

    // 4. Test site: operator
    const siteRes = await searchEngine.search('portal site:bangladesh.gov.bd');
    assert.ok(siteRes.totalResults > 0);
    assert.strictEqual(siteRes.results[0].domain, 'bangladesh.gov.bd');

    // 5. Test excluded operator (-dhaka should exclude the test document containing dhaka)
    const excludedRes = await searchEngine.search('bangladesh -dhaka');
    assert.strictEqual(
      excludedRes.results.some((r) => r.normalizedUrl === 'https://bangladesh.gov.bd/about'),
      false,
      'Document containing dhaka should be excluded'
    );

    // 6. Test suggestions
    const suggestions = await searchEngine.generateSuggestions('bang');
    assert.ok(suggestions.length > 0, 'Should offer suggestions starting with bang');
  });

  // --- 10. Autonomous GitHub Polling & Change Detection ---
  console.log('\nGroup 10: Autonomous GitHub Polling & Change Detection');
  await test('webhooks are completely optional and work without secret', () => {
    // Save original env var if any
    const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_WEBHOOK_SECRET;

    // Webhook should be accepted without secret
    const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'abc' }] });
    const isAcceptedWithoutSecret = gitHubSyncEngine.verifyWebhookSignature(payload);
    assert.strictEqual(isAcceptedWithoutSecret, true, 'Webhook must be accepted when GITHUB_WEBHOOK_SECRET is not configured');

    // Restore env var if needed
    if (originalSecret) {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }
  });

  await test('GITHUB_TOKEN is optional: public repos work without token and headers omit Authorization', () => {
    const savedToken = process.env.GITHUB_TOKEN;
    try {
      delete process.env.GITHUB_TOKEN;
      const unauthPoller = new GitHubPoller();
      const headersWithoutToken = unauthPoller.getGitHubHeaders('sample-etag-123');

      assert.strictEqual(
        headersWithoutToken['Authorization'],
        undefined,
        'Authorization header must NOT be present when GITHUB_TOKEN is omitted'
      );
      assert.strictEqual(
        headersWithoutToken['If-None-Match'],
        'sample-etag-123',
        'ETag caching header must still be present'
      );
      assert.strictEqual(
        unauthPoller.getStatus().hasToken,
        false,
        'Poller status hasToken must be false when no token is supplied'
      );

      // Now test with GITHUB_TOKEN explicitly provided
      process.env.GITHUB_TOKEN = 'ghp_test_token_sample_abc123';
      const authPoller = new GitHubPoller();
      const headersWithToken = authPoller.getGitHubHeaders();

      assert.strictEqual(
        headersWithToken['Authorization'],
        'Bearer ghp_test_token_sample_abc123',
        'Authorization header must be correctly set when GITHUB_TOKEN is provided'
      );
      assert.strictEqual(
        authPoller.getStatus().hasToken,
        true,
        'Poller status hasToken must be true when token is supplied'
      );
    } finally {
      if (savedToken) {
        process.env.GITHUB_TOKEN = savedToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }
  });

  await test('detects added, modified, and deleted source files and deactivates removed URLs', async () => {
    const testCategoryDir = path.resolve(process.cwd(), 'sources', 'TestCategory');
    const testId = Date.now();
    const testFileName = `poller_test_${testId}.txt`;
    const testFilePath = path.join(testCategoryDir, testFileName);
    const relativeTestPath = `sources/TestCategory/${testFileName}`;

    if (!fs.existsSync(testCategoryDir)) {
      fs.mkdirSync(testCategoryDir, { recursive: true });
    }

    try {
      // 1. Create a temporary source file with 2 URLs
      const initialContent = 'https://example.com/alpha\nhttps://example.com/beta\n';
      fs.writeFileSync(testFilePath, initialContent, 'utf-8');

      const initialSync = await gitHubSyncEngine.syncSources();
      assert.ok(initialSync.scannedFiles > 0);
      assert.ok(initialSync.validUrlsAdded >= 2);

      const dbUrlsBefore = (await dbService.getSourceUrlsForFile(relativeTestPath)).filter((u) => u.isActive);
      assert.strictEqual(dbUrlsBefore.length, 2, 'Should have 2 active source URLs');
      assert.ok(dbUrlsBefore.every((u) => u.isActive), 'All initial URLs should be active');

      // 2. Modify source file: remove one URL and add another
      const modifiedContent = 'https://example.com/alpha\nhttps://example.com/gamma\n';
      fs.writeFileSync(testFilePath, modifiedContent, 'utf-8');

      const modifiedSync = await gitHubSyncEngine.syncSources();
      assert.strictEqual(modifiedSync.modifiedFiles, 1, 'Should detect 1 modified file');
      assert.strictEqual(modifiedSync.urlsDeactivated, 1, 'Should deactivate 1 removed URL');

      const dbUrlsAfter = await dbService.getSourceUrlsForFile(relativeTestPath);
      const betaUrl = dbUrlsAfter.find((u) => u.normalizedUrl === 'https://example.com/beta');
      assert.ok(betaUrl, 'Beta URL record should still exist in history');
      assert.strictEqual(betaUrl!.isActive, false, 'Removed URL beta must be marked inactive');

      // 3. Delete source file completely
      fs.unlinkSync(testFilePath);
      const deletedSync = await gitHubSyncEngine.syncSources();
      assert.strictEqual(deletedSync.deletedFiles, 1, 'Should detect 1 deleted source file');

      const dbFilesAfter = await dbService.getSourceFiles();
      assert.strictEqual(
        dbFilesAfter.some((f) => f.filePath === relativeTestPath),
        false,
        'Deleted file should be removed from active registry'
      );
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      if (fs.existsSync(testCategoryDir)) {
        try {
          fs.rmdirSync(testCategoryDir);
        } catch {}
      }
    }
  });

  // --- 11. Render PostgreSQL Automatic DATABASE_URL Configuration ---
  console.log('\nGroup 11: Render PostgreSQL render.yaml Configuration Validation');
  await test('validates render.yaml binds DATABASE_URL from Render PostgreSQL automatically', () => {
    const renderYamlPath = path.resolve(process.cwd(), 'render.yaml');
    assert.ok(fs.existsSync(renderYamlPath), 'render.yaml must exist at root');

    const content = fs.readFileSync(renderYamlPath, 'utf-8');

    // 1. Must define PostgreSQL database
    assert.ok(content.includes('databases:'), 'render.yaml must declare databases block');
    assert.ok(content.includes('name: nexvora-postgres'), 'render.yaml must declare nexvora-postgres database');

    // 2. Must automatically inject connectionString into DATABASE_URL via fromDatabase
    assert.ok(content.includes('key: DATABASE_URL'), 'render.yaml must bind DATABASE_URL');
    assert.ok(content.includes('fromDatabase:'), 'DATABASE_URL must use fromDatabase configuration');
    assert.ok(content.includes('property: connectionString'), 'fromDatabase must select connectionString property');

    // 3. Must not hardcode any sensitive database credentials
    assert.strictEqual(content.includes('password:'), false, 'Password must NOT be hardcoded in render.yaml');
    assert.strictEqual(content.includes('postgres://'), false, 'No raw PostgreSQL URI must be hardcoded in render.yaml');
  });

  // --- 12. Custom Search URL & NexVora Domain Specification ---
  console.log('\nGroup 12: Custom Search URL & NexVora Domain Specification');
  await test('formats search URLs under /search with standard URL encoding', () => {
    assert.strictEqual(buildSearchPath('khan sir'), '/search?q=khan+sir');
    assert.strictEqual(buildSearchPath('python'), '/search?q=python');
    assert.strictEqual(buildSearchPath('bangladesh'), '/search?q=bangladesh');
    assert.strictEqual(buildSearchPath('mathematics'), '/search?q=mathematics');
  });

  await test('formats pagination and category filter URLs correctly', () => {
    assert.strictEqual(buildSearchPath('python', 'All', 2), '/search?q=python&page=2');
    assert.strictEqual(buildSearchPath('python', 'programming', 1), '/search?q=python&category=programming');
    assert.strictEqual(buildSearchPath('python', 'programming', 2), '/search?q=python&category=programming&page=2');
  });

  await test('constructs canonical search URLs on the NexVora custom domain', () => {
    const defaultCanonical = buildCanonicalSearchUrl('khan sir');
    assert.strictEqual(defaultCanonical, 'https://www.nexvora.com/search?q=khan+sir');

    const combinedCanonical = buildCanonicalSearchUrl('python', 'programming', 2);
    assert.strictEqual(combinedCanonical, 'https://www.nexvora.com/search?q=python&category=programming&page=2');

    // Test with NEXT_PUBLIC_SITE_URL environment override
    const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    try {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://custom-deploy.nexvora.com';
      assert.strictEqual(
        buildCanonicalSearchUrl('mathematics'),
        'https://custom-deploy.nexvora.com/search?q=mathematics'
      );
    } finally {
      if (originalSiteUrl !== undefined) {
        process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
      } else {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      }
    }
  });

  await test('parses direct search URLs for bookmarkable and shareable navigation', () => {
    const route1 = parseSearchLocation('/search', '?q=khan+sir');
    assert.strictEqual(route1.isSearch, true);
    assert.strictEqual(route1.query, 'khan sir');
    assert.strictEqual(route1.category, 'All');
    assert.strictEqual(route1.page, 1);

    const route2 = parseSearchLocation('/search', '?q=python&category=programming&page=2');
    assert.strictEqual(route2.isSearch, true);
    assert.strictEqual(route2.query, 'python');
    assert.strictEqual(route2.category, 'programming');
    assert.strictEqual(route2.page, 2);

    const homeRoute = parseSearchLocation('/', '');
    assert.strictEqual(homeRoute.isSearch, false);
    assert.strictEqual(homeRoute.query, '');
  });

  await test('ensures search URLs do not contain Google tracking parameters', () => {
    const forbiddenParams = ['gs_ssp', 'oq', 'client', 'sourceid', 'ie', 'ved', 'ei', 'sei'];
    const generatedUrls = [
      buildSearchPath('khan sir'),
      buildSearchPath('python', 'programming', 2),
      buildCanonicalSearchUrl('bangladesh'),
    ];

    for (const u of generatedUrls) {
      for (const p of forbiddenParams) {
        assert.strictEqual(u.includes(`${p}=`), false, `URL must not contain tracking parameter: ${p}`);
      }
      assert.strictEqual(u.includes('google.com'), false, 'URL must not point to google.com');
      assert.strictEqual(u.includes('bing.com'), false, 'URL must not point to bing.com');
    }
  });

  console.log(`\n=============================================`);
  console.log(`RESULTS: ${passedTests}/${totalTests} tests passed successfully!`);
  console.log(`=============================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
