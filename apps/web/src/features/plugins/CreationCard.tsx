import type { CreationCard as Card, CreationDraftCard, MessageDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button } from '../../ui'
import { MessageAttachments } from '../attachments/MessageAttachments'
import { draftOfCard, requestOf } from './model'
import { PluginTile } from './PluginTile'
import { createInGroup, dismissDraft, openCreation, useEnabledPlugins } from './store'
import './plugins.css'

/** Lines of a parameter shown before 展开 (a pasted DESIGN.md runs to hundreds). */
const FOLD_LINES = 3

/** The summary line quotes a parameter's first line, cut short. */
const brief = (v: string) => {
  const line = v.split('\n')[0] ?? ''
  return line.length > 60 || v.includes('\n') ? `${line.slice(0, 60)}…` : line
}

/** One parameter: a long one is folded to its first lines until expanded. */
function InputLine({ label, value }: { label: string; value: string }) {
  const lines = value.split('\n')
  const [open, setOpen] = useState(false)
  if (lines.length <= FOLD_LINES) return <div>{`${label}：${value}`}</div>
  return (
    <div className="plg-req__long" data-testid="creation-input-long">
      <div>{`${label}：${open ? value : `${lines.slice(0, FOLD_LINES).join('\n')}…`}`}</div>
      <button type="button" className="plg-req__more" onClick={() => setOpen(!open)}>
        {open ? t('收起') : t('展开（共 {n} 行）', { n: lines.length })}
      </button>
    </div>
  )
}

/**
 * The 创作请求 card (prototype #result): a summary of what was asked instead of the agent-facing body, the full
 * parameters on demand, and 再来一版 / 改参数重做… while the plugin is still on in the group.
 */
export function CreationCardView({ m, card }: { m: MessageDto; card: Card }) {
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const plugin = useEnabledPlugins(m.groupId).find((p) => p.id === card.pluginId)
  const draft = plugin && draftOfCard(card, plugin)
  const [head, ...rest] = card.inputs
  const summary = [card.template?.title, card.designSystem?.title].filter(Boolean).join(' · ')
  const files = m.attachments.length
  const again = async () => {
    const req = draft && plugin && requestOf(draft, [], plugin.manifest)
    if (!req) return
    setBusy(true)
    await attempt(() => createInGroup(m.groupId, req))
    setBusy(false)
  }
  return (
    <div className="plg-req" data-testid="creation-card">
      <div className="plg-req__head">
        <PluginTile m={card} size={22} />
        <b className="plg-req__title" title={t('创作请求 · {title}', { title: card.pluginTitle })}>
          {t('创作请求 · {title}', { title: card.pluginTitle })}
        </b>
        <span className="plg-req__to">{t('已交给 @{bot}', { bot: card.botName })}</span>
      </div>
      <div className="plg-req__body">
        <div className="plg-req__line">
          {[summary, head ? `「${brief(head.value)}」` : ''].filter(Boolean).join(' ·')}
        </div>
        {all ? (
          <div className="plg-req__all">
            {card.inputs.map((i) => (
              <InputLine key={i.label} label={i.label} value={i.value} />
            ))}
            <div>{card.directions ? t('先出视觉方向：是') : t('先出视觉方向：否')}</div>
            <MessageAttachments list={m.attachments} from={m.authorName} />
          </div>
        ) : (
          <div className="plg-req__muted">
            {[
              rest.length ? t('另有 {n} 项参数', { n: rest.length }) : '',
              files ? t('{n} 个参考附件', { n: files }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            <button type="button" className="plg-req__more" onClick={() => setAll(true)}>
              {t('查看全部')}
            </button>
          </div>
        )}
      </div>
      <div className="plg-req__foot">
        <Button
          size="small"
          disabled={!draft || busy}
          title={draft ? undefined : t('这个插件已在本群停用')}
          onClick={() => void again()}
        >
          {t('再来一版')}
        </Button>
        <Button
          size="small"
          disabled={!draft}
          onClick={() => draft && openCreation({ groupId: m.groupId, draft, step: 'content' })}
        >
          {t('改参数重做…')}
        </Button>
        <span className="plg-req__ver">
          {t('插件 {name} {version}', {
            name: plugin?.manifest.name ?? card.pluginTitle,
            version: card.pluginVersion,
          })}
        </span>
      </div>
    </div>
  )
}

/**
 * A bot's 创作确认卡 (creation_propose): what it suggests, with 开始 (as the member, once nothing required is
 * missing), 改参数… (the panel prefilled) and 不用了; settled cards say who did what.
 */
export function CreationDraftView({ m, card }: { m: MessageDto; card: CreationDraftCard }) {
  const [busy, setBusy] = useState(false)
  const plugin = useEnabledPlugins(m.groupId).find((p) => p.id === card.pluginId)
  const draft = plugin && { ...draftOfCard(card, plugin), fromDraft: m.id }
  const [head] = card.inputs
  const summary = [card.template?.title, card.designSystem?.title].filter(Boolean).join(' · ')
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true)
    await attempt(f)
    setBusy(false)
  }
  const start = () => {
    const req = draft && plugin && requestOf(draft, [], plugin.manifest)
    if (req) void run(() => createInGroup(m.groupId, req))
  }
  const pending = card.status === 'pending'
  return (
    <div className="plg-req" data-testid="creation-draft">
      <div className="plg-req__head">
        <PluginTile m={card} size={22} />
        <b className="plg-req__title" title={t('创作确认 · {title}', { title: card.pluginTitle })}>
          {t('创作确认 · {title}', { title: card.pluginTitle })}
        </b>
        <span className="plg-req__to">{t('{bot} 提议', { bot: card.botName })}</span>
      </div>
      <div className="plg-req__body">
        <div className="plg-req__line">
          {[summary, head ? `「${brief(head.value)}」` : ''].filter(Boolean).join(' ·')}
        </div>
        {card.note ? <div className="plg-req__muted">{card.note}</div> : null}
        <div className="plg-req__all">
          {card.inputs.map((i) => (
            <InputLine key={i.label} label={i.label} value={i.value} />
          ))}
          {card.directions ? <div>{t('先出视觉方向：是')}</div> : null}
        </div>
        {pending && card.missing.length ? (
          <div className="plg-req__warn">{t('待补充：{names}', { names: card.missing.join(t('、')) })}</div>
        ) : null}
      </div>
      <div className="plg-req__foot">
        {pending ? (
          <>
            <Button
              size="small"
              variant="primary"
              disabled={!draft || busy || card.missing.length > 0}
              title={card.missing.length ? t('先在「改参数」里补充') : undefined}
              onClick={start}
            >
              {t('开始')}
            </Button>
            <Button
              size="small"
              disabled={!draft || busy}
              onClick={() =>
                draft &&
                openCreation({
                  groupId: m.groupId,
                  draft,
                  step: card.missing.length ? 'content' : 'template',
                })
              }
            >
              {t('改参数…')}
            </Button>
            <Button
              size="small"
              disabled={busy}
              onClick={() => void run(() => dismissDraft(m.groupId, m.id))}
            >
              {t('不用了')}
            </Button>
            {plugin ? null : <span className="plg-req__ver">{t('这个插件已在本群停用')}</span>}
          </>
        ) : (
          <span className="plg-req__ver">
            {card.status === 'started'
              ? t('{name} 已开始创作', { name: card.by ?? '' })
              : t('{name} 选了不用', { name: card.by ?? '' })}
          </span>
        )}
      </div>
    </div>
  )
}
