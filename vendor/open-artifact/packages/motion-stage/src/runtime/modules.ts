import type { StageModule, StageModuleKind } from '../protocol.ts';
import { guarded } from './console.ts';

interface HeldModule {
  kind: StageModuleKind;
  text: string;
}

const modules = new Map<string, HeldModule>();

/** The global through which injected code finds the kit it was given: read once, at the top of each script. */
export const KIT_GLOBAL = '__stageKit';

export function addModules(list: readonly StageModule[]): void {
  for (const module of list) modules.set(module.name, { kind: module.kind, text: module.text });
}

export const moduleNames = (): string[] => [...modules.keys()];

/** By its whole name, or by a bare stem that only one module has: "scenes" finds "scenes.json". */
export function findModule(name: string): HeldModule | null {
  const exact = modules.get(name);
  if (exact) return exact;
  if (name.includes('.')) return null;
  const hits = [...modules.keys()].filter((key) => key.startsWith(name + '.') && key.indexOf('.', name.length + 1) < 0);
  const only = hits.length === 1 ? hits[0] : undefined;
  return only === undefined ? null : (modules.get(only) ?? null);
}

/**
 * Runs code in the page with `kit` in reach. What it throws surfaces through the window's error event. `own`: strict
 * code in a function's scope, so that no top-level name reaches window, where another module's could meet it.
 */
export function injectScript(code: string, label: string, own: boolean = false): void {
  const script = document.createElement('script');
  script.text =
    (own ? `(function () { "use strict"; const kit = window.${KIT_GLOBAL};\n` : `{ const kit = window.${KIT_GLOBAL};\n`) +
    code +
    (own ? '\n})();' : '\n}') +
    '\n//# sourceURL=' +
    label.replace(/[^A-Za-z0-9_./ -]/g, '_') +
    '\n';
  document.body.appendChild(script);
  script.remove();
}

export function setScriptKit(kit: unknown): void {
  Reflect.set(window, KIT_GLOBAL, kit);
}

/**
 * Runs code with `kit` as its kit and gives back what it threw, or null: a script put into the page throws to the
 * window's error event during the call, never to the caller, so a try alone would catch nothing.
 */
export function tryScript(code: string, label: string, kit: unknown, own: boolean): unknown {
  const outerKit: unknown = Reflect.get(window, KIT_GLOBAL);
  setScriptKit(kit);
  try {
    return guarded(() => injectScript(code, label, own));
  } finally {
    setScriptKit(outerKit);
  }
}
