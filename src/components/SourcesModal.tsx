import React, { useEffect, useState } from 'react';
import { X, GitBranch, FileText, CheckCircle2, RefreshCw, Clock, Radio } from 'lucide-react';

interface SourceFileItem {
  id: string;
  filePath: string;
  category: string;
  urlCount: number;
  lastSyncedAt: string;
  fileHash: string;
}

interface PollerInfo {
  enabled: boolean;
  isPolling: boolean;
  mode: 'remote_github' | 'local_sources';
  repo: string | null;
  branch: string;
  pollIntervalSec: number;
  lastPollTime: string | null;
  lastPollStatus: string;
  nextScheduledPollTime: string | null;
}

interface SourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SourcesModal: React.FC<SourcesModalProps> = ({ isOpen, onClose }) => {
  const [sources, setSources] = useState<SourceFileItem[]>([]);
  const [poller, setPoller] = useState<PollerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSources();
    }
  }, [isOpen]);

  const loadSources = () => {
    setLoading(true);
    fetch('/api/sources')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.files)) {
          setSources(data.files);
        }
        if (data && data.poller) {
          setPoller(data.poller);
        }
      })
      .catch((err) => console.error('Error fetching sources:', err))
      .finally(() => setLoading(false));
  };

  const handleManualSync = () => {
    setSyncing(true);
    setSyncStatusMsg(null);
    fetch('/api/sync/trigger', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.pollResult) {
          const pr = data.pollResult;
          setSyncStatusMsg(
            pr.hasChanges
              ? `Sync complete: ${pr.enqueuedUrls || 0} seeds enqueued, ${pr.indexedCount || 0} indexed.`
              : 'Repository checked: All sources up-to-date (no changes detected).'
          );
          loadSources();
        } else {
          setSyncStatusMsg('Sync finished.');
          loadSources();
        }
      })
      .catch(() => {
        setSyncStatusMsg('Sync trigger failed.');
      })
      .finally(() => setSyncing(false));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900/50">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">GitHub Source Center</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Primary sync: Autonomous GitHub polling (Webhooks optional)
              </p>
            </div>
          </div>

          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Poll & Sync Now'}</span>
          </button>
        </div>

        {/* Poller Status Ribbon */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-500 shrink-0 animate-pulse" />
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-semibold">Sync Mode</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {poller?.mode === 'remote_github' ? 'GitHub API Polling' : 'Autonomous Polling'}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500 shrink-0" />
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-semibold">Interval</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                Every {poller?.pollIntervalSec || 300}s ({Math.round((poller?.pollIntervalSec || 300) / 60)} min)
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-semibold">Webhooks</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Optional (Auto-Active)</span>
            </div>
          </div>
        </div>

        {syncStatusMsg && (
          <div className="mb-4 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{syncStatusMsg}</span>
          </div>
        )}

        <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed bg-zinc-50 dark:bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
          <p className="font-medium text-zinc-800 dark:text-zinc-200 mb-1">Autonomous GitHub Synchronization:</p>
          NexVora polls your GitHub repository automatically at the configured interval. Public repositories operate seamlessly with no token required. Add, modify, or delete plain <code>.txt</code> files (one URL per line) inside <code>sources/&lt;Category&gt;/&lt;file&gt;.txt</code>. Changes trigger the automated <strong>sync &rarr; crawl &rarr; categorize &rarr; index</strong> pipeline.
        </div>

        {/* Source File Table */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 grid grid-cols-12 gap-2">
            <div className="col-span-6">File Path</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-3 text-right">Seed URLs</div>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-72 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-xs text-zinc-500">Loading sources...</div>
            ) : sources.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">No source files scanned yet.</div>
            ) : (
              sources.map((file) => (
                <div key={file.id} className="px-4 py-2.5 text-xs grid grid-cols-12 gap-2 items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                  <div className="col-span-6 flex items-center gap-2 truncate">
                    <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate">{file.filePath}</span>
                  </div>
                  <div className="col-span-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {file.category}
                    </span>
                  </div>
                  <div className="col-span-3 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">
                    {file.urlCount} seeds
                  </div>
                </div>
              ))
            )}
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
