import type { MessageDto, RunDto } from '@gonggong/protocol'

export type { MessageCanvas, RunArtifact } from '@gonggong/protocol'

export const messageCanvas = (m: MessageDto) => m.canvas ?? null
export const runArtifacts = (r: RunDto) => r.artifacts ?? []
