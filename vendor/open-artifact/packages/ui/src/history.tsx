/**
 * The version history panel every editor can mount: versions grouped by day
 * and author, what each changed, a line diff per file, a preview hook, and
 * restoring a whole version or one file (after a confirm).
 *
 * It takes the page's `history` capability (`window.openartifact.history`
 * from `@open-artifact/runtime`) structurally, so this package keeps no
 * dependency on the runtime:
 *
 * ```tsx
 * const history = openartifact.capabilities.history;
 * {history ? <HistoryPanel history={history} viewerId={me.id} onPreview={setPreview} previewing={preview} /> : null}
 * ```
 */
import { ArrowLeft, Eye, FileMinus, FilePen, FilePlus, History as HistoryIcon, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton } from './button.tsx';
import { cn } from './cn.ts';
import { diffHunks, diffLines, diffStats, groupVersions, type DiffLine } from './history-diff.ts';
import { EmptyState, toast } from './layout.tsx';
import { ConfirmDialog } from './overlays.tsx';
import { ScrollBody } from './scroll.tsx';

export * from './history-diff.ts';

/* ------------------------------ Shapes it reads ----------------------------- */

/** Who made a version (the runtime's `HistoryAuthor`). */
export interface HistoryPanelAuthor {
  kind: 'person' | 'agent' | 'system';
  id: string;
  name: string;
}

/** One version (the runtime's `HistoryVersion`). */
export interface HistoryPanelVersion {
  n: number;
  first: string;
  at: string;
  author: HistoryPanelAuthor;
  files: { path: string; op: 'added' | 'edited' | 'deleted' }[];
  restoredFrom?: number;
  current?: true;
  overwrote?: { path: string; n: number; author: HistoryPanelAuthor }[];
}

/** A lost-change notice (the runtime's `HistoryNotice`). */
export interface HistoryPanelNotice {
  id: string;
  at: string;
  path: string;
  n: number;
  author: HistoryPanelAuthor;
  lost: { n: number; author: HistoryPanelAuthor; deleted?: true };
}

/** One path before and after a version (the runtime's `HistoryFileDiff`). */
export interface HistoryPanelDiff {
  path: string;
  n: number;
  op: 'added' | 'edited' | 'deleted';
  before: string | null;
  after: string | null;
  binary?: true;
  tooLarge?: true;
}

/** What the panel calls: the runtime's `HistoryCapability` fits. */
export interface HistoryPanelSource {
  list(): Promise<{ versions: HistoryPanelVersion[]; notices: HistoryPanelNotice[]; canRestore: boolean }>;
  diff(n: number, path: string): Promise<HistoryPanelDiff>;
  restore(n: number, paths?: string[]): Promise<{ version: number | null; changed: string[] }>;
  dismissNotice(id: string): Promise<void>;
  onChange(listener: (event: { n: number | null }) => void): () => void;
}

/** Props of {@link HistoryPanel}. */
export interface HistoryPanelProps {
  history: HistoryPanelSource;
  /** The viewer's id: their versions read "You". */
  viewerId?: string;
  /**
   * Show the artifact as version `n` left it (`null`: back to the current
   * files). Without it there is no Preview button. The page renders the
   * preview itself, e.g. from `history.files(n)` and `history.read(n, path)`.
   */
  onPreview?: (n: number | null) => void;
  /** The version being previewed, highlighted in the list. */
  previewing?: number | null;
  /** After a restore wrote something. */
  onRestored?: (result: { version: number | null; changed: string[] }, from: number) => void;
  /** Shows a close button. */
  onClose?: () => void;
  /** How a path reads (default: without `project/` or `db/`). */
  formatPath?: (path: string) => string;
  className?: string;
}

/* --------------------------------- Helpers --------------------------------- */

