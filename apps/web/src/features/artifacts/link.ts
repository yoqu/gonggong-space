import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { useWorkbench } from '../../app/workbench'
import { focusArtifact } from './store'

/**
 * `?artifact=<id>[&screens=<a,b>][&version=<id>]` (Copy link to selection, store.ts `artifactLink`) opens the canvas
 * on those screens once the workbench is on the group, then leaves the URL.
 */
export function useLinkedArtifact(groupId: string | undefined) {
  const [params, setParams] = useSearchParams()
  const id = params.get('artifact')
  const screens = params.get('screens')
  const version = params.get('version')
  const bench = useWorkbench((s) => s.groupId)
  useEffect(() => {
    if (!id || !groupId || bench !== groupId) return
    focusArtifact(id, { screenIds: screens ? screens.split(',').filter(Boolean) : [], versionId: version })
    setParams({}, { replace: true })
  }, [id, screens, version, groupId, bench, setParams])
}
