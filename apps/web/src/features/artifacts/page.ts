import type { GgArtifactManifest } from '@gonggong/protocol'
import { create } from 'zustand'

/** The folder (文件夹, a `groups` entry of the manifest) each artifact's canvas shows; absent: 全部页面. */
const usePages = create<Record<string, string>>()(() => ({}))

export const useArtifactPage = (artifactId: string): string | null => usePages((s) => s[artifactId] ?? null)
export const artifactPage = (artifactId: string): string | null => usePages.getState()[artifactId] ?? null

export function setArtifactPage(artifactId: string, page: string | null) {
  usePages.setState((s) => {
    const { [artifactId]: _, ...rest } = s
    return page ? { ...rest, [artifactId]: page } : rest
  }, true)
}

/** The page shown, if the manifest still has it. */
export function useShownPage(artifactId: string, manifest: GgArtifactManifest | null | undefined) {
  const page = useArtifactPage(artifactId)
  return manifest?.groups?.some((g) => g.id === page) ? page : null
}
