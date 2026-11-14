import type { FeishuAppDto, FeishuAppView } from '@gonggong/protocol'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import { Button, Icon, type IconName, toast } from '../../ui'
import './feishu.css'

const FEISHU_ADMIN = 'https://www.feishu.cn/admin'

/** The Feishu app at `path`, refreshed while its long connection comes up, with 重试 of its dev config. */
export function useFeishuApp(path: string) {
  const { data, reload } = useGet<FeishuAppView>(path)
  const app = data?.app ?? null
  const [retrying, setRetrying] = useState(false)

  // A fresh connection reports in within seconds.
  useEffect(() => {
    if (app?.status !== 'connecting') return
    const timer = setTimeout(reload, 3000)
    return () => clearTimeout(timer)
  }, [app, reload])

  const retry = useCallback(async () => {
    setRetrying(true)
    try {
      await api.post<FeishuAppView>(`${path}/configure`, {})
      reload()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setRetrying(false)
    }
  }, [path, reload])

  return { data, app, reload, retry, retrying }
}

type State = 'done' | 'wait' | 'warn' | 'fail' | 'note'

const MARK: Record<State, { icon: IconName; label: string }> = {
  done: { icon: 'checkmark-circle', label: t('已完成') },
  wait: { icon: 'clock', label: t('等待中') },
  warn: { icon: 'exclamation-circle', label: t('待确认') },
  fail: { icon: 'xmark-circle', label: t('未完成') },
  note: { icon: 'exclamation-circle', label: t('提醒') },
}

function Step({ state, title, children }: { state: State; title: string; children?: ReactNode }) {
  return (
    <li className={`feishu-steps__item feishu-steps__item--${state}`}>
      <Icon name={MARK[state].icon} size={16} label={MARK[state].label} className="feishu-steps__mark" />
      <div className="feishu-steps__body">
        <span className="feishu-steps__title">{title}</span>
        {children}
      </div>
    </li>
  )
}

/** Feishu cannot tell 共工 who may use the app: a new one is the creator's only until its range is widened. */
function RangeNote() {
  return (
    <span className="feishu-steps__desc">
      {t('新应用默认只有创建者可用。请在飞书管理后台把可用范围改为需要的成员')}{' '}
      <a href={FEISHU_ADMIN} target="_blank" rel="noreferrer">
        {t('打开飞书管理后台')}
      </a>
    </span>
  )
}

/**
 * What is left after an app is saved: its long connection, the Feishu admin's approval of its first version (the dev
 * config goes through only after), and its availability range, which Feishu does not report. Folds into 已接通 once
 * connected and approved; `full` (right after scanning) keeps the range reminder then.
 */
export function FeishuAppSteps({
  app,
  retrying,
  onRetry,
  full,
}: {
  app: FeishuAppDto
  retrying: boolean
  onRetry: () => void
  full?: boolean
}) {
  if (app.status === 'connected' && app.review === 'approved')
    return (
      <div className="feishu-steps__done">
        <span className="feishu-steps__ok">
          <Icon name="checkmark-circle" size={16} />
          {t('已接通')}
        </span>
        {full ? <RangeNote /> : null}
      </div>
    )
  return (
    <ul className="feishu-steps" aria-label={t('接入进度')}>
      <Step
        state={app.status === 'connected' ? 'done' : app.status === 'connecting' ? 'wait' : 'fail'}
        title={t('已保存并连上飞书')}
      />
      {app.review === 'approved' ? (
        <Step state="done" title={t('飞书管理员已审核通过')} />
      ) : app.review === 'pending' ? (
        <Step state="wait" title={t('飞书管理员已审核通过')}>
          <span className="feishu-steps__desc">
            {t('等待企业飞书管理员审核，通过后自动完成，无需回来操作')}
          </span>
          {app.configError ? <span className="feishu-steps__detail">{app.configError}</span> : null}
          <span>
            <Button size="small" disabled={retrying} onClick={onRetry}>
              {t('重试')}
            </Button>
          </span>
        </Step>
      ) : (
        <Step state="warn" title={t('飞书管理员已审核通过')}>
          <span className="feishu-steps__desc">{t('请在飞书开发者后台确认已发布')}</span>
          {app.configError ? <span className="feishu-steps__detail">{app.configError}</span> : null}
        </Step>
      )}
      <Step state="note" title={t('成员可以使用')}>
        <RangeNote />
      </Step>
    </ul>
  )
}
