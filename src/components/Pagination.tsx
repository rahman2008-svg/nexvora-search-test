import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildSearchPath } from '../lib/search-url.ts';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  query?: string;
  category?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  query = '',
  category = 'All',
}) => {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  const getPageHref = (pageNumber: number) => {
    return query ? buildSearchPath(query, category, pageNumber) : '#';
  };

  return (
    <nav className="flex items-center gap-1.5 py-8" aria-label="Pagination Navigation">
      <a
        href={currentPage > 1 ? getPageHref(currentPage - 1) : '#'}
        onClick={(e) => {
          e.preventDefault();
          if (currentPage > 1) onPageChange(currentPage - 1);
        }}
        aria-disabled={currentPage <= 1}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors ${
          currentPage <= 1
            ? 'opacity-40 cursor-not-allowed pointer-events-none'
            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Previous</span>
      </a>

      {start > 1 && (
        <>
          <a
            href={getPageHref(1)}
            onClick={(e) => {
              e.preventDefault();
              onPageChange(1);
            }}
            className="w-8 h-8 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center"
          >
            1
          </a>
          {start > 2 && <span className="px-1 text-zinc-400">...</span>}
        </>
      )}

      {pages.map((p) => {
        const isCurrent = p === currentPage;
        return (
          <a
            key={p}
            href={getPageHref(p)}
            onClick={(e) => {
              e.preventDefault();
              onPageChange(p);
            }}
            aria-current={isCurrent ? 'page' : undefined}
            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors flex items-center justify-center ${
              isCurrent
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {p}
          </a>
        );
      })}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-zinc-400">...</span>}
          <a
            href={getPageHref(totalPages)}
            onClick={(e) => {
              e.preventDefault();
              onPageChange(totalPages);
            }}
            className="w-8 h-8 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center"
          >
            {totalPages}
          </a>
        </>
      )}

      <a
        href={currentPage < totalPages ? getPageHref(currentPage + 1) : '#'}
        onClick={(e) => {
          e.preventDefault();
          if (currentPage < totalPages) onPageChange(currentPage + 1);
        }}
        aria-disabled={currentPage >= totalPages}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors ${
          currentPage >= totalPages
            ? 'opacity-40 cursor-not-allowed pointer-events-none'
            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="w-4 h-4" />
      </a>
    </nav>
  );
};
