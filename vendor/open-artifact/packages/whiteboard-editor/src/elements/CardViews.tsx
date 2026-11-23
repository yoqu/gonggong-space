/**
 * Views of card-like elements: link cards (to an artifact or a web page),
 * tables and shared countdown timers.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  ArrowUpRight,
  Clapperboard,
  FileText,
  Globe,
  LayoutDashboard,
  Palette,
  Pause,
  PenTool,
  Play,
  Presentation,
  RotateCcw,
  Shapes,
  type LucideIcon,
} from 'lucide-react';
import { IconButton } from '@open-artifact/ui';
import {
  LINK_CARD_SIZE,
  TABLE_CELL_PADDING,
  TEXT_PROFILES,
  TIMER_HEIGHT,
  TIMER_WIDTH,
  applyTimerAction,
  chipColorOn,
  columnWidth,
  formatTimerDuration,
  formatTimerFace,
  isTimerEnded,
  isTimerRunning,
  isTimerUnstarted,
  linkSubtitle,
  linkTitle,
  tableCellPaints,
  tableCellValue,
  tableColumnIds,
  tableFontSize,
  tableRowIds,
  tableWidth,
  timerRemainingMs,
  type LinkElement,
  type LinkKind,
  type TableCellPaint,
  type TableElement,
  type TimerElement,
} from '@open-artifact/whiteboard-core';
import { TABLE_LINE_COLORS, TABLE_RADIUS, tableHeadColors, tableHeadWeight, tableTintDividers, type TableCellDividers } from '../export/look.ts';
import { announce } from '../services/announce.ts';
import { TABLE_EDITOR_HINT, flushTableCell, pasteTableCells, typeTableCell } from '../services/table-edits.ts';
import { maybeSession } from '../services/session.ts';
import { updateElements } from '../state/board.ts';
import { useColorScheme } from '../state/theme.ts';
import { useMeasureNode } from './hooks.ts';
import { useItemProps } from './item.tsx';
import { boardLinkTarget } from './links.ts';
import { RichText } from './markup.tsx';
import { PassiveLink } from './PassiveLink.tsx';
import { rotationStyle, type ViewStyle } from './style.ts';
import { TableControls, useTableControls } from './TableControls.tsx';
import { TextEditor, useEditing } from './TextEditor.tsx';

/* ------------------------------------------------------------------------ */
/* Link card                                                                */
/* ------------------------------------------------------------------------ */

/** The icon of each kind of linked artifact. */
const LINK_ICONS: Readonly<Record<LinkKind, LucideIcon>> = {
  whiteboard: Shapes,
  design: PenTool,
  'design-system': Palette,
  slides: Presentation,
  doc: FileText,
  dashboard: LayoutDashboard,
  motion: Clapperboard,
  web: Globe,
};

