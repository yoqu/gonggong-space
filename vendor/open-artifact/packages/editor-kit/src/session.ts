/**
 * An editor's connection to its host: installs `window.openartifact` (unless
 * a host already did), resolves the capabilities the editor names, reads the
 * viewer and their role, and connects to the Open Artifact Shell framing the
 * page. Each editor keeps its own `Session` shape (which capabilities it
 * needs, which one it cannot work without) and builds it from
 * {@link connectHost}. Pure (no DOM until called).
 */

import { connectShell, createPageProvider, installRuntime, type CapabilityMap, type CapabilityName, type ShellConnection, type Viewer } from '@open-artifact/runtime';
import { roleAbilities, type RoleAbilities } from './roles.ts';

/** The viewer a host that names no one gets: reads only. */
export const GUEST_VIEWER: Readonly<Viewer> = Object.freeze({ id: 'viewer', name: 'Viewer', role: 'viewer' });

/** The named capabilities; a missing one is `null`. */
export type HostCapabilities<N extends CapabilityName> = { [K in N]: CapabilityMap[K] | null };

/** What {@link connectHost} resolves. */
export interface HostConnection<N extends CapabilityName> {
  caps: HostCapabilities<N>;
  viewer: Viewer;
  /** What the viewer's role allows. */
  abilities: RoleAbilities;
  /** The Open Artifact Shell framing this page, if any. */
  shell: ShellConnection | null;
}

/** Connects to the host and resolves `names` (plus `user`, for the viewer). */
export async function connectHost<const N extends Exclude<CapabilityName, 'user'>>(names: readonly N[]): Promise<HostConnection<N>> {
  const runtime = installRuntime(createPageProvider());
  const [user, ...granted] = await Promise.all([runtime.use('user'), ...names.map((name) => runtime.use(name))]);
  const caps = Object.fromEntries(names.map((name, i) => [name, granted[i] ?? null])) as HostCapabilities<N>;
  const viewer: Viewer = (await user?.me()) ?? { ...GUEST_VIEWER };
  return { caps, viewer, abilities: hostAbilities(viewer.role, (caps as Partial<Record<CapabilityName, unknown>>).downloads as CapabilityMap['downloads'] | null | undefined), shell: connectShell() };
}

/**
 * The role's abilities on this host. A host whose `downloads` saves in the browser (a cloud host) takes every role's
 * files and decides there whether the person may export (a viewer only when the owner allows it), so the page sends
 * them all through it instead of starting a download of its own.
 */
export function hostAbilities(role: Viewer['role'], downloads: Pick<CapabilityMap['downloads'], 'browser'> | null | undefined): RoleAbilities {
  const abilities = roleAbilities(role);
  return downloads?.browser === true ? { ...abilities, canSaveToHost: true } : abilities;
}

/**
 * Whether the person may start an export that the editor otherwise keeps for the owner: the owner, or anyone on a host
 * whose `downloads` saves in the browser (the host refuses a viewer there unless the owner allows it).
 */
export function mayExportHere(role: Viewer['role'], downloads: Pick<CapabilityMap['downloads'], 'browser'> | null | undefined): boolean {
  return role === 'owner' || downloads?.browser === true;
}

/** Holds an editor's session once it started. */
export interface SessionSlot<S> {
  /** The session; throws before it started. */
  session(): S;
  /** The session, or `null` before it started (code that may run early). */
  maybeSession(): S | null;
  /** Stores the started session and returns it. */
  set(session: S): S;
}

/** A {@link SessionSlot}. */
export function sessionSlot<S>(): SessionSlot<S> {
  let current: S | null = null;
  return {
    session() {
      if (current === null) throw new Error('The session has not started.');
      return current;
    },
    maybeSession: () => current,
    set: (session) => (current = session),
  };
}

/** The artifact path of a project path. */
export const artifactPath = (path: string): string => `project/${path}`;

/** The project path of an artifact path, or `null` outside `project/`. */
export const projectPath = (path: string): string | null => (path.startsWith('project/') ? path.slice('project/'.length) : null);