function defaultFormatPath(path: string): string {
  return path.replace(/^(project|db)\//, '');
}

function authorName(author: HistoryPanelAuthor, viewerId?: string): string {
  if (author.kind === 'system') return 'Original';
  if (author.kind === 'agent') return author.name || 'Agent';
  if (viewerId && author.id === viewerId) return 'You';
  return author.name || 'Someone';
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function dayLabel(date: Date): string {
  const today = new Date();
  const start = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.getFullYear() === today.getFullYear() ? dateFormat.format(date) : yearFormat.format(date);
}

function timeRange(version: HistoryPanelVersion): string {
  const first = timeFormat.format(new Date(version.first));
  const last = timeFormat.format(new Date(version.at));
  return first === last ? last : `${first} – ${last}`;
}

const OP_ICON = { added: FilePlus, edited: FilePen, deleted: FileMinus } as const;
const OP_TONE = { added: 'text-success', edited: 'text-fg-muted', deleted: 'text-danger' } as const;

function summary(version: HistoryPanelVersion, formatPath: (path: string) => string): string {
  if (version.restoredFrom !== undefined) return `Restored version ${version.restoredFrom}`;
  const files = version.files;
  if (files.length === 1) return `${files[0]!.op === 'edited' ? 'Edited' : files[0]!.op === 'added' ? 'Added' : 'Deleted'} ${formatPath(files[0]!.path)}`;
  return `${files.length} changes`;
}

/** What a pending restore asks for. */
interface PendingRestore {
  n: number;
  paths?: string[];
}

/* ------------------------------------ Diff ----------------------------------- */

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <div
      className={cn(
        'flex min-w-max',
        line.op === '+' && 'bg-success/10 text-fg',
        line.op === '-' && 'bg-danger/10 text-fg',
        line.op === ' ' && 'text-fg-muted',
      )}
    >
      <span className="w-9 shrink-0 select-none pr-1 text-right text-fg-subtle">{line.before ?? ''}</span>
      <span className="w-9 shrink-0 select-none pr-1 text-right text-fg-subtle">{line.after ?? ''}</span>
      <span className={cn('w-4 shrink-0 select-none text-center', line.op === '+' ? 'text-success' : line.op === '-' ? 'text-danger' : '')}>
        {line.op === ' ' ? '' : line.op}
      </span>
      <span className="whitespace-pre pr-3">{line.text || ' '}</span>
    </div>
  );
}

