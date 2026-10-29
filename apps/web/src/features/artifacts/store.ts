import type { ArtifactDto, ArtifactVersionDto, WebEvent } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api, errorText } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { openTab } from '../workbench/open'

/** An artifact's details and versions (oldest first), loaded per open tab and refreshed when its card changes. */
export interface ArtifactEntry {
  artifact: ArtifactDto | null
  versions: ArtifactVersionDto[]
  error: string
}

const useStore = create<Record<string, ArtifactEntry>>()(() => ({}))

export async function loadArtifact(id: string) {
  try {
    const [artifact, versions] = await Promise.all([
      api.get<ArtifactDto>(`/artifacts/${id}`),
      api.get<ArtifactVersionDto[]>(`/artifacts/${id}/versions`),
    ])
    useStore.setState({ [id]: { artifact, versions: [...versions].sort((a, b) => a.n - b.n), error: '' } })
  } catch (e) {
    useStore.setState((s) => ({
      [id]: { artifact: s[id]?.artifact ?? null, versions: s[id]?.versions ?? [], error: errorText(e) },
    }))
  }
}

/** The artifact a card or message event names. */
const artifactOf = (e: WebEvent) =>
  (e.t === 'message.new' || e.t === 'message.edited') && e.message.card?.type === 'artifact'
    ? e.message.card.artifactId
    : null

/** What is loaded of the artifact, without loading it (tab titles). */
export const useArtifactEntry = (id: string): ArtifactEntry | undefined => useStore((s) => s[id])

/** Loads the artifact and keeps it fresh while mounted. */
export function useArtifact(id: string): ArtifactEntry | undefined {
  const entry = useArtifactEntry(id)
  useEffect(() => {
    void loadArtifact(id)
    // The card is updated in place as versions arrive (plan §5 S2.6): reload with it.
    const off = realtime.subscribe((e) => {
      if (artifactOf(e) === id) void loadArtifact(id)
    })
    const offReconnect = realtime.onReconnect(() => void loadArtifact(id))
    return () => {
      off()
      offReconnect()
    }
  }, [id])
  return entry
}

/** Makes `versionId` the head (设为当前版本; undo and redo step through versions this way). */
export async function restoreVersion(artifactId: string, versionId: string) {
  await api.post(`/artifacts/${artifactId}/versions/${versionId}/restore`)
  await loadArtifact(artifactId)
}

export interface ArtifactPreview {
  previewId: string
  url: string
}

/** The artifact's preview site: the head's (`versionId` null) or a past version's, read-only. */
export function useArtifactPreview(artifactId: string, versionId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ preview: ArtifactPreview | null; error: string }>({
    preview: null,
    error: '',
  })
  useEffect(() => {
    if (!enabled) return
    let live = true
    setState({ preview: null, error: '' })
    api.post<ArtifactPreview>(`/artifacts/${artifactId}/preview`, versionId ? { versionId } : {}).then(
      (preview) => live && setState({ preview, error: '' }),
      (e) => live && setState({ preview: null, error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [artifactId, versionId, enabled])
  return state
}

/** Opens the artifact's canvas in the workbench; false (and a toast) when the workbench is full. */
export const openArtifact = (artifactId: string, title = '') =>
  openTab({ kind: 'artifact', artifactId, title })

/** Tests: forget loaded artifacts. */
export function resetArtifacts() {
  useStore.setState({}, true)
}
