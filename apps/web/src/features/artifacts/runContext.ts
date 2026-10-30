import type { MessageDto, RunDto } from '@gonggong/protocol'

// TODO(G11): the server adds these to MessageDto / RunDto in @gonggong/protocol; switch to them when it lands.

/** MessageDto.canvas: what the canvas had selected when the message was sent. */
export interface MessageCanvas {
  artifactId: string
  title: string
  screens: { id: string; title: string }[]
  elements: { file: string; ggId: string; label: string }[]
}

/** RunDto.artifacts: a version the run made, and the screens it changed. */
export interface RunArtifact {
  artifactId: string
  title: string
  versionId: string
  n: number
  changedScreens: { id: string; title: string }[]
}

export const messageCanvas = (m: MessageDto) =>
  (m as MessageDto & { canvas?: MessageCanvas | null }).canvas ?? null
export const runArtifacts = (r: RunDto) =>
  (r as RunDto & { artifacts?: RunArtifact[] | null }).artifacts ?? []
