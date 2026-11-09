import type { FilesTreeDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { api } from '../../../lib/api'
import { AttachmentViewer } from '../../attachments/AttachmentViewer'
import { BotFileViewer, baseName, fileIconName } from '../../files/FileViewer'
import { fileNav, filesOf } from '../../files/nav'
import { shortRev } from '../../git/api'
import type { TabMeta, TabProps } from '../types'

/** One workspace file or message attachment (design §4.6). */
export function FileTab({ tab, tabKey }: TabProps<'file'>) {
  const s = tab.source
  return 'attachment' in s ? (
    <AttachmentViewer attachment={s.attachment} from={s.from} />
  ) : (
    <WorkspaceFile source={s} tabKey={tabKey} />
  )
}

type WorkspaceSource = Exclude<TabProps<'file'>['tab']['source'], { attachment: unknown }>

/** A work tree file pages through its folder, the tab becoming the file paged to. */
function WorkspaceFile({ source: s, tabKey }: { source: WorkspaceSource; tabKey: string }) {
  const groupId = useWorkbench((x) => x.groupId) ?? ''
  const replace = useWorkbench((x) => x.replace)
  const dir = s.path.split('/').slice(0, -1).join('/')
  const [folder, setFolder] = useState<{ dir: string; files: string[] }>()
  useEffect(() => {
    if (s.rev) return
    let live = true
    // Paging is extra: without the listing the file still shows, only without 上一个/下一个.
    api
      .get<FilesTreeDto>(`/groups/${groupId}/bots/${s.botId}/files/tree?path=${encodeURIComponent(dir)}`)
      .then((r) => filesOf(dir, r.entries))
      .then(
        (files) => live && setFolder({ dir, files }),
        () => {},
      )
    return () => {
      live = false
    }
  }, [groupId, s.botId, s.rev, dir])
  const nav =
    !s.rev && folder?.dir === dir
      ? fileNav(folder.files, s.path, (path) =>
          replace(tabKey, { kind: 'file', source: { botId: s.botId, path } }),
        )
      : null
  return (
    <BotFileViewer botId={s.botId} path={s.path} line={s.line} rev={s.rev} annotate={s.annotate} nav={nav} />
  )
}

export function useFileTabMeta(tab: TabProps<'file'>['tab']): TabMeta {
  const s = tab.source
  const [name, mime] = 'attachment' in s ? [s.attachment.name, s.attachment.mime] : [baseName(s.path), '']
  const rev = 'attachment' in s ? undefined : s.rev
  return { icon: fileIconName(name, mime), title: rev ? `${name} @ ${shortRev(rev)}` : name }
}
