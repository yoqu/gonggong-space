import type { ArtifactVersionDetail } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { readArtifactFile } from './store'

/** Versions walked back at most to find where a screen file last changed. */
const MAX_WALK = 30
/** Where a screen's design notes may live, in order: the PRD the project-brief command writes, then DESIGN.md. */
const NOTE_FILES = ['brief.md', 'DESIGN.md']

/** The section of `md` whose heading names the screen (its title or id), without the heading; null when none. */
export function screenSection(md: string, screen: { id: string; title: string }): string | null {
  const lines = md.split('\n')
  const names = [screen.title, screen.id].map((s) => s.toLowerCase())
  for (const [i, line] of lines.entries()) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (!h || !names.some((n) => (h[2] ?? '').toLowerCase().includes(n))) continue
    const level = (h[1] ?? '').length
    const end = lines.findIndex((l, j) => j > i && (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 7) <= level)
    const body = lines
      .slice(i + 1, end < 0 ? undefined : end)
      .join('\n')
      .trim()
    return body || null
  }
  return null
}

export interface ScreenNotes {
  /** The version that last changed the screen's file. */
  origin: ArtifactVersionDetail | null
  note: string | null
}

/** View Details: where the screen comes from and its design notes, loaded while the panel is open. */
export function useScreenNotes(
  artifactId: string,
  versionId: string,
  { id, title, file }: { id: string; title: string; file: string },
): ScreenNotes {
  const [state, setState] = useState<ScreenNotes>({ origin: null, note: null })
  useEffect(() => {
    if (!versionId) return
    let live = true
    const detail = (id: string) => api.get<ArtifactVersionDetail>(`/artifacts/${artifactId}/versions/${id}`)
    ;(async () => {
      const v = await detail(versionId)
      const hash = v.files.find((f) => f.path === file)?.hash
      const notes = NOTE_FILES.filter((p) => v.files.some((f) => f.path === p))
      let note: string | null = null
      for (const p of notes) {
        note = screenSection(await readArtifactFile(artifactId, p, versionId), { id, title })
        if (note) break
      }
      if (live) setState({ origin: null, note })
      let origin = v
      for (let i = 0; i < MAX_WALK && origin.parentVersionId; i++) {
        const parent = await detail(origin.parentVersionId)
        if (parent.files.find((f) => f.path === file)?.hash !== hash) break
        origin = parent
      }
      if (live) setState({ origin, note })
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [artifactId, versionId, file, id, title])
  return state
}
