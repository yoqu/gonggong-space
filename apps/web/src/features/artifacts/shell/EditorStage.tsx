import type { ArtifactDto } from '@gonggong/protocol'
import { type RefObject, useEffect, useImperativeHandle, useRef } from 'react'
import { useSession } from '../../../app/session'
import { realtime } from '../../../lib/realtime'
import { Spinner } from '../../../ui'
import type { ArtifactPreview } from '../store'
import { type ArtifactBroker, type BrokerAgentStatus, createArtifactBroker } from './broker'
import type { ChromeCommand, ShellChromeHandlers } from './chrome'

export interface EditorStageHandle {
  sendCommand: (cmd: ChromeCommand) => void
  requestFullscreen: () => void
}

const EDITOR_SANDBOX = 'allow-scripts allow-same-origin allow-downloads allow-popups allow-modals'

/**
 * Open-artifact editor stage (`slides` / `whiteboard` / `motion`): mounts the platform-served editor
 * inside the preview origin iframe and wires `createArtifactBroker` + chrome protocol over postMessage.
 */
export function EditorStage({
  artifact,
  versionId,
  preview,
  readOnly,
  botId,
  agentStatus,
  chromeHandlers,
  onStageAgent,
  onViewContext,
  handleRef,
}: {
  artifact: ArtifactDto
  versionId: string | null
  preview: ArtifactPreview | null
  readOnly: boolean
  botId: string | null
  agentStatus: BrokerAgentStatus
  chromeHandlers?: ShellChromeHandlers
  onStageAgent?: (req: { text: string; title?: string; context?: Record<string, unknown> }) => void
  onViewContext?: (ctx: Record<string, unknown> | null) => void
  handleRef?: RefObject<EditorStageHandle | null>
}) {
  const me = useSession((s) => s.user)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const brokerRef = useRef<ArtifactBroker | null>(null)
  const latest = useRef({
    artifact,
    versionId,
    preview,
    readOnly,
    botId,
    agentStatus,
    chromeHandlers,
    onStageAgent,
    onViewContext,
  })
  latest.current = {
    artifact,
    versionId,
    preview,
    readOnly,
    botId,
    agentStatus,
    chromeHandlers,
    onStageAgent,
    onViewContext,
  }
  const viewerId = me?.id ?? null
  const viewerName = me?.name ?? null

  useImperativeHandle(
    handleRef,
    () => ({
      sendCommand: (cmd) => brokerRef.current?.sendCommand(cmd),
      requestFullscreen: () => void frameRef.current?.requestFullscreen?.(),
    }),
    [],
  )

  useEffect(() => {
    const broker = createArtifactBroker({
      artifactId: artifact.id,
      getTitle: () => latest.current.artifact.title,
      getVersionId: () => latest.current.versionId,
      getOrigin: () => latest.current.preview?.origin ?? null,
      getFrameWindow: () => frameRef.current?.contentWindow ?? null,
      viewer:
        viewerId && viewerName
          ? {
              id: viewerId,
              name: viewerName,
              role: latest.current.readOnly ? 'viewer' : 'editor',
              kind: 'user',
            }
          : { id: 'guest', name: 'Guest', role: 'viewer', kind: 'guest' },
      readOnly: latest.current.readOnly,
      getAgentStatus: () => latest.current.agentStatus,
      getBotId: () => latest.current.botId,
      onStageAgent: (r) => latest.current.onStageAgent?.(r),
      onViewContext: (c) => latest.current.onViewContext?.(c),
      onChrome: {
        onReport: (r) => latest.current.chromeHandlers?.onReport?.(r),
        onCurrentSlide: (h) => latest.current.chromeHandlers?.onCurrentSlide?.(h),
        onCopySlideLink: (h) => latest.current.chromeHandlers?.onCopySlideLink?.(h),
        onCommentMode: (on, a) => latest.current.chromeHandlers?.onCommentMode?.(on, a),
        onExportState: (ev) => latest.current.chromeHandlers?.onExportState?.(ev),
      },
    })
    brokerRef.current = broker
    window.addEventListener('message', broker.onMessage)
    const off = realtime.subscribe((e) => {
      if (e.t === 'artifact.files' && e.artifactId === artifact.id) broker.pushFiles(e)
      if (e.t === 'artifact.threads' && e.artifactId === artifact.id) broker.pushThreads(e.threads)
    })
    return () => {
      window.removeEventListener('message', broker.onMessage)
      off()
      brokerRef.current = null
    }
  }, [artifact.id, viewerId, viewerName])

  useEffect(() => {
    brokerRef.current?.setReadOnly(readOnly)
  }, [readOnly])

  const { available, busy, name, waitingForPerson } = agentStatus
  useEffect(() => {
    brokerRef.current?.pushAgentStatus({ available, busy, name, waitingForPerson })
  }, [available, busy, name, waitingForPerson])

  if (!preview) {
    return (
      <div className="art-site__wait">
        <Spinner />
      </div>
    )
  }

  const ver = artifact.editorVersion || 'current'
  const editorPath = `/__oa/${artifact.kind}@${ver}/index.html?open_artifact_shell=${encodeURIComponent(location.origin)}&open_artifact_id=${encodeURIComponent(artifact.id)}`
  const src = `${preview.url}?path=${encodeURIComponent(editorPath)}${readOnly ? '#view-inline' : ''}`

  return (
    <div className="art-shell__editor" data-testid="shell-editor-stage">
      <iframe
        ref={frameRef}
        className="art-site__frame"
        title={artifact.title}
        src={src}
        sandbox={EDITOR_SANDBOX}
        allow="fullscreen; clipboard-write"
        onLoad={() => brokerRef.current?.sendHello()}
      />
    </div>
  )
}
