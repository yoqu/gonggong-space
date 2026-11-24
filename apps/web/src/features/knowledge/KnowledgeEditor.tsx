import {
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_TAGS_MAX,
  KNOWLEDGE_TITLE_MAX,
  type KnowledgeAuthor,
  type KnowledgeDetailDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { ApiError, errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  SegmentedControl,
  Tag,
  Textarea,
  TextField,
  type Token,
  TokenField,
  toast,
  useDiscardGuard,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { knowledgeApi } from './api'
import './knowledge.css'

/** Who changed it; a bot's change is marked so members can tell it from their own. */
export function Author({ by }: { by: KnowledgeAuthor | null }) {
  if (!by) return null
  return (
    <>
      {by.kind === 'bot' ? <Tag tone="blue">Bot</Tag> : null}
      <span>{by.name}</span>
    </>
  )
}

const tagText = (tokens: Token[]) => tokens.map((x) => (typeof x === 'string' ? x : x.label))

type Mode = 'edit' | 'preview'

/**
 * Opens an entry (preview first) or creates one, from scratch or from `draft` (存入知识库). Saving an entry sends the
 * version it loaded: if someone saved first the server answers 409 and the user may load the latest one.
 */
export function KnowledgeEditor({
  groupId,
  entryId,
  draft,
  onSaved,
  onClose,
}: {
  groupId: string
  entryId?: string
  draft?: { title: string; body: string }
  onSaved?: () => void
  onClose: () => void
}) {
  const detail = useGet<KnowledgeDetailDto>(entryId ? `/knowledge/${entryId}` : null)
  const [title, setTitle] = useState(draft?.title ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [tags, setTags] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>(entryId ? 'preview' : 'edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const base = detail.data
  useEffect(() => {
    if (!base) return
    setTitle(base.title)
    setBody(base.body)
    setTags(base.tags)
    setConflict(false)
  }, [base])

  const tooMany = tags.length > KNOWLEDGE_TAGS_MAX
  const unchanged =
    !!base && base.title === title.trim() && base.body === body && base.tags.join('\n') === tags.join('\n')
  const dirty = entryId ? !!base && !unchanged : !!(title.trim() || body.trim() || tags.length)
  const guard = useDiscardGuard(dirty, onClose)
  const close = busy ? () => {} : guard.requestClose
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const fields = { title: title.trim(), body, tags }
      if (entryId) await knowledgeApi.update(entryId, { baseVersion: base?.version ?? 0, ...fields })
      else await knowledgeApi.create(groupId, fields)
      toast({ type: 'success', message: t('已保存，本群 Bot 下一轮读到') })
      onSaved?.()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true)
      else setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open
        title={entryId ? (base?.title ?? t('知识库#kb')) : t('新建条目')}
        message={
          base ? (
            <span className="kb-meta">
              {`v${base.version}`}
              <Author by={base.updatedBy} />
              <span>{ago(base.updatedAt)}</span>
            </span>
          ) : undefined
        }
        width={720}
        onClose={close}
        closeOnBackdrop={false}
        actions={[
          { label: t('取消'), onClick: close, disabled: busy },
          {
            label: t('保存'),
            variant: 'primary',
            loading: busy,
            onClick: () => void save(),
            disabled: busy || !title.trim() || tooMany || (!!entryId && (!base || unchanged)),
          },
        ]}
      >
        {conflict ? (
          <Alert
            variant="warning"
            title={t('这条知识已被他人更新')}
            description={t('载入最新版本会丢掉你这次的修改，可先复制正文再载入。')}
          >
            <div className="kb-alert__ops">
              <Button size="small" onClick={() => void copyWithToast(body, t('已复制你的正文'))}>
                {t('复制我的正文')}
              </Button>
              <Button size="small" onClick={detail.reload}>
                {t('载入最新版本')}
              </Button>
            </div>
          </Alert>
        ) : null}
        {error || detail.error ? <Alert variant="error" title={error || detail.error} /> : null}
        <div className="kb-form" inert={busy || (!!entryId && !base)}>
          <TextField
            label={t('标题')}
            value={title}
            maxLength={KNOWLEDGE_TITLE_MAX}
            placeholder={t('如：发布流程、接口命名约定')}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TokenField
            label={t('标签')}
            value={tags}
            placeholder={t('回车添加，最多 {n} 个', { n: KNOWLEDGE_TAGS_MAX })}
            hint={tooMany ? t('最多 {n} 个标签', { n: KNOWLEDGE_TAGS_MAX }) : undefined}
            onChange={(v) => setTags(tagText(v))}
          />
          <div className="kb-form__bar">
            <SegmentedControl<Mode>
              size="small"
              aria-label={t('正文视图')}
              items={[
                { value: 'edit', label: t('编辑') },
                { value: 'preview', label: t('预览') },
              ]}
              value={mode}
              onChange={setMode}
            />
            <span className="kb-muted">
              {t('支持 Markdown · {n}/{max} 字', { n: body.length, max: KNOWLEDGE_BODY_MAX })}
            </span>
          </div>
          {mode === 'edit' ? (
            <Textarea
              className="ui-input--mono kb-form__body"
              aria-label={t('正文')}
              rows={14}
              maxLength={KNOWLEDGE_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          ) : (
            <div className="kb-preview">
              {body.trim() ? <Markdown text={body} /> : <span className="kb-muted">{t('暂无内容')}</span>}
            </div>
          )}
        </div>
      </Dialog>
      {guard.dialog}
    </>
  )
}
