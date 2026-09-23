/**
 * NexVora Search - Main Application Entrypoint
 * Google-grade minimal responsive search engine without AI.
 */
import React, { useEffect, useState } from 'react';
import { Header } from './components/Header.tsx';
import { Pagination } from './components/Pagination.tsx';
import { ResultItem, ResultsList } from './components/ResultsList.tsx';
import { SearchBox } from './components/SearchBox.tsx';
import { AboutModal } from './components/AboutModal.tsx';
import { SourcesModal } from './components/SourcesModal.tsx';
import { SyntaxModal } from './components/SyntaxModal.tsx';
import { Shield, Sparkles, Database, Layers, ArrowRight } from 'lucide-react';
import {
  buildSearchPath,
  buildCanonicalSearchUrl,
  parseSearchLocation,
  syncDocumentHead,
} from './lib/search-url.ts';

export default function App() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [executionTimeMs, setExecutionTimeMs] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{
    indexedPages: number;
    totalSources: number;
    domainsTracked: number;
    storageType: string;
  } | null>(null);

  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('nexvora_dark_mode');
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Modal states
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);

  // Sync dark mode class with html element
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('nexvora_dark_mode', 'true');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('nexvora_dark_mode', 'false');
    }
  }, [darkMode]);

  // Fetch system statistics on load
  useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch((e) => console.warn('Failed to load stats:', e));
  }, []);

  // Parse initial URL (supports /search?q=khan+sir, /search?q=python&page=2, /search?q=python&category=programming)
  useEffect(() => {
    const route = parseSearchLocation(window.location.pathname, window.location.search);
    if (route.query) {
      setQuery(route.query);
      setActiveQuery(route.query);
      setSelectedCategory(route.category);
      setCurrentPage(route.page);
      executeSearch(route.query, route.category, route.page, false);
      syncDocumentHead(route.query, route.category, route.page);
    } else {
      syncDocumentHead('');
    }
  }, []);

  // Listen to browser History API (back/forward button / reload)
  useEffect(() => {
    const handlePopState = () => {
      const route = parseSearchLocation(window.location.pathname, window.location.search);
      setQuery(route.query);
      setActiveQuery(route.query);
      setSelectedCategory(route.category);
      setCurrentPage(route.page);
      if (route.query) {
        executeSearch(route.query, route.category, route.page, false);
        syncDocumentHead(route.query, route.category, route.page);
      } else {
        setResults([]);
        syncDocumentHead('');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const executeSearch = (
    searchQuery: string,
    category = selectedCategory,
    page = 1,
    updateUrl = true,
    lucky = false
  ) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setLoading(true);
    const apiUrl = `/api/search?q=${encodeURIComponent(trimmed)}&category=${encodeURIComponent(
      category
    )}&page=${page}&limit=10&explain=true`;

    fetch(apiUrl)
      .then((res) => res.json())
      .then((data) => {
        if (lucky && data.results && data.results.length > 0) {
          window.location.href = data.results[0].url;
          return;
        }

        setResults(data.results || []);
        setTotalResults(data.totalResults || 0);
        setExecutionTimeMs(data.executionTimeMs || 0);
        setCurrentPage(data.page || 1);
        setTotalPages(data.totalPages || 0);
        setActiveQuery(trimmed);

        if (updateUrl) {
          const searchPath = buildSearchPath(trimmed, category, page);
          window.history.pushState({}, '', searchPath);
          syncDocumentHead(trimmed, category, page);
        }
      })
      .catch((err) => {
        console.error('Search error:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleSearchSubmit = (newQuery: string, lucky = false) => {
    setQuery(newQuery);
    setCurrentPage(1);
    executeSearch(newQuery, selectedCategory, 1, true, lucky);
  };

  const handleCategoryChange = (newCat: string) => {
    setSelectedCategory(newCat);
    if (activeQuery) {
      setCurrentPage(1);
      executeSearch(activeQuery, newCat, 1, true);
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    executeSearch(activeQuery, selectedCategory, newPage, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetSearch = () => {
    setQuery('');
    setActiveQuery('');
    setResults([]);
    setSelectedCategory('All');
    setCurrentPage(1);
    window.history.pushState({}, '', '/');
    syncDocumentHead('');
  };

  const isSearchActive = !!activeQuery;

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors">
      {/* Top Header */}
      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenSources={() => setSourcesOpen(true)}
        onOpenSyntax={() => setSyntaxOpen(true)}
        compact={isSearchActive}
        onResetSearch={handleResetSearch}
      />

      {/* Main Body */}
      <main className="flex-1 flex flex-col">
        {!isSearchActive ? (
          // ==================== HERO HOMEPAGE ====================
          <div className="flex-1 flex flex-col items-center justify-center px-4 -mt-12 sm:-mt-16 text-center max-w-4xl mx-auto w-full">
            {/* NexVora Brand Glyph & Title */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-xl shadow-blue-500/25 mb-4 group cursor-default">
                <span className="font-extrabold text-3xl sm:text-4xl tracking-tighter">N</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 font-sans">
                Nex<span className="text-blue-600 dark:text-blue-400">Vora</span>{' '}
                <span className="text-zinc-400 dark:text-zinc-600 font-normal">Search</span>
              </h1>
              <p className="mt-2 text-sm sm:text-base text-zinc-500 dark:text-zinc-400 max-w-lg">
                Independent, deterministic web search powered by GitHub source registries and BM25 ranking.
              </p>
            </div>

            {/* Central Search Box */}
            <div className="w-full">
              <SearchBox
                initialQuery={query}
                onSearch={handleSearchSubmit}
                selectedCategory={selectedCategory}
                onSelectCategory={handleCategoryChange}
              />
            </div>

            {/* Quick Operator Shortcuts */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-8 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-400 dark:text-zinc-500">Quick syntax:</span>
              <a
                href={buildSearchPath('site:bangladesh.gov.bd')}
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchSubmit('site:bangladesh.gov.bd');
                }}
                className="font-mono px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-800 transition-colors"
              >
                site:bangladesh.gov.bd
              </a>
              <a
                href={buildSearchPath('python tutorial site:docs.python.org')}
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchSubmit('python tutorial site:docs.python.org');
                }}
                className="font-mono px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-800 transition-colors"
              >
                python tutorial
              </a>
              <a
                href={buildSearchPath('"relational database" postgresql')}
                onClick={(e) => {
                  e.preventDefault();
                  handleSearchSubmit('"relational database" postgresql');
                }}
                className="font-mono px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-800 transition-colors"
              >
                "relational database"
              </a>
            </div>
          </div>
        ) : (
          // ==================== SEARCH RESULTS VIEW ====================
          <div className="w-full px-4 sm:px-8 py-4 flex-1">
            {/* Search Box in Header Area */}
            <div className="max-w-3xl mb-4">
              <SearchBox
                initialQuery={query}
                onSearch={handleSearchSubmit}
                compact={true}
                selectedCategory={selectedCategory}
                onSelectCategory={handleCategoryChange}
              />
            </div>

            {/* Results or Loading State */}
            {loading ? (
              <div className="py-12 max-w-2xl space-y-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse space-y-2">
                    <div className="h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded w-1/4" />
                    <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
                    <div className="h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
                    <div className="h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <ResultsList
                  results={results}
                  totalResults={totalResults}
                  executionTimeMs={executionTimeMs}
                  query={activeQuery}
                  category={selectedCategory}
                  page={currentPage}
                  onSelectOperator={(op) => handleSearchSubmit(op)}
                />

                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                  query={activeQuery}
                  category={selectedCategory}
                />
              </>
            )}
          </div>
        )}
      </main>

      {/* Global Minimal Footer */}
      <footer className="w-full border-t border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/80 dark:bg-zinc-950 py-3.5 px-4 sm:px-8 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">NexVora Search</span>
            <span>•</span>
            <span>PostgreSQL Persistence</span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Shield className="w-3 h-3" />
              Zero AI
            </span>
          </div>

          <div className="flex items-center gap-3">
            {stats && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {stats.indexedPages} indexed pages • {stats.totalSources} source registries • {stats.domainsTracked} domains
              </span>
            )}
            <button
              onClick={() => setAboutOpen(true)}
              className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Transparency & Privacy
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SourcesModal isOpen={sourcesOpen} onClose={() => setSourcesOpen(false)} />
      <SyntaxModal
        isOpen={syntaxOpen}
        onClose={() => setSyntaxOpen(false)}
        onSelectQuery={(q) => handleSearchSubmit(q)}
      />
    </div>
  );
}