/** A link card: the kind's icon, the title and address, and an open arrow. */
export const LinkView = memo(function LinkView({ element }: { element: LinkElement }) {
  const item = useItemProps(element);
  const Icon = (element.kind !== undefined ? LINK_ICONS[element.kind] : undefined) ?? AppWindow;
  const target = boardLinkTarget(element.href);
  const style: ViewStyle = { left: element.x, top: element.y, width: LINK_CARD_SIZE.w, height: LINK_CARD_SIZE.h, ...rotationStyle(element) };
  const face = (
    <>
      <span className="al-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="al-text">
        <span className="al-title">{linkTitle(element)}</span>
        <span className="al-sub">{linkSubtitle(element)}</span>
      </span>
      <span className="al-go" data-wb-opens="" aria-hidden="true">
        <ArrowUpRight size={16} />
      </span>
    </>
  );
  return (
    <div {...item} className="wb-el wb-link" style={style}>
      {target !== undefined ? (
        <PassiveLink href={target} link={element.href} className="al-face">
          {face}
        </PassiveLink>
      ) : (
        <div className="al-face" data-wb-link={element.href}>
          {face}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* Table                                                                    */
/* ------------------------------------------------------------------------ */

/** A tinted cell's colors: its background, text and code chips, and the paper-colored dividers toward tinted neighbors. */
function tintedCellStyle(paint: TableCellPaint, dividers: TableCellDividers | undefined): ViewStyle {
  return {
    background: paint.fill,
    '--wb-paper-chip': chipColorOn(paint.fill),
    ...(paint.ink !== undefined ? { color: paint.ink } : {}),
    ...(dividers?.right ? { borderRightColor: 'var(--wb-paper)' } : {}),
    ...(dividers?.bottom ? { borderBottomColor: 'var(--wb-paper)' } : {}),
  };
}

/** A table: a grid of rich-text cells, its first row a header when `head` is set; cells may be tinted by a fill or a heat map. */
export const TableView = memo(function TableView({ element }: { element: TableElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'cell');
  const ref = useMeasureNode<HTMLDivElement>(element.id, 'h', `${JSON.stringify(element.rows)}|${JSON.stringify(element.cols)}|${element.size ?? ''}|${editing?.row ?? ''}`);
  const columns = tableColumnIds(element);
  const rows = tableRowIds(element);
  const head = tableHeadColors(element, scheme);
  const paints = useMemo(() => tableCellPaints(element, scheme), [element, scheme]);
  const dividers = useMemo(() => tableTintDividers(element, paints), [element, paints]);
  const px = tableFontSize(element);
  const style: ViewStyle = {
    left: element.x,
    top: element.y,
    width: tableWidth(element),
    ...rotationStyle(element),
    fontSize: px,
    lineHeight: TABLE_CELL_PADDING.line,
    borderRadius: TABLE_RADIUS,
    '--wb-table-line': TABLE_LINE_COLORS[scheme],
    '--wb-table-head': head.fill,
    '--wb-table-head-ink': head.ink,
    '--wb-table-head-chip': head.chip,
    '--wb-table-head-weight': tableHeadWeight(element),
    '--wb-cell-pad': `${TABLE_CELL_PADDING.padY}px ${TABLE_CELL_PADDING.padX}px`,
  };
  const font = { px, weight: 400, bold: 700 };
  const controls = useTableControls(element);
  return (
    <div {...item} ref={ref} className="wb-el wb-table" style={style}>
      <div className="wb-table-frame">
        <table>
          <colgroup>
            {columns.map((col) => (
              <col key={col} style={{ width: columnWidth(element, col) }} />
            ))}
          </colgroup>
          <tbody>
            {rows.map((row, index) => {
              const isHead = element.head && index === 0;
              return (
                <tr key={row} className={isHead ? 'wb-table-head' : undefined}>
                  {columns.map((col, colIndex) => {
                    const text = tableCellValue(element, row, col);
                    const Cell = isHead ? 'th' : 'td';
                    const cellEditing = editing !== null && editing.row === row && editing.col === col ? editing : null;
                    const paint = paints[row]?.[col];
                    return (
                      <Cell
                        key={col}
                        data-wb-row={row}
                        data-wb-col={col}
                        {...(paint !== undefined ? { 'data-wb-tint': paint.fill, style: tintedCellStyle(paint, dividers[row]?.[col]) } : {})}
                      >
                        {cellEditing ? (
                          <TextEditor
                            target={cellEditing}
                            value={text}
                            onChange={(next) => typeTableCell(element.id, row, col, next)}
                            onEnd={() => flushTableCell({ id: element.id, row, col })}
                            onPasteText={(pasted) => pasteTableCells(element.id, row, col, pasted)}
                            profile={TEXT_PROFILES.cell}
                            label={`Edit cell, row ${index + 1}, column ${colIndex + 1}`}
                            describedBy={`wb-${element.id}-keys`}
                          />
                        ) : (
                          <RichText text={text} profile={TEXT_PROFILES.cell} font={font} />
                        )}
                      </Cell>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {controls !== undefined ? <TableControls element={element} scale={controls} /> : null}
      {editing !== null ? (
        <span id={`wb-${element.id}-keys`} hidden>
          {TABLE_EDITOR_HINT}
        </span>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* Timer                                                                    */
/* ------------------------------------------------------------------------ */

/** How often a running timer's face updates, in milliseconds. */
const TIMER_TICK_MS = 250;

/** The current time, updated every tick while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/** Applies a timer action ("start", "pause", "reset") to a timer element. */
function runTimerAction(id: TimerElement['id'], action: 'start' | 'pause' | 'reset'): void {
  const now = Date.now();
  const labels = { start: 'Start timer', pause: 'Pause timer', reset: 'Reset timer' } as const;
  updateElements([id], (element) => (element.type === 'timer' ? { ...element, ...applyTimerAction(element, action, now) } : element), { label: labels[action] });
}

/**
 * A shared countdown: its mm:ss face, a status line, and Start/Pause and
 * Reset buttons for people who can edit. Reaching zero is announced.
 */
export const TimerView = memo(function TimerView({ element }: { element: TimerElement }) {
  const item = useItemProps(element);
  const running = isTimerRunning(element, Date.now());
  const now = useNow(running);
  const remaining = timerRemainingMs(element, now);
  const ended = isTimerEnded(element, now);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && ended) announce('Time’s up');
    wasRunning.current = running && !ended;
  }, [running, ended]);
  const canEdit = maybeSession()?.canEdit ?? false;
  const status = ended ? 'Time’s up' : running ? 'Shared countdown' : isTimerUnstarted(element) ? `${formatTimerDuration(element.durationMs)} timer` : `Paused · ${formatTimerDuration(remaining)} left`;
  const style: ViewStyle = { left: element.x, top: element.y, width: TIMER_WIDTH, height: TIMER_HEIGHT, ...rotationStyle(element) };
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div {...item} className="wb-el wb-timer" style={style} {...(ended ? { 'data-ended': '' } : {})} {...(running && !ended ? { 'data-running': '' } : {})}>
      <div className="wb-timer-face" aria-hidden="true">
        {formatTimerFace(remaining)}
      </div>
      <div className="wb-timer-sub">{status}</div>
      {canEdit ? (
        <div className="wb-timer-actions" data-no-pan="" onPointerDown={stop}>
          <IconButton
            size="sm"
            label={running && !ended ? 'Pause' : 'Start'}
            icon={running && !ended ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => runTimerAction(element.id, running && !ended ? 'pause' : 'start')}
          />
          <IconButton size="sm" label="Reset" icon={<RotateCcw size={14} />} onClick={() => runTimerAction(element.id, 'reset')} />
        </div>
      ) : null}
    </div>
  );
});