/** A file's line diff, changed parts with three lines of context. */
export function HistoryDiffView({ diff }: { diff: HistoryPanelDiff }) {
  const lines = useMemo(() => (diff.binary || diff.tooLarge ? [] : diffLines(diff.before, diff.after)), [diff]);
  const hunks = useMemo(() => diffHunks(lines), [lines]);
  if (diff.binary) return <p className="p-3 text-xs text-fg-muted">A binary file: no text to compare.</p>;
  if (diff.tooLarge) return <p className="p-3 text-xs text-fg-muted">Too large to compare here.</p>;
  if (!hunks.length) return <p className="p-3 text-xs text-fg-muted">No line changes (only whitespace at the end, or an empty file).</p>;
  const stats = diffStats(lines);
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="px-1 text-xs text-fg-muted">
        <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
      </div>
      {hunks.map((hunk, index) => (
        <div key={index} className="overflow-x-auto rounded-control border border-line font-mono text-[11px] leading-[18px]">
          {hunk.skippedBefore > 0 ? (
            <div className="border-b border-line bg-surface-2 px-2 text-fg-subtle">⋯ {hunk.skippedBefore} unchanged line{hunk.skippedBefore === 1 ? '' : 's'}</div>
          ) : null}
          {hunk.lines.map((line, i) => (
            <DiffRow key={i} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- Panel ----------------------------------- */

/** The version history of the open artifact. */
export function HistoryPanel({ history, viewerId, onPreview, previewing = null, onRestored, onClose, formatPath = defaultFormatPath, className }: HistoryPanelProps) {
  const [listing, setListing] = useState<Awaited<ReturnType<HistoryPanelSource['list']>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [file, setFile] = useState<{ n: number; path: string } | null>(null);
  const [diff, setDiff] = useState<HistoryPanelDiff | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setListing(await history.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [history]);

  useEffect(() => {
    void reload();
    return history.onChange(() => void reload());
  }, [history, reload]);

  useEffect(() => {
    if (!file) return setDiff(null);
    let live = true;
    setDiff(null);
    history.diff(file.n, file.path).then(
      (d) => live && setDiff(d),
      (e: unknown) => live && toast.add({ title: 'Could not load the change', description: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [history, file]);

  const days = useMemo(() => groupVersions(listing?.versions ?? []), [listing]);
  const byN = useMemo(() => new Map((listing?.versions ?? []).map((v) => [v.n, v])), [listing]);

  const restore = async ({ n, paths }: PendingRestore): Promise<void> => {
    setBusy(true);
    try {
      const result = await history.restore(n, paths);
      if (result.version === null) toast.add({ title: 'Nothing to restore', description: `Already the same as version ${n}.` });
      else {
        toast.add({ title: `Restored version ${n}`, description: `${result.changed.length} change${result.changed.length === 1 ? '' : 's'}.` });
        onRestored?.(result, n);
        if (previewing !== null) onPreview?.(null);
      }
      await reload();
    } catch (e) {
      toast.add({ title: 'Could not restore', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const header = (title: ReactNode, back?: () => void) => (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
      {back ? <IconButton label="Back" size="sm" icon={<ArrowLeft className="size-4" />} onClick={back} /> : null}
      <div className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold text-fg">{title}</div>
      {onClose ? <IconButton label="Close" size="sm" icon={<X className="size-4" />} onClick={onClose} /> : null}
    </div>
  );

  const confirm = pending ? (
    <ConfirmDialog
      open
      onOpenChange={(next) => !next && setPending(null)}
      title={pending.paths ? `Restore ${formatPath(pending.paths[0]!)}?` : `Restore version ${pending.n}?`}
      description={
        pending.paths
          ? `It goes back to how version ${pending.n} left it. The current content stays in the history.`
          : `Every file goes back to how version ${pending.n} left it. The current files stay in the history, so this can be undone.`
      }
      confirmLabel="Restore"
      onConfirm={() => {
        const request = pending;
        setPending(null);
        void restore(request);
      }}
    />
  ) : null;

  /* One file's diff. */
  if (file) {
    const version = byN.get(file.n);
    return (
      <div className={cn('flex h-full min-h-0 flex-col bg-surface', className)}>
        {header(formatPath(file.path), () => setFile(null))}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs text-fg-muted">
          <span className="min-w-0 flex-1 truncate">
            Version {file.n}
            {version ? ` · ${authorName(version.author, viewerId)} · ${timeRange(version)}` : ''}
          </span>
          {listing?.canRestore && !version?.current ? (
            <Button size="sm" disabled={busy} icon={<RotateCcw className="size-3.5" />} onClick={() => setPending({ n: file.n, paths: [file.path] })}>
              Restore file
            </Button>
          ) : null}
        </div>
        <ScrollBody className="min-h-0 flex-1 overflow-auto" label="Changes">
          {diff ? <HistoryDiffView diff={diff} /> : <p className="p-3 text-xs text-fg-subtle">Loading…</p>}
        </ScrollBody>
        {confirm}
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-surface', className)}>
      {header('Version history')}
      {listing?.notices.length ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-line p-2">
          {listing.notices.map((notice) => (
            <div key={notice.id} className="flex gap-2 rounded-control bg-surface-2 p-2 text-xs text-fg">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div>
                  <span className="font-medium">{authorName(notice.author, viewerId)}</span> changed{' '}
                  <span className="font-medium">{formatPath(notice.path)}</span> right after you, undoing part of your change.
                </div>
                <div className="flex gap-1">
                  {listing.canRestore ? (
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore({ n: notice.lost.n, paths: [notice.path] })}>
                      Bring mine back
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setFile({ n: notice.n, path: notice.path })}>
                    See change
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void history.dismissNotice(notice.id).then(reload)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <ScrollBody className="min-h-0 flex-1 overflow-auto" label="Versions">
        {error ? (
          <EmptyState title="History unavailable">{error}</EmptyState>
        ) : !listing ? (
          <p className="p-3 text-xs text-fg-subtle">Loading…</p>
        ) : !listing.versions.length ? (
          <EmptyState icon={<HistoryIcon className="size-6" />} title="No versions yet">
            Changes show up here as they are saved.
          </EmptyState>
        ) : (
          days.map((day) => (
            <section key={day.key} className="pb-1">
              <h3 className="sticky top-0 z-[1] bg-surface px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{dayLabel(day.date)}</h3>
              {day.runs.map((run) => (
                <div key={run.versions[0]!.n} className="mx-2 mb-1">
                  <div className="px-1 pb-0.5 pt-1 text-xs font-medium text-fg">{authorName(run.author, viewerId)}</div>
                  {run.versions.map((version) => {
                    const expanded = open === version.n;
                    const isPreview = previewing === version.n;
                    return (
                      <div
                        key={version.n}
                        className={cn('rounded-control', expanded && 'bg-surface-2', isPreview && 'ring-1 ring-accent')}
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="flex w-full min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-xs hover:bg-hover"
                          onClick={() => setOpen(expanded ? null : version.n)}
                        >
                          <span className="w-12 shrink-0 text-fg-subtle">{timeFormat.format(new Date(version.at))}</span>
                          <span className="min-w-0 flex-1 truncate text-fg">{summary(version, formatPath)}</span>
                          {version.overwrote?.length ? <TriangleAlert className="size-3 shrink-0 text-warning" aria-label="Undid a recent change" /> : null}
                          {version.current ? <span className="shrink-0 rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">Current</span> : null}
                          {isPreview ? <span className="shrink-0 text-[10px] font-medium text-accent">Previewing</span> : null}
                        </button>
                        {expanded ? (
                          <div className="flex flex-col gap-1 px-2 pb-2">
                            <div className="text-[11px] text-fg-subtle">
                              Version {version.n} · {timeRange(version)}
                            </div>
                            <ul className="flex flex-col">
                              {version.files.map((change) => {
                                const Icon = OP_ICON[change.op];
                                return (
                                  <li key={change.path} className="group flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-1 py-1 text-left text-xs hover:bg-hover"
                                      onClick={() => setFile({ n: version.n, path: change.path })}
                                      title="Show what changed"
                                    >
                                      <Icon className={cn('size-3.5 shrink-0', OP_TONE[change.op])} />
                                      <span className="min-w-0 flex-1 truncate text-fg">{formatPath(change.path)}</span>
                                      <span className="shrink-0 text-[10px] text-fg-subtle">{change.op}</span>
                                    </button>
                                    {listing.canRestore && !version.current ? (
                                      <IconButton
                                        label={`Restore ${formatPath(change.path)} from this version`}
                                        size="sm"
                                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                        icon={<RotateCcw className="size-3.5" />}
                                        disabled={busy}
                                        onClick={() => setPending({ n: version.n, paths: [change.path] })}
                                      />
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                            {version.overwrote?.length ? (
                              <div className="text-[11px] text-warning">
                                Undid part of{' '}
                                {version.overwrote.map((o) => `${authorName(o.author, viewerId)}’s change to ${formatPath(o.path)}`).join(', ')}.
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-1 pt-1">
                              {onPreview && !version.current ? (
                                <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => onPreview(isPreview ? null : version.n)}>
                                  {isPreview ? 'Stop preview' : 'Preview'}
                                </Button>
                              ) : null}
                              {listing.canRestore && !version.current ? (
                                <Button size="sm" disabled={busy} icon={<RotateCcw className="size-3.5" />} onClick={() => setPending({ n: version.n })}>
                                  Restore this version
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ))
        )}
      </ScrollBody>
      {confirm}
    </div>
  );
}
