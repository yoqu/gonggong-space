import type { BotDto, GgArtifactManifest, LintIssue } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { Button, Icon, Popover } from '../../ui'
import { sendCommand } from './actions'
import { focusArtifact } from './store'

/** What the AI gets for 让 AI 修复 (never translated). */
export const fixIssuesText = (issues: LintIssue[]) =>
  `修复这些规范问题，其余内容不变：\n${issues.map((i) => `- ${i.file ? `${i.file}：` : ''}${i.message}`).join('\n')}`

/**
 * The bar's 「N 项规范问题」: the list of the shown version's design-rule findings; one brings its screen into view,
 * 让 AI 修复 hands them all to the artifact's bot.
 */
export function IssuesButton({
  artifactId,
  versionId,
  issues,
  manifest,
  bot,
  readOnly,
}: {
  artifactId: string
  /** The version the findings are about (the canvas shows it to focus a screen). */
  versionId: string
  issues: LintIssue[]
  manifest: GgArtifactManifest | null | undefined
  bot: BotDto | null
  readOnly: boolean
}) {
  const [busy, setBusy] = useState(false)
  const screenOf = (file: string | undefined) => manifest?.screens.find((s) => s.file === file)
  const label = t('{n} 项规范问题', { n: issues.length })
  const fix = async (close: () => void) => {
    if (!bot || !manifest) return
    const named = [...new Set(issues.flatMap((i) => screenOf(i.file)?.id ?? []))]
    setBusy(true)
    const ok = await sendCommand(
      artifactId,
      {
        command: 'edit-with-ai',
        botId: bot.id,
        screenIds: named.length ? named : manifest.screens.map((s) => s.id),
        text: fixIssuesText(issues).slice(0, 2000),
      },
      bot,
    )
    setBusy(false)
    if (ok) close()
  }
  return (
    <Popover
      portal
      aria-label={label}
      className="art-issues"
      trigger={
        <button type="button" className="art-bar__issues">
          <Icon name="warning" size={12} />
          {label}
        </button>
      }
    >
      {(close) => (
        <>
          <ul className="art-issues__list" data-testid="art-issues">
            {issues.map((i, n) => {
              const s = screenOf(i.file)
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: findings have no id; the list is fixed per version
                <li key={n}>
                  <button
                    type="button"
                    className="art-issues__item"
                    disabled={!s}
                    onClick={() => {
                      if (!s) return
                      close()
                      focusArtifact(artifactId, { screenIds: [s.id], versionId })
                    }}
                  >
                    <span className="art-issues__where">{s?.title ?? i.file ?? t('整个产物')}</span>
                    <span className="art-issues__text">{i.message}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <Button
            size="small"
            variant="primary"
            icon="sparkle"
            fullWidth
            loading={busy}
            disabled={!bot || !manifest || readOnly}
            title={bot ? (readOnly ? t('AI 正在修改') : undefined) : t('群里没有 Bot')}
            onClick={() => void fix(close)}
          >
            {bot ? t('让 @{name} 修复', { name: bot.name }) : t('让 AI 修复')}
          </Button>
        </>
      )}
    </Popover>
  )
}
