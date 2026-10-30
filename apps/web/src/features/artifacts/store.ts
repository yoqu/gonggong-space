import type {
  ArtifactDto,
  ArtifactEditOp,
  ArtifactLink,
  ArtifactVersionDetail,
  ArtifactVersionDto,
  WebEvent,
} from '@gonggong/protocol'
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

/** POST /api/artifacts/:id/edits: one new version from `ops` on top of `baseVersionId` (409 when it is not the head). */
export async function editArtifact(artifactId: string, baseVersionId: string, ops: ArtifactEditOp[]) {
  try {
    await api.post(`/artifacts/${artifactId}/edits`, { baseVersionId, ops })
  } finally {
    await loadArtifact(artifactId)
  }
}

/** PUT /api/artifacts/:id/favorites — the member's starred screens. */
export async function setFavorites(artifactId: string, screenIds: string[]) {
  useStore.setState((s) => {
    const e = s[artifactId]
    return e?.artifact ? { [artifactId]: { ...e, artifact: { ...e.artifact, favorites: screenIds } } } : {}
  })
  try {
    const artifact = await api.put<ArtifactDto>(`/artifacts/${artifactId}/favorites`, { screenIds })
    useStore.setState((s) => (s[artifactId] ? { [artifactId]: { ...s[artifactId], artifact } } : {}))
  } catch (e) {
    await loadArtifact(artifactId)
    throw e
  }
}

export type { ArtifactLink }

/** A version's files and links (GET …/versions/:vid), the version's tokens.css when it has one. */
export function useVersionDetail(artifactId: string, versionId: string | null) {
  const [state, setState] = useState<{ detail: ArtifactVersionDetail | null; tokens: string | null }>({
    detail: null,
    tokens: null,
  })
  useEffect(() => {
    if (!versionId) return
    let live = true
    api.get<ArtifactVersionDetail>(`/artifacts/${artifactId}/versions/${versionId}`).then(
      async (detail) => {
        const tokens = detail.files.some((f) => f.path === 'tokens.css')
          ? await readArtifactFile(artifactId, 'tokens.css', versionId).catch(() => null)
          : null
        if (live) setState({ detail, tokens })
      },
      () => live && setState({ detail: null, tokens: null }),
    )
    return () => {
      live = false
    }
  }, [artifactId, versionId])
  return state
}

/** A file of a version as a URL the page can load (images on the canvas; the session cookie goes along). */
export const artifactFileUrl = (artifactId: string, path: string, versionId: string) =>
  `/api/artifacts/${artifactId}/files/${path}?version=${encodeURIComponent(versionId)}`

/** A file of a version as text (the source view; never rendered on the main site). */
export const readArtifactFile = (artifactId: string, path: string, versionId: string) =>
  api.text(`/artifacts/${artifactId}/files/${path}?version=${encodeURIComponent(versionId)}`)

export interface ArtifactPreview {
  previewId: string
  /** The preview site's origin: screens' bridge messages must come from it. */
  origin: string
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

/** PATCH /api/artifacts/:id — renames the artifact (its card follows). */
export async function renameArtifact(artifactId: string, title: string) {
  const artifact = await api.patch<ArtifactDto>(`/artifacts/${artifactId}`, { title })
  useStore.setState((s) => (s[artifactId] ? { [artifactId]: { ...s[artifactId], artifact } } : {}))
  return artifact
}

/** POST /api/artifacts/:id/duplicate — a new artifact in the group from the head version. */
export const duplicateArtifact = (artifactId: string) =>
  api.post<ArtifactDto>(`/artifacts/${artifactId}/duplicate`)

/** POST /api/artifacts/:id/archive — gone from the group; its files stay and it can be restored. */
export const archiveArtifact = (artifactId: string) =>
  api.post<ArtifactDto>(`/artifacts/${artifactId}/archive`)

/** Opens the artifact's canvas in the workbench; false (and a toast) when the workbench is full. */
export const openArtifact = (artifactId: string, title = '') =>
  openTab({ kind: 'artifact', artifactId, title })

/** Where the canvas goes once it shows: these screens selected and in view, on `versionId` (null: the head). */
export interface ArtifactFocus {
  screenIds: string[]
  versionId: string | null
  /** Bumped per request, so asking for the same place again still moves the canvas there. */
  seq: number
}

const useFocus = create<Record<string, ArtifactFocus>>()(() => ({}))
let focusSeq = 0

/** The canvas's pending focus request, if any; it clears it with `takeArtifactFocus` once done. */
export const useArtifactFocus = (artifactId: string) => useFocus((s) => s[artifactId])
export const takeArtifactFocus = (artifactId: string) =>
  useFocus.setState((s) => {
    const { [artifactId]: _, ...rest } = s
    return rest
  }, true)

/**
 * Opens the artifact's canvas on `screenIds` (a deep link, a message's context, a run's changed screens); a past
 * `versionId` is shown read-only.
 */
export function focusArtifact(
  artifactId: string,
  o: { screenIds?: string[]; versionId?: string | null; title?: string } = {},
) {
  useFocus.setState({
    [artifactId]: { screenIds: o.screenIds ?? [], versionId: o.versionId ?? null, seq: ++focusSeq },
  })
  return openArtifact(artifactId, o.title)
}

/** The page link that opens the artifact on these screens: `/g/<group>?artifact=<id>&screens=<a,b>`. */
export const artifactLink = (groupId: string, artifactId: string, screenIds: string[] = []) =>
  `${location.origin}/g/${groupId}?${new URLSearchParams({
    artifact: artifactId,
    ...(screenIds.length ? { screens: screenIds.join(',') } : {}),
  })}`

/** Tests: forget loaded artifacts. */
export function resetArtifacts() {
  useStore.setState({}, true)
  useFocus.setState({}, true)
}
