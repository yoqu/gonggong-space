import type { MessageDto, SavedListDto, SavedMessageDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { ago } from '../../lib/time'
import {
  Button,
  EmptyChatArt,
  EmptyState,
  FailedArt,
  Icon,
  Mascot,
  MenuButton,
  Presence,
  SegmentedControl,
} from '../../ui'
import { RemindDialog } from './SaveMenu'
import { remindLabel, remindPresets, savedApi } from './store'
import '../chat/thread-inbox.css'
import './later.css'

type Tab = 'open' | 'done'
const SNIPPET = 140
const REFRESH_MS = 300
const PAGE = 30

const snippet = (m: MessageDto) =>
  m.recalled
    ? t('该消息已撤回')
    : m.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET) || (m.attachments.length ? t('[附件]') : '')

/** Where 跳到原消息 goes: a thread reply opens its thread. */
export const messageHref = (m: MessageDto) =>
  m.threadRootId ? `/g/${m.groupId}?thread=${m.threadRootId}&msg=${m.id}` : `/g/${m.groupId}?msg=${m.id}`

function Item({ item, tab }: { item: SavedMessageDto; tab: Tab }) {
  const navigate = useNavigate()
  const [custom, setCustom] = useState(false)
  const m = item.message
  const due = !!item.remindedAt && !item.doneAt
  const id = m.id
  return (
    <article
      className="thread-inbox__card later__item"
      data-due={due || undefined}
      data-testid={`later-${id}`}
    >
      <span className="thread-inbox__where">
        <Icon name="bookmark" size={12} />
        {item.groupName}
        {item.remindAt && tab === 'open' ? (
          <span className="later__remind" data-due={due || undefined}>
            <Icon name="clock" size={12} />
            {due ? t('提醒已到期') : remindLabel(item.remindAt)}
          </span>
        ) : null}
      </span>
      <button type="button" className="later__body" onClick={() => navigate(messageHref(m))}>
        <p className="thread-inbox__line">
          <b>{m.authorName}</b>
          <span>{snippet(m)}</span>
          <time dateTime={m.createdAt}>{ago(m.createdAt)}</time>
        </p>
      </button>
      <span className="later__actions">
        {tab === 'open' ? (
          <>
            <Button size="small" icon="check" onClick={() => void savedApi.done(id, true)}>
              {t('完成')}
            </Button>
            <MenuButton
              className="ui-btn ui-btn--small"
              items={remindPresets().map((p) => ({ value: p.value, label: p.label }))}
              onSelect={(v) => {
                if (v === 'remind:custom') setCustom(true)
                else void savedApi.save(id, remindPresets().find((p) => p.value === v)?.at ?? null)
              }}
            >
              {t('改提醒')}
            </MenuButton>
          </>
        ) : (
          <Button size="small" icon="undo" onClick={() => void savedApi.done(id, false)}>
            {t('移回进行中')}
          </Button>
        )}
        <Button size="small" variant="plain" onClick={() => navigate(messageHref(m))}>
          {t('跳到原消息')}
        </Button>
        <Button size="small" variant="plain" onClick={() => void savedApi.remove(id)}>
          {t('移除')}
        </Button>
      </span>
      <Presence>
        {custom ? (
          <RemindDialog onPick={(at) => void savedApi.save(id, at)} onClose={() => setCustom(false)} />
        ) : null}
      </Presence>
    </article>
  )
}

/** 稍后处理: messages I saved, 进行中 newest first and 已完成 (plan 未读与通知). */
export function LaterPage({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState<Tab>('open')
  const [list, setList] = useState<SavedMessageDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)

  const load = useCallback(async () => {
    try {
      const { items } = await api.get<SavedListDto>(`/saved?state=${tab}`)
      setList(items)
      setMore(items.length === PAGE)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [tab])
  useEffect(() => {
    setList(null)
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = realtime.subscribe((e) => {
      if (e.t !== 'saved.changed') return
      clearTimeout(timer)
      timer = setTimeout(() => void load(), REFRESH_MS)
    })
    const offReconnect = realtime.onReconnect(() => void load())
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [load])

  const older = async () => {
    const last = list?.at(-1)
    const cursor = tab === 'done' ? last?.doneAt : last?.createdAt
    if (!cursor) return
    try {
      const { items } = await api.get<SavedListDto>(
        `/saved?state=${tab}&before=${encodeURIComponent(cursor)}`,
      )
      setList((l) => [...(l ?? []), ...items])
      setMore(items.length === PAGE)
    } catch {
      setFailed(true)
    }
  }

  return (
    <section className="works thread-inbox" aria-label={t('稍后处理')}>
      <header className="works__head">
        {onBack ? (
          <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回')} onClick={onBack} />
        ) : null}
        <h1 className="works__title">{t('稍后处理')}</h1>
        <SegmentedControl<Tab>
          aria-label={t('稍后处理')}
          size="small"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'open', label: t('进行中') },
            { value: 'done', label: t('已完成') },
          ]}
        />
      </header>
      {failed && !list ? (
        <div className="works__center">
          <EmptyState
            illustration={<FailedArt />}
            title={t('稍后处理加载失败')}
            actions={
              <Button size="small" onClick={() => void load()}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : !list ? (
        <div className="works__center">
          <Mascot action="wait" size={72} label={t('加载中')} />
        </div>
      ) : !list.length ? (
        <div className="works__center">
          <EmptyState
            illustration={<EmptyChatArt />}
            title={tab === 'open' ? t('没有待处理的消息') : t('还没有完成的消息')}
            description={tab === 'open' ? t('在消息的更多菜单里点「稍后处理」，可以设置提醒。') : undefined}
          />
        </div>
      ) : (
        <div className="thread-inbox__list">
          {list.map((item) => (
            <Item key={item.message.id} item={item} tab={tab} />
          ))}
          {more ? (
            <Button size="small" variant="plain" onClick={() => void older()}>
              {t('加载更多')}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
