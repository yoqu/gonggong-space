/**
 * Installs `window.openartifact` on top of a capability provider.
 *
 * The provider is whatever actually implements the capabilities: the local
 * type server ({@link createLocalProvider}), a test double, or a bridge to a
 * remote host. This module adds the guarantees every page relies on:
 * memoized and frozen namespaces, and a timeout so a missing host resolves to
 * `null` instead of hanging forever.
 */

import {
  CONTRACT_VERSION,
  type CapabilityMap,
  type CapabilityName,
  type OpenArtifactRuntime,
} from './capabilities.ts';

/** Something that can produce capability namespaces. */
export interface CapabilityProvider {
  /** Returns the namespace, or `null` when this view may not use it. */
  get<K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null> | CapabilityMap[K] | null;
}

/** Options of {@link createRuntime}. */
export interface RuntimeOptions {
  /** Milliseconds before an unanswered `use()` resolves to `null`. Default 10 000. */
  timeoutMs?: number;
}

/** Builds a runtime object without installing it globally. */
export function createRuntime(provider: CapabilityProvider, options: RuntimeOptions = {}): OpenArtifactRuntime {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const cache = new Map<CapabilityName, Promise<unknown>>();

  const use = <K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null> => {
    const cached = cache.get(name);
    if (cached) return cached as Promise<CapabilityMap[K] | null>;

    const pending = new Promise<CapabilityMap[K] | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      Promise.resolve()
        .then(() => provider.get(name))
        .then(
          (namespace) => {
            clearTimeout(timer);
            resolve(namespace ? (Object.freeze(namespace) as CapabilityMap[K]) : null);
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          },
        );
    });
    cache.set(name, pending);
    return pending;
  };

  return Object.freeze({ version: CONTRACT_VERSION, use });
}

/**
 * Installs the runtime at `window.openartifact` (once) and returns it.
 * A runtime already installed by the host wins: pages call this defensively.
 */
export function installRuntime(provider: CapabilityProvider, options?: RuntimeOptions): OpenArtifactRuntime {
  const existing = globalThis.window?.openartifact;
  if (existing) return existing;
  const runtime = createRuntime(provider, options);
  Object.defineProperty(window, 'openartifact', {
    value: runtime,
    configurable: false,
    enumerable: true,
    writable: false,
  });
  return runtime;
}

/** Shortcut for `window.openartifact?.use(name)` that never throws. */
export async function useCapability<K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null> {
  const runtime = globalThis.window?.openartifact;
  if (!runtime) return null;
  try {
    return await runtime.use(name);
  } catch {
    return null;
  }
}
