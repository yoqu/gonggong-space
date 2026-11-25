import type { GgArtifactManifest } from '@gonggong/protocol'
import { create } from 'zustand'

/** What each artifact's canvas shows: a folder (文件夹, a `groups` entry) or one page (a screen id); absent: 全部页面. */
const usePages = create<Record<string, string>>()(() => ({}))

export const useArtifactPage = (artifactId: string): string | null => usePages((s) => s[artifactId] ?? null)
export const artifactPage = (artifactId: string): string | null => usePages.getState()[artifactId] ?? null

export function setArtifactPage(artifactId: string, page: string | null) {
  usePages.setState((s) => {
    const { [artifactId]: _, ...rest } = s
    return page ? { ...rest, [artifactId]: page } : rest
  }, true)
}

/** The folder or page shown, if the manifest still has it. */
export function useShownPage(artifactId: string, manifest: GgArtifactManifest | null | undefined) {
  const page = useArtifactPage(artifactId)
  return manifest?.groups?.some((g) => g.id === page) || manifest?.screens.some((s) => s.id === page)
    ? page
    : null
}

/** The one screen selected on each artifact's canvas: the rail marks its row. */
const useCanvasScreens = create<Record<string, string>>()(() => ({}))

export const useCanvasScreen = (artifactId: string): string | null =>
  useCanvasScreens((s) => s[artifactId] ?? null)
export const canvasScreen = (artifactId: string): string | null =>
  useCanvasScreens.getState()[artifactId] ?? null

export function setCanvasScreen(artifactId: string, screenId: string | null) {
  useCanvasScreens.setState((s) => {
    const { [artifactId]: _, ...rest } = s
    return screenId ? { ...rest, [artifactId]: screenId } : rest
  }, true)
}
