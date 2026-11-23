/**
 * The Slides editor: the slide rail on the left (headed by Add slide and
 * the View menu), the stage in the middle (or the grid / canvas view) with
 * the speaker notes under the slide and the floating cards and toolbar over
 * it, and the properties panel or the comment list on the right; dialogs
 * and the show on top of everything.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Loader2, Plus, Presentation, TriangleAlert } from 'lucide-react';
import { Button, CrashBoundary, EmptyState } from '@open-artifact/ui';
import { useDeck } from './state/deck.ts';
import { useOrder } from './state/outline.ts';
import { useView } from './state/view.ts';
import { installKeyboard } from './keyboard.ts';
import { startPresence, useAgent, usePresence } from './services/agent.ts';
import { installClipboard } from './services/clipboard.ts';
import { addSlide, canChange } from './services/commands.ts';
import { startComments, useComments } from './services/comments.ts';
import { startCreation, useCreation } from './services/creation.ts';
import { startCursors } from './services/cursors.ts';
import { startDesignSystems } from './services/design-systems.ts';
import { HistoryDialog } from './components/HistoryDialog.tsx';
import { startHistory } from './services/history.ts';
import { initialSlide, startLocationSync } from './services/location.ts';
import { pendingRecovery } from './services/recovery.ts';
import { maybeSession, resolveSrc, startSession } from './services/session.ts';
import { startShellBridge } from './services/shell.ts';
import { loadDeck } from './services/sync.ts';
import { syncDeckFonts } from './render/fonts.ts';
import { Banners, useRecoveryOffer } from './components/Banners.tsx';
import { CrashCard } from './components/CrashCard.tsx';
import { CreationAnnouncer, CreationStatus, CreationView } from './components/Creation.tsx';
import { Dialogs } from './components/Dialogs.tsx';
import { FindBar } from './components/FindBar.tsx';
import { Rail } from './components/Rail.tsx';
import { Stage } from './components/Stage.tsx';
import { StageChrome } from './components/StageChrome.tsx';
import { TipGroup } from '@open-artifact/editor-kit/react';
import { guardFileDrops } from '@open-artifact/editor-kit';
import { CommentList } from './components/comments/CommentList.tsx';
import { PropertiesPanel } from './components/properties/PropertiesPanel.tsx';
import { Presenter } from './components/present/Presenter.tsx';
import { CanvasView } from './components/views/CanvasView.tsx';
import { GridView } from './components/views/GridView.tsx';

/** Connects, loads the deck and picks the first slide. Runs once. */
async function boot(): Promise<void> {
  try {
    await startSession();
  } catch (error) {
    useDeck.getState().fail(error instanceof Error ? error.message : String(error));
    return;
  }
  await loadDeck();
  const deck = useDeck.getState();
  if (deck.status !== 'ready') return;
  // Start at the linked slide when opening a shared address.
  useView.getState().showSlide(initialSlide());
  startLocationSync();
  startPresence();
  startCreation();
  const room = maybeSession()?.room;
  if (room) {
    startCursors(room, {
      ids: () => usePresence.getState().peers.map((p) => p.id),
      subscribe: (listener) =>
        usePresence.subscribe((state, previous) => {
          if (state.peers !== previous.peers) listener();
        }),
    });
  }
  startShellBridge();
  void startComments();
  void startHistory();
  startDesignSystems();
  // Unsaved changes from an earlier visit wait for the person's choice.
  if (!deck.readOnly) useRecoveryOffer.getState().set(pendingRecovery());
  document.title = deck.title || 'Slides';
}

let booted = false;

/** The deck has no slides yet. */
function EmptyDeck(): ReactNode {
  const editable = useDeck((s) => !s.readOnly) && canChange();
  const agent = useAgent((s) => s.status);
  const writing = useCreation((s) => s.writing);
  // The agent is writing this deck: its outline as skeleton cells.
  if (writing) return <CreationView />;
  return (
    <EmptyState icon={<Presentation className="size-6" />} title="This presentation has no slides yet">
      <p>{editable ? (agent.available ? `Add one, or ask ${agent.name} to add some.` : 'Add one to get started.') : 'Slides will show here once they are added.'}</p>
      {editable ? (
        <Button className="mt-2" variant="primary" icon={<Plus className="size-4" />} onClick={() => addSlide('blank', null)}>
          Add slide
        </Button>
      ) : null}
    </EmptyState>
  );
}

export function App(): ReactNode {
  const status = useDeck((s) => s.status);
  const error = useDeck((s) => s.error);
  const title = useDeck((s) => s.title);
  const faces = useDeck((s) => s.index.faces);
  const order = useOrder();
  const mode = useView((s) => s.mode);
  const canvasEdit = useView((s) => s.canvasEdit);
  const current = useView((s) => s.current);
  const showRail = useView((s) => s.showRail);
  const showProperties = useView((s) => s.showProperties);

  useEffect(() => {
    if (!booted) {
      booted = true;
      void boot();
    }
    const keyboard = installKeyboard();
    const clipboard = installClipboard();
    const drops = guardFileDrops(window);
    return () => {
      keyboard();
      clipboard();
      drops();
    };
  }, []);

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // The deck's typefaces load into the page (and follow index changes).
  useEffect(() => {
    if (status === 'ready') syncDeckFonts(faces, resolveSrc);
  }, [status, faces]);

  // The slide on stage left the deck (deleted here or elsewhere): show its neighbour.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (status !== 'ready') return;
    const at = current ? order.indexOf(current) : -1;
    if (at >= 0) {
      lastIndex.current = at;
      return;
    }
    const next = order[Math.min(lastIndex.current, order.length - 1)] ?? null;
    if (next !== current) useView.getState().showSlide(next);
  }, [status, order, current]);

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Loader2 className="size-5 animate-spin text-fg-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="h-full bg-canvas">
        <EmptyState icon={<TriangleAlert className="size-6" />} title="This presentation could not be opened">
          {error}
        </EmptyState>
      </div>
    );
  }

  // The one-slide stage is up: the edit view, or a slide edited on the canvas.
  const onStage = mode === 'edit' || canvasEdit;
  const empty = order.length === 0;
  const railShown = mode === 'edit' && showRail && !empty;

  return (
    <CrashBoundary fallback={<CrashCard />}>
      <TipGroup>
        <div className="flex h-full bg-stage text-fg">
          {railShown ? <Rail /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <Banners />
            <main className="relative flex min-h-0 min-w-0 flex-1">
              {mode === 'edit' ? empty ? <EmptyDeck /> : <Stage /> : mode === 'grid' ? <GridView /> : <CanvasView />}
              <StageChrome onStage={onStage && !empty} startCard={!railShown} />
              <FindBar />
              <CreationStatus />
              <CreationAnnouncer />
            </main>
          </div>
          {onStage && showProperties && !empty ? <PropertiesPanel /> : null}
          <CommentList />
          <Dialogs />
          <HistoryDialog />
          <Presenter />
        </div>
      </TipGroup>
    </CrashBoundary>
  );
}
