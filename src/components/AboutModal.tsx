import React from 'react';
import { X, ShieldCheck, Cpu, GitBranch, Search, Scale, FileText } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

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

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <span className="font-extrabold text-xl">N</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">About NexVora Search</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Independent • Deterministic • Zero AI</p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          <p>
            <strong>NexVora Search</strong> is an independent, production-grade web search engine engineered from scratch.
            It provides fast, transparent information retrieval using deterministic ranking, autonomous web crawling, and
            GitHub-controlled source governance.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
              <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                <Cpu className="w-4 h-4 text-rose-500" />
                <span>Zero AI / Zero LLMs</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Production uses NO OpenAI, NO Gemini, NO Claude, NO embeddings, and NO vector models. Rankings are 100% explainable and free from generative hallucinations.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
              <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                <GitBranch className="w-4 h-4 text-blue-500" />
                <span>GitHub as Control Center</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No Admin Panel exists on the site. All seed URLs and categories are managed as plain <code>.txt</code> files in GitHub repositories, synchronized via webhooks.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
              <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                <Scale className="w-4 h-4 text-emerald-500" />
                <span>BM25 Ranking Algorithm</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Mathematically proven Okapi BM25 scoring with title, heading, and description boosts, phrase bonuses, and freshness signals.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
              <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                <ShieldCheck className="w-4 h-4 text-indigo-500" />
                <span>Polite Autonomous Crawler</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Full robots.txt compliance, crawl-delay enforcement, SSRF private IP protection, XML sitemap parsing, and SHA-256 deduplication.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-blue-200/80 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 text-xs text-blue-900 dark:text-blue-200">
            <h4 className="font-semibold mb-1 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Privacy Commitment
            </h4>
            <p>
              NexVora does not track individual user identities, does not profile search behavior, does not sell search queries, and removes all URL tracking parameters (such as <code>utm_*</code> and <code>fbclid</code>) prior to indexing.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
