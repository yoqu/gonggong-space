import { type ComponentType, lazy } from 'react'

/** The terminal bundle is loaded only by first use or an explicit preload. */
export function lazyTerminalUI<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let request: Promise<{ default: ComponentType<P> }> | undefined
  const preload = () => (request ??= load())
  return { Component: lazy(preload) as ComponentType<P>, preload }
}
