import React from 'react';
import { Database, FileText, HelpCircle, Info, Moon, Sun } from 'lucide-react';

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAbout: () => void;
  onOpenSources: () => void;
  onOpenSyntax: () => void;
  compact?: boolean;
  onResetSearch?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  onOpenAbout,
  onOpenSources,
  onOpenSyntax,
  compact = false,
  onResetSearch,
}) => {
  return (
    <header className={`w-full flex items-center justify-between px-4 sm:px-8 py-3.5 border-b transition-colors ${
      compact ? 'border-zinc-200 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur sticky top-0 z-30' : 'border-transparent'
    }`}>
      {/* Brand logo in compact mode */}
      {compact ? (
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onResetSearch?.();
          }}
          className="flex items-center gap-2 group text-left transition-opacity hover:opacity-90 cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <span className="font-extrabold text-base tracking-tighter">N</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 font-sans">
              Nex<span className="text-blue-600 dark:text-blue-400">Vora</span>
            </span>
          </div>
        </a>
      ) : (
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">
            Zero AI • Deterministic BM25
          </span>
        </div>
      )}

      {/* Nav Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 text-sm">
        <button
          onClick={onOpenSources}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors text-xs sm:text-sm font-medium"
          title="GitHub Sources Registry"
        >
          <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="hidden sm:inline">Sources Registry</span>
        </button>

        <button
          onClick={onOpenSyntax}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors text-xs sm:text-sm font-medium"
          title="Search Operators & Syntax"
        >
          <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline">Syntax</span>
        </button>

        <button
          onClick={onOpenAbout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors text-xs sm:text-sm font-medium"
          title="About NexVora"
        >
          <Info className="w-4 h-4 text-zinc-500" />
          <span className="hidden sm:inline">About</span>
        </button>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />

        <button
          onClick={onToggleDarkMode}
          className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          aria-label="Toggle dark mode"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-zinc-700" />}
        </button>
      </div>
    </header>
  );
};
