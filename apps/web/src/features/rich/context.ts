import type { MessageDto } from '@gonggong/protocol'
import { createContext } from 'react'

/** The bot reply the Markdown belongs to: its blocks may act as the viewer (answer actions). */
export const RichMessage = createContext<MessageDto | null>(null)
