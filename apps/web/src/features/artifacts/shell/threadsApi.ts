import type {
  ArtifactThreadDto,
  ArtifactThreadMessageReq,
  CreateArtifactThreadReq,
  EditArtifactThreadMessageReq,
  MessageDto,
  ReactArtifactThreadMessageReq,
  SendArtifactThreadsReq,
  UpdateArtifactThreadReq,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { realtime } from '../../../lib/realtime'

export const listArtifactThreads = (artifactId: string, versionId?: string) =>
  api.get<ArtifactThreadDto[]>(
    `/artifacts/${artifactId}/threads${versionId ? `?version=${encodeURIComponent(versionId)}` : ''}`,
  )

export const createArtifactThread = (
  artifactId: string,
  req: Omit<CreateArtifactThreadReq, 'label' | 'location' | 'to'> &
    Partial<Pick<CreateArtifactThreadReq, 'label' | 'location' | 'to'>>,
) => api.post<ArtifactThreadDto>(`/artifacts/${artifactId}/threads`, req)

export const updateArtifactThread = (threadId: string, req: UpdateArtifactThreadReq) =>
  api.patch<ArtifactThreadDto>(`/artifact-threads/${threadId}`, req)

export const deleteArtifactThread = (threadId: string) => api.del(`/artifact-threads/${threadId}`)

export const replyArtifactThread = (threadId: string, req: ArtifactThreadMessageReq) =>
  api.post<ArtifactThreadDto>(`/artifact-threads/${threadId}/messages`, req)

export const editThreadMessage = (threadId: string, messageId: string, req: EditArtifactThreadMessageReq) =>
  api.patch<ArtifactThreadDto>(`/artifact-threads/${threadId}/messages/${messageId}`, req)

export const deleteThreadMessage = (threadId: string, messageId: string) =>
  api.del<ArtifactThreadDto | undefined>(`/artifact-threads/${threadId}/messages/${messageId}`)

export const reactThreadMessage = (threadId: string, messageId: string, req: ReactArtifactThreadMessageReq) =>
  api.post<ArtifactThreadDto>(`/artifact-threads/${threadId}/messages/${messageId}/reactions`, req)

export const sendArtifactThreads = (artifactId: string, req: SendArtifactThreadsReq) =>
  api.post<MessageDto>(`/artifacts/${artifactId}/threads/send`, req)

/** Loads all threads of `artifactId` and keeps them synchronized with `/ws/web` `artifact.threads` events. */
export function useArtifactThreads(artifactId: string, enabled = true) {
  const [threads, setThreads] = useState<ArtifactThreadDto[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await listArtifactThreads(artifactId)
      setThreads(rows)
      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }, [artifactId])

  useEffect(() => {
    if (!enabled) return
    let live = true
    listArtifactThreads(artifactId)
      .then((rows) => {
        if (live) {
          setThreads(rows)
          setLoaded(true)
        }
      })
      .catch(() => live && setLoaded(true))
    const off = realtime.subscribe((e) => {
      if (e.t === 'artifact.threads' && e.artifactId === artifactId) {
        setThreads(e.threads)
        setLoaded(true)
      }
    })
    const offReconnect = realtime.onReconnect(() => void refresh())
    return () => {
      live = false
      off()
      offReconnect()
    }
  }, [artifactId, enabled, refresh])

  return { threads, setThreads, loaded, refresh }
}
