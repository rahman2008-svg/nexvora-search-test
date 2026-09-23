import React, { useState } from 'react';
import { ExternalLink, Info, CheckCircle2, ChevronRight, Sliders, Shield, Share2, Check } from 'lucide-react';
import { buildCanonicalSearchUrl } from '../lib/search-url.ts';

export interface ResultItem {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  description: string;
  snippet: string;
  canonicalUrl: string | null;
  categories: string[];
  topics: string[];
  language: string;
  publishedAt?: string | null;
  indexedAt: string;
  score: number;
  explain?: {
    termFrequency: Record<string, number>;
    bm25Base: number;
    titleBonus: number;
    headingBonus: number;
    urlBonus: number;
    phraseBonus: number;
    freshnessBonus: number;
    categoryBonus: number;
    finalScore: number;
  };
}

interface ResultsListProps {
  results: ResultItem[];
  totalResults: number;
  executionTimeMs: number;
  query: string;
  category?: string;
  page?: number;
  onSelectOperator?: (op: string) => void;
}

export const ResultsList: React.FC<ResultsListProps> = ({
  results,
  totalResults,
  executionTimeMs,
  query,
  category = 'All',
  page = 1,
  onSelectOperator,
}) => {
  const [expandedExplainId, setExpandedExplainId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const toggleExplain = (id: string) => {
    setExpandedExplainId((prev) => (prev === id ? null : id));
  };

  const handleCopyShareLink = () => {
    const canonical = buildCanonicalSearchUrl(query, category, page);
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(canonical).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2200);
      });
    }
  };

  // Helper to format path breadcrumb (e.g. example.com > docs > api)
  const formatBreadcrumb = (urlStr: string, domain: string) => {
    try {
      const parsed = new URL(urlStr);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      return (
        <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-xl">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{domain}</span>
          {pathParts.slice(0, 3).map((part, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="w-3 h-3 opacity-40 shrink-0" />
              <span className="truncate">{decodeURIComponent(part)}</span>
            </React.Fragment>
          ))}
        </div>
      );
    } catch {
      return <span className="text-xs text-zinc-500">{domain}</span>;
    }
  };

  // Zero results fallback
  if (results.length === 0) {
    return (
      <div className="py-12 max-w-2xl">
        <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
            No documents matched your query: <span className="font-mono text-blue-600 dark:text-blue-400">"{query}"</span>
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            NexVora uses deterministic ranking without generative hallucination. Try these search operators:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <button
              onClick={() => onSelectOperator && onSelectOperator('site:bangladesh.gov.bd')}
              className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-left hover:border-blue-500 transition-colors"
            >
              <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">site:domain.com</span>
              <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">Restrict search to a specific verified website</p>
            </button>
            <button
              onClick={() => onSelectOperator && onSelectOperator('intitle:python')}
              className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-left hover:border-blue-500 transition-colors"
            >
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">intitle:term</span>
              <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">Match words in page title specifically</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      {/* Search Result Stats Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400 pb-4 mb-2 border-b border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span>
            About <span className="font-semibold text-zinc-800 dark:text-zinc-200">{totalResults}</span> results (
            <span className="font-mono">{(executionTimeMs / 1000).toFixed(3)}</span> seconds)
          </span>
          <button
            type="button"
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors text-[11px] font-medium"
            title="Copy shareable NexVora search URL (e.g. https://www.nexvora.com/search?q=...)"
          >
            {copiedLink ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Share2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
            <span>{copiedLink ? 'Copied URL!' : 'Share Search'}</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Shield className="w-3 h-3" />
          <span>Deterministic BM25 • Zero Tracking</span>
        </div>
      </div>

      {/* Results List */}
      <div className="space-y-6 sm:space-y-7">
        {results.map((item) => {
          const isExplainOpen = expandedExplainId === item.id;
          return (
            <article key={item.id} className="group text-left">
              {/* Domain & URL breadcrumb */}
              <div className="flex items-center gap-2 mb-1">
                <div className="w-4 h-4 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                  {item.domain.charAt(0)}
                </div>
                {formatBreadcrumb(item.url, item.domain)}
              </div>

              {/* Title */}
              <h3 className="text-lg sm:text-xl font-medium leading-snug">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 dark:text-blue-400 hover:underline visited:text-purple-700 dark:visited:text-purple-400 flex items-baseline gap-1"
                >
                  <span>{item.title}</span>
                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity inline-block shrink-0 ml-1" />
                </a>
              </h3>

              {/* Snippet */}
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {item.snippet || item.description}
              </p>

              {/* Metadata Badges & Explain Trigger */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {item.categories.slice(0, 2).map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50"
                  >
                    {cat}
                  </span>
                ))}

                {item.topics.slice(0, 3).map((top) => (
                  <span
                    key={top}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-zinc-500 dark:text-zinc-400"
                  >
                    #{top}
                  </span>
                ))}

                <button
                  type="button"
                  onClick={() => toggleExplain(item.id)}
                  className={`ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                    isExplainOpen
                      ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  }`}
                  title="View transparent score calculation"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Explain Score ({item.score})</span>
                </button>
              </div>

              {/* Explain Ranking Panel */}
              {isExplainOpen && item.explain && (
                <div className="mt-3 p-3.5 rounded-xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 text-xs">
                  <div className="flex items-center justify-between font-semibold text-blue-900 dark:text-blue-200 mb-2">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      Deterministic Ranking Signals (BM25)
                    </span>
                    <span className="font-mono bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.5 rounded text-[11px]">
                      Total: {item.score}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-zinc-600 dark:text-zinc-400 mb-2">
                    <div className="bg-white/80 dark:bg-zinc-900/80 p-2 rounded-lg border border-blue-100 dark:border-zinc-800">
                      <div className="text-[10px] uppercase font-medium text-zinc-400">BM25 Base</div>
                      <div className="font-mono font-semibold text-zinc-800 dark:text-zinc-200 text-sm">
                        {item.explain.bm25Base}
                      </div>
                    </div>
                    <div className="bg-white/80 dark:bg-zinc-900/80 p-2 rounded-lg border border-blue-100 dark:border-zinc-800">
                      <div className="text-[10px] uppercase font-medium text-zinc-400">Title Boost (3.0x)</div>
                      <div className="font-mono font-semibold text-blue-600 dark:text-blue-400 text-sm">
                        +{item.explain.titleBonus}
                      </div>
                    </div>
                    <div className="bg-white/80 dark:bg-zinc-900/80 p-2 rounded-lg border border-blue-100 dark:border-zinc-800">
                      <div className="text-[10px] uppercase font-medium text-zinc-400">Headings Boost</div>
                      <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-sm">
                        +{item.explain.headingBonus}
                      </div>
                    </div>
                    <div className="bg-white/80 dark:bg-zinc-900/80 p-2 rounded-lg border border-blue-100 dark:border-zinc-800">
                      <div className="text-[10px] uppercase font-medium text-zinc-400">Freshness Signal</div>
                      <div className="font-mono font-semibold text-purple-600 dark:text-purple-400 text-sm">
                        +{item.explain.freshnessBonus}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Term Frequencies: {Object.entries(item.explain.termFrequency).map(([t, f]) => `[${t}: ${f}]`).join(' ')}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};
