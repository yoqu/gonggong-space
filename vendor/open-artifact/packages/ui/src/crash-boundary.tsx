/**
 * {@link CrashBoundary}: keeps a render error in an editor from blanking the
 * page. The subtree below it is replaced by the editor's `fallback` (what
 * happened, how to recover); the error still reaches the console, and any
 * `window.onerror` listener, through `reportError`.
 */

import { Component, type ReactNode } from 'react';

/** Props of {@link CrashBoundary}. */
export interface CrashBoundaryProps {
  children: ReactNode;
  /** Shown in place of `children` after they failed to render. */
  fallback: ReactNode;
}

export class CrashBoundary extends Component<CrashBoundaryProps, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  /** New children after a crash (a remote change, a page switch) get another try. */
  override componentDidUpdate(previous: CrashBoundaryProps, previousState: { crashed: boolean }): void {
    if (previousState.crashed && this.state.crashed && previous.children !== this.props.children) this.setState({ crashed: false });
  }

  override componentDidCatch(error: unknown): void {
    try {
      if (typeof reportError === 'function') reportError(error);
      else console.error(error);
    } catch {
      // Reporting must never throw out of the boundary.
    }
  }

  override render(): ReactNode {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}
