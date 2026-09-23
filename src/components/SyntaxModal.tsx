import React from 'react';
import { X, Search, HelpCircle, ArrowUpRight } from 'lucide-react';

interface SyntaxModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (query: string) => void;
}

export const SyntaxModal: React.FC<SyntaxModalProps> = ({
  isOpen,
  onClose,
  onSelectQuery,
}) => {
  if (!isOpen) return null;

  const examples = [
    {
      operator: 'site:domain.com',
      description: 'Restricts search results strictly to a specific domain or host.',
      example: 'python tutorial site:docs.python.org',
    },
    {
      operator: 'intitle:term',
      description: 'Ensures that the specified keyword appears directly in the page title.',
      example: 'intitle:bangladesh portal',
    },
    {
      operator: 'inurl:term',
      description: 'Filters documents where the given term appears in the URL path.',
      example: 'inurl:docs typescript',
    },
    {
      operator: '"exact phrase"',
      description: 'Finds documents containing the exact sequence of words in quotation marks.',
      example: '"relational database" postgresql',
    },
    {
      operator: '-term',
      description: 'Excludes any results containing the negated term.',
      example: 'programming -deprecated',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Deterministic Search Operators</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Refine queries using standard Boolean and field filters</p>
          </div>
        </div>

        <div className="space-y-3">
          {examples.map((item, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 mb-0.5">
                  {item.operator}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {item.description}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSelectQuery(item.example);
                  onClose();
                }}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 text-xs font-mono text-zinc-700 dark:text-zinc-300 hover:text-blue-600 transition-colors self-start sm:self-auto"
              >
                <span>{item.example}</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
