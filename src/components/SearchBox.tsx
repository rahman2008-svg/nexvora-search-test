import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Sparkles, CornerDownLeft, ArrowRight } from 'lucide-react';
import { buildSearchPath } from '../lib/search-url.ts';

interface SearchBoxProps {
  initialQuery?: string;
  onSearch: (query: string, lucky?: boolean) => void;
  compact?: boolean;
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
  categories?: string[];
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  initialQuery = '',
  onSearch,
  compact = false,
  selectedCategory = 'All',
  onSelectCategory,
  categories = ['All', 'Technology', 'Bangladesh', 'Government', 'Education', 'Science', 'Finance', 'Documentation', 'Reference', 'News'],
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Fetch deterministic suggestions on query change
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
          }
        })
        .catch(() => {});
    }, 120);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = (e?: React.FormEvent, lucky = false) => {
    if (e) e.preventDefault();
    setShowSuggestions(false);
    const targetQuery = selectedIndex >= 0 && suggestions[selectedIndex] ? suggestions[selectedIndex] : query;
    if (targetQuery.trim()) {
      onSearch(targetQuery.trim(), lucky);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        setShowSuggestions(true);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        setShowSuggestions(true);
      }
    } else if (e.key === 'Tab') {
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        e.preventDefault();
        setQuery(suggestions[selectedIndex]);
      } else if (suggestions.length > 0) {
        e.preventDefault();
        setQuery(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className={`w-full ${compact ? 'max-w-3xl' : 'max-w-2xl mx-auto'}`}>
      <form action="/search" method="GET" onSubmit={(e) => handleSubmit(e, false)} className="relative">
        <div
          className={`flex items-center w-full transition-all duration-200 border rounded-2xl bg-white dark:bg-zinc-900 ${
            showSuggestions && suggestions.length > 0 ? 'rounded-b-none' : ''
          } ${
            compact
              ? 'px-3.5 py-2 border-zinc-200 dark:border-zinc-800 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20'
              : 'px-4 sm:px-5 py-3.5 border-zinc-200 dark:border-zinc-800 shadow-md shadow-zinc-200/50 dark:shadow-none hover:border-zinc-300 dark:hover:border-zinc-700 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/15'
          }`}
        >
          <Search className={`shrink-0 text-zinc-400 dark:text-zinc-500 ${compact ? 'w-4 h-4 mr-2.5' : 'w-5 h-5 mr-3.5'}`} />

          <input
            ref={inputRef}
            type="text"
            name="q"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
              setSelectedIndex(-1);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search verified web sources, docs, or use site: intitle: operators..."
            className={`w-full bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none ${
              compact ? 'text-sm' : 'text-base sm:text-lg'
            }`}
            autoComplete="off"
            spellCheck="false"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors mr-1"
              aria-label="Clear query"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            type="submit"
            className={`flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors ${
              compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
            }`}
          >
            Search
          </button>
        </div>

        {/* Deterministic Autocomplete Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-40 bg-white dark:bg-zinc-900 border-x border-b border-zinc-200 dark:border-zinc-800 rounded-b-2xl shadow-xl overflow-hidden py-1">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60 mb-1">
              <span>Deterministic Suggestions</span>
              <span className="text-[10px] font-normal lowercase opacity-75">tab to complete • enter to search</span>
            </div>
            {suggestions.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onMouseDown={() => {
                  setQuery(item);
                  onSearch(item, false);
                  setShowSuggestions(false);
                }}
                className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors ${
                  idx === selectedIndex
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="text-sm truncate">{item}</span>
                </div>
                <CornerDownLeft className="w-3 h-3 text-zinc-400 opacity-60 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Hero mode Action Buttons */}
      {!compact && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={(e) => handleSubmit(e, false)}
            className="px-5 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-sm font-medium border border-zinc-200/80 dark:border-zinc-800 transition-all active:scale-[0.98]"
          >
            NexVora Search
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-sm font-medium border border-zinc-200/80 dark:border-zinc-800 transition-all active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>I'm Feeling Lucky</span>
          </button>
        </div>
      )}

      {/* Category Filter Tabs */}
      {onSelectCategory && (
        <div className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 ${compact ? 'mt-2.5' : 'mt-6 justify-center'}`}>
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            const href = query.trim() ? buildSearchPath(query, cat, 1) : '#';
            return (
              <a
                key={cat}
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectCategory(cat);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200/60 dark:border-zinc-800'
                }`}
              >
                {cat}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
};
