import type { ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from '@open-artifact/ui';

/**
 * Shown when the editor failed to draw: changes are saved as they are made,
 * so a reload loses nothing. `viewing`: the read-only view, with nothing to save.
 */
export function CrashCard({ viewing = false }: { viewing?: boolean }): ReactNode {
  return (
    <div data-testid="slides-crashed" className="h-full bg-canvas">
      <EmptyState icon={<TriangleAlert className="size-6" />} title="Something went wrong showing this presentation">
        <p role="alert">{viewing ? 'Reload to try again.' : 'Your changes are saved as you make them. Reload to try again.'}</p>
        <Button className="mt-2" variant="secondary" icon={<RotateCw className="size-4" />} onClick={() => window.location.reload()}>
          Reload
        </Button>
      </EmptyState>
    </div>
  );
}
