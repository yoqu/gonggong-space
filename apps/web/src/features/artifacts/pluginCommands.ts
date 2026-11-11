import type { ArtifactPluginCommandDto } from '@gonggong/protocol'
import { useGet } from '../../lib/useGet'

const NONE: ArtifactPluginCommandDto[] = []

/** The commands the artifact's plugin adds (GET …/commands); none while loading or when it fails. */
export function useArtifactCommands(artifactId: string | null | undefined) {
  return (
    useGet<ArtifactPluginCommandDto[]>(artifactId ? `/artifacts/${artifactId}/commands` : null).data ?? NONE
  )
}
