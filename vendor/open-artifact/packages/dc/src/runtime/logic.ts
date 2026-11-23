/**
 * The `DCLogic` base class and loading of an artboard's logic script.
 *
 * Authors write `class Component extends DCLogic { renderVals() { … } }` as
 * plain classic JavaScript. They get a React class component minus
 * `render()`: `this.props`, `state` / `setState` / `forceUpdate`, the
 * lifecycle methods. The runtime supplies `render()`, which calls
 * `renderVals()` and renders the template with the result.
 */

import { Component as ReactComponent, createRef, type ReactNode } from 'react';

/** Renders the template with the values a logic instance returned. */
export type TemplateRenderer = (values: Record<string, unknown>) => ReactNode;

/** Instance shape of a logic class. */
export interface DCLogicInstance extends ReactComponent<Record<string, unknown>, Record<string, unknown>> {
  renderVals(): Record<string, unknown>;
}

/** Constructor of a logic class. */
export type DCLogicClass = new (props: Record<string, unknown>) => DCLogicInstance;

/**
 * Creates the `DCLogic` base for one artboard. The renderer is read on every
 * render, so a template change shows without remounting (state survives).
 */
export function createLogicBase(getRenderer: () => TemplateRenderer): DCLogicClass {
  class DCLogic extends ReactComponent<Record<string, unknown>, Record<string, unknown>> {
    override state: Record<string, unknown> = {};
    /** Returns the template's inputs. Override in the artboard's class. */
    renderVals(): Record<string, unknown> {
      return {};
    }
    /** Convenience for refs returned from `renderVals()`. */
    createRef = createRef;
    override render(): ReactNode {
      const values = this.renderVals();
      return getRenderer()(values && typeof values === 'object' ? values : {});
    }
  }
  return DCLogic as unknown as DCLogicClass;
}

/**
 * Evaluates a logic script and returns its `Component` class.
 *
 * The script is classic JavaScript with no imports; it sees `DCLogic` and
 * `React` as globals. Throws with a readable message when the script fails
 * or does not define `class Component extends DCLogic`.
 */
export function evaluateLogic(body: string, base: DCLogicClass, react: unknown, label: string): DCLogicClass {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'DCLogic',
    'React',
    `"use strict";\n${body}\n;return typeof Component === "function" ? Component : null;\n//# sourceURL=${label.replace(/[^\w./-]/g, '_')}`,
  ) as (base: DCLogicClass, react: unknown) => DCLogicClass | null;
  const Component = factory(base, react);
  if (!Component) throw new Error('The logic script must define `class Component extends DCLogic`.');
  if (!(Component.prototype instanceof base)) throw new Error('`Component` must extend DCLogic.');
  return Component;
}
