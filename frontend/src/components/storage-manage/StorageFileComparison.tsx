import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { FileDiffEntry, FilesDiffResult } from '../../api';

type StorageFileComparisonProps = {
  diffData: FilesDiffResult | null;
  loading: boolean;
  selectedIds: Set<string>;
  onRefresh: () => void;
  onRequestDelete: () => void;
  onToggle: (fileId: string) => void;
};

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '\u2014';
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function StatusIcon({ active, present }: { active?: boolean; present: boolean }) {
  if (active) {
    return <span className="text-emerald-600 dark:text-emerald-400 font-bold" title="Active">{'\u2713'}</span>;
  }
  if (present) {
    return <span className="text-amber-500 dark:text-amber-400 font-bold" title="History-only">{'\u25D0'}</span>;
  }
  return <span className="text-neutral-400 dark:text-neutral-500 font-bold" title="Missing">{'\u2717'}</span>;
}

export const StorageFileComparison = ({
  diffData,
  loading,
  selectedIds,
  onRefresh,
  onRequestDelete,
  onToggle,
}: StorageFileComparisonProps) => (
  <div>
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
        File Comparison
      </h3>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="px-3 py-1.5 text-sm font-bold rounded-xl border-2 border-black dark:border-neutral-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[1px_1px_0px_0px_rgba(255,255,255,0.08)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 disabled:opacity-50"
      >
        <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
        Refresh
      </button>
    </div>

    {loading && !diffData ? (
      <div className="flex items-center justify-center py-12 text-neutral-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    ) : diffData ? (
      <>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
          Canvas refs: <span className="font-semibold text-neutral-700 dark:text-neutral-300">{diffData.summary.totalCanvasRefs}</span>
          {' \u00B7 '}SQLite: <span className="font-semibold text-neutral-700 dark:text-neutral-300">{diffData.summary.totalSqliteFiles}</span>
          {' \u00B7 '}S3: <span className="font-semibold text-neutral-700 dark:text-neutral-300">{diffData.summary.totalS3Files}</span>
        </p>

        <div className="border-2 border-black dark:border-neutral-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-100 dark:bg-neutral-800 border-b-2 border-black dark:border-neutral-700">
                  <th className="w-10 px-3 py-2 text-center">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 text-left font-bold text-neutral-700 dark:text-neutral-300">File ID</th>
                  <th className="px-3 py-2 text-center font-bold text-neutral-700 dark:text-neutral-300">Canvas</th>
                  <th className="px-3 py-2 text-center font-bold text-neutral-700 dark:text-neutral-300">SQLite</th>
                  <th className="px-3 py-2 text-center font-bold text-neutral-700 dark:text-neutral-300">S3</th>
                  <th className="px-3 py-2 text-right font-bold text-neutral-700 dark:text-neutral-300">Size</th>
                </tr>
              </thead>
              <tbody>
                {diffData.files.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">
                      No files found.
                    </td>
                  </tr>
                ) : (
                  diffData.files.map((file: FileDiffEntry) => (
                    <tr
                      key={file.fileId}
                      className="border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(file.fileId)}
                          disabled={file.inCanvasActive}
                          onChange={() => onToggle(file.fileId)}
                          className="accent-rose-600 w-4 h-4 disabled:opacity-30"
                        />
                      </td>
                      <td className="px-3 py-2 text-neutral-900 dark:text-neutral-100 font-mono text-xs truncate max-w-[200px]" title={file.fileId}>
                        {file.fileId}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusIcon active={file.inCanvasActive} present={file.inCanvas} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusIcon present={file.inSqlite} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusIcon present={file.inS3} />
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-600 dark:text-neutral-400 tabular-nums">
                        {formatSize(file.s3SizeBytes)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex gap-4 mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span><span className="text-emerald-600 dark:text-emerald-400 font-bold">{'\u2713'}</span> active</span>
          <span><span className="text-amber-500 dark:text-amber-400 font-bold">{'\u25D0'}</span> history-only</span>
          <span><span className="text-neutral-400 dark:text-neutral-500 font-bold">{'\u2717'}</span> missing</span>
        </div>

        <div className="mt-4">
          <button
            onClick={onRequestDelete}
            disabled={selectedIds.size === 0}
            className="px-4 py-2.5 font-bold rounded-xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 bg-rose-600 text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:hover:translate-y-0"
          >
            <Trash2 size={16} />
            Delete Selected Orphans ({selectedIds.size})
          </button>
        </div>
      </>
    ) : null}
  </div>
);
