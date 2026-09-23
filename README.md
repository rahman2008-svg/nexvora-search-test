# NexVora Search

> **An independent, deterministic, privacy-first web search engine engineered from scratch.**
> **GitHub is the source & control center. Zero Admin Panel. Production uses NO AI.**

---

## 1. Core Principles

- **Zero Production AI**: No OpenAI, No Gemini, No Claude, No LLMs, No embeddings, No vector search.
- **Deterministic BM25 Ranking**: Mathematically explainable term-frequency and inverse-document-frequency ranking with field boosts (title, headings, URL, description), exact phrase bonuses, and freshness signals.
- **GitHub as the Control Center**: The website has **NO Admin Panel**, no admin login, and no manual submission UI. All source seed URLs are plain `.txt` files in GitHub repositories (e.g. `sources/Bangladesh/`, `sources/Technology/`).
- **Autonomous Crawler**: Features polite domain-level concurrency limiting, crawl-delay compliance from `robots.txt`, XML sitemap discovery, SSRF/private-network blocking, and SHA-256 deduplication.
- **Production PostgreSQL Persistence**: Relational storage for source files, source URLs, crawl frontier queues with worker leases, indexed documents, domain rate-limiting metadata, and query statistics. Resilient fallback to local atomic storage during local development.
- **Premium Responsive UI**: Clean, lightning-fast Google-like search experience with dark/light mode, instant autocomplete suggestions, transparent ranking signal explanation, and advanced search operators.

---

## 2. Directory Structure

```text
nexvora-search/
├── sources/                         # GitHub-Controlled Source Registry
│   ├── Bangladesh/
│   │   ├── government.txt           # One URL per line
│   │   ├── education.txt
│   │   └── universities.txt
│   ├── Technology/
│   │   ├── programming.txt
│   │   ├── web.txt
│   │   └── databases.txt
│   ├── Education/
│   ├── Science/
│   ├── Finance/
│   ├── Reference/
│   └── International/
│
├── generated/                       # Lightweight Auto-Generated Metadata
│   ├── categories/                  # Auto-generated category URL maps
│   ├── topics/                      # Keyword and topic registries
│   ├── domains/                     # Indexed domain rosters
│   ├── languages/                   # Language indexes
│   └── manifests/                   # Index summary JSON manifests
│
├── src/
│   ├── crawler/                     # Autonomous Crawler Engine
│   │   ├── crawler-service.ts       # Worker coordinator, leases & recrawl
│   │   ├── parser.ts                # Deterministic Cheerio HTML parser
│   │   ├── categorizer.ts           # Rule-based document categorizer
│   │   ├── robots.ts                # Robots.txt parser and TTL cache
│   │   └── sitemap.ts               # XML Sitemap & index parser
│   ├── database/                    # Storage Layer
│   │   ├── schema.ts                # TypeScript types & DB interfaces
│   │   └── db.ts                    # PostgreSQL & Local Persistent Adapter
│   ├── indexer/                     # Search & Ranking
│   │   └── search-engine.ts         # Deterministic BM25 Search Engine
│   ├── github/                      # GitHub Synchronization
│   │   └── sync-engine.ts           # Source scanner & Webhook HMAC verifier
│   ├── security/                    # Security & Network Protection
│   │   └── ssrf.ts                  # Private IPv4/IPv6 & DNS rebinding protection
│   ├── components/                  # React Frontend Components
│   │   ├── Header.tsx               # Nav header with brand and theme toggle
│   │   ├── SearchBox.tsx            # Search input with autocomplete
│   │   ├── ResultsList.tsx          # Result items & Explain Score inspector
│   │   ├── Pagination.tsx           # Page navigation
│   │   ├── AboutModal.tsx           # Architecture and zero-AI pledge
│   │   ├── SourcesModal.tsx         # GitHub sources directory viewer
│   │   └── SyntaxModal.tsx          # Search syntax and operators guide
│   └── App.tsx                      # Main React application
├── tests/
│   └── run-all.ts                   # Comprehensive automated test suite
├── server.ts                        # Full-stack Express backend
├── render.yaml                      # Render Blueprint (Web Service + PostgreSQL)
├── vercel.json                      # Vercel deployment configuration
├── Dockerfile                       # Container deployment definition
├── package.json
└── README.md
```

---

## 3. GitHub Source Workflow

```text
User commits URL to GitHub repository
                │
                ▼
GitHub pushes Webhook to /api/github/webhook
(or periodic scheduled synchronization fallback)
                │
                ▼
NexVora verifies HMAC-SHA256 signature
                │
                ▼
Normalizes URL & strips tracking parameters (utm_*, fbclid)
                │
                ▼
Deduplicates & enqueues to Persistent Crawl Frontier
                │
                ▼
Autonomous Worker leases batch with heartbeat lock
                │
                ▼
Robots.txt check + SSRF protection + polite Crawl-Delay
                │
                ▼
Deterministic HTML extraction & SHA-256 duplicate detection
                │
                ▼
Deterministic categorization (Bangladesh, Technology, Science, etc.)
                │
                ▼
BM25 Inverted Index update + generated/*.txt registry refresh
                │
                ▼
User queries NexVora -> Deterministic, explainable ranked results
```

---

## 4. Search Operators

| Operator | Syntax Example | Behavior |
| :--- | :--- | :--- |
| **Site Filter** | `site:bangladesh.gov.bd` | Restricts search results strictly to the given domain |
| **Title Match** | `intitle:python` | Requires the term to be present in the page title |
| **URL Match** | `inurl:docs` | Requires the term to be present in the URL path |
| **Exact Phrase**| `"relational database"` | Requires exact consecutive phrase matching |
| **Exclude Term**| `programming -deprecated` | Filters out any documents containing the negated word |

---

## 5. Automated Tests

Run the full test suite verifying URL normalization, SSRF protection, robots.txt, sitemaps, HTML parsing, categorization, BM25 ranking, and end-to-end flow:

```bash
npm test
```

---

## 6. Deployment Guide

### Deploying on Render (Recommended)
1. Push this repository to GitHub.
2. In Render, select **Blueprints** and connect your repository.
3. Render automatically provisions the Web Service and PostgreSQL database defined in `render.yaml`.
4. Copy the webhook URL (`https://your-service.onrender.com/api/github/webhook`) and your `GITHUB_WEBHOOK_SECRET` to your GitHub repo's **Settings -> Webhooks**.

### Deploying on Vercel
1. Connect repository in Vercel.
2. Provide `DATABASE_URL` pointing to your PostgreSQL instance.
3. Build command: `npm run build`.

---

## 7. License

Apache-2.0
