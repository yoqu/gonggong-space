import { createContext } from 'react'

/** The workbench is 全屏 and the chat hidden: its composer floats over the workbench (ComposerDock). */
export const FloatingChat = createContext(false)

/** Opens the collapsed chat column as a floating overlay (`over = true`) while the workbench is 全屏. */
export const ShowFloatingChat = createContext<(() => void) | null>(null)
