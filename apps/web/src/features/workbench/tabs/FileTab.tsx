import { AttachmentViewer } from '../../attachments/AttachmentViewer'
import { BotFileViewer, baseName, fileIconName } from '../../files/FileViewer'
import { shortRev } from '../../git/api'
import type { TabMeta, TabProps } from '../types'

/** One workspace file or message attachment (design §4.6). */
export function FileTab({ tab }: TabProps<'file'>) {
  const s = tab.source
  return 'attachment' in s ? (
    <AttachmentViewer attachment={s.attachment} from={s.from} />
  ) : (
    <BotFileViewer botId={s.botId} path={s.path} line={s.line} rev={s.rev} annotate={s.annotate} />
  )
}

export function useFileTabMeta(tab: TabProps<'file'>['tab']): TabMeta {
  const s = tab.source
  const [name, mime] = 'attachment' in s ? [s.attachment.name, s.attachment.mime] : [baseName(s.path), '']
  const rev = 'attachment' in s ? undefined : s.rev
  return { icon: fileIconName(name, mime), title: rev ? `${name} @ ${shortRev(rev)}` : name }
}
