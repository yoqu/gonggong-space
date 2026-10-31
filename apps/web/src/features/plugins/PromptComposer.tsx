import {
  AUTO_DESIGN_SYSTEM,
  type BotDto,
  type GroupDto,
  type GroupPluginDto,
  groupDesignSystemId,
  groupDesignSystemKey,
  type PluginManifest,
  templateInputs,
} from '@gonggong/protocol'
import { type ReactNode, useRef, useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Dialog, Icon, Menu, type MenuItem, Popover, SegmentedControl } from '../../ui'
import { AttachmentChips, type useUploads } from '../attachments/ComposerAttachments'
import { ImportDesignDialog } from './ImportDesignDialog'
import type { CreationDraft } from './model'
import { PluginTile } from './PluginTile'
import { closeCreation, deleteDesignSystem, useGroupDesignSystems } from './store'

const IMPORT = '__import'
const DIRECTIONS = '__directions'
const ATTACH = '__attach'
const DELETE = 'delete:'

/** Example requests per device, like Stitch's chips under its box. */
const EXAMPLES: Record<string, string[]> = {
  小程序: [
    t('社区食堂点餐小程序：今日菜单、下单取餐、会员积分'),
    t('湖畔露营地预约：选营位和日期、确认订单、入园码'),
    t('宠物寄养小程序：寄养师列表、预约寄养、每日照片日报'),
  ],
  '手机 App': [
    t('跑步 App：今日计划、实时跑步、月度报告'),
    t('二手书交易 App：首页推荐、书籍详情、聊天议价'),
    t('家庭记账 App：本月概览、记一笔、分类统计'),
  ],
  '桌面 Web': [
    t('SaaS 客户看板：数据总览、客户列表、客户详情'),
    t('在线课程官网：首页、课程详情、报名结算'),
    t('团队周报系统：填写周报、团队汇总、个人历史'),
  ],
}

/**
 * Prompt-first 创作 for plugins with a `composer` (Stitch's home box): one request box, the device and the design
 * system (自动, a preset or one the group imported) in its toolbar, attachments and visual directions under +.
 */
export function PromptComposer({
  group,
  plugins,
  plugin,
  draft,
  onDraft,
  onPickPlugin,
  usable,
  bot,
  uploads,
  busy,
  problems,
  onSubmit,
}: {
  group: GroupDto
  plugins: GroupPluginDto[]
  plugin: GroupPluginDto
  draft: CreationDraft
  onDraft: (patch: Partial<CreationDraft>) => void
  onPickPlugin: (p: GroupPluginDto) => void
  usable: BotDto[]
  bot: BotDto | undefined
  uploads: ReturnType<typeof useUploads>
  busy: boolean
  problems: string[]
  onSubmit: () => void
}) {
  const m = plugin.manifest
  const promptId = (m.composer as NonNullable<PluginManifest['composer']>).prompt
  const template = m.templates.find((x) => x.id === draft.templateId)
  const asked = templateInputs(m, template)
  const prompt = asked.find((i) => i.id === promptId)
  const selects = asked.filter((i) => i.type === 'select')
  const device = selects[0]
  const imported = useGroupDesignSystems(group.id)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const text = typeof draft.inputs[promptId] === 'string' ? (draft.inputs[promptId] as string) : ''
  const setInput = (id: string, v: string) => onDraft({ inputs: { ...draft.inputs, [id]: v } })

  const dsKey = draft.designSystemId
  const importedPick = imported.find((d) => d.id === groupDesignSystemId(dsKey))
  const presetPick = m.designSystems.find((d) => d.id === dsKey)
  const dsTitle = importedPick?.title ?? presetPick?.title ?? t('自动选择')
  const dsSwatches = importedPick?.swatches ?? presetPick?.swatches ?? []
  const dsItems: MenuItem[] = [
    { header: t('不指定时由 AI 按需求自动选择') },
    {
      label: t('自动选择'),
      value: AUTO_DESIGN_SYSTEM,
      icon: 'sparkle',
      checked: dsKey === AUTO_DESIGN_SYSTEM,
    },
    { label: t('导入我的设计…'), value: IMPORT, icon: 'plus' },
    ...(imported.length
      ? [
          { separator: true as const },
          { header: t('本群导入') },
          ...imported.map((d) => ({
            label: <DsLabel title={d.title} swatches={d.swatches} />,
            value: groupDesignSystemKey(d.id),
            checked: d.id === importedPick?.id,
          })),
          {
            label: t('删除导入的设计'),
            icon: 'trash' as const,
            submenu: imported.map((d) => ({ label: d.title, value: `${DELETE}${d.id}`, destructive: true })),
          },
        ]
      : []),
    { separator: true },
    { header: t('预设') },
    ...m.designSystems.map((d) => ({
      label: <DsLabel title={d.title} swatches={d.swatches} />,
      value: d.id,
      checked: d.id === presetPick?.id,
    })),
  ]
  const pickDs = (v: string) => {
    if (v === IMPORT) return setImporting(true)
    if (v.startsWith(DELETE)) {
      const id = v.slice(DELETE.length)
      if (id === importedPick?.id) onDraft({ designSystemId: AUTO_DESIGN_SYSTEM })
      return void deleteDesignSystem(group.id, id).catch(toastError)
    }
    onDraft({ designSystemId: v })
  }

  const examples = EXAMPLES[String((device && draft.inputs[device.id]) ?? '')] ?? EXAMPLES.小程序 ?? []
  const blocked = busy || uploads.uploading || problems.length > 0

  return (
    <Dialog open width={920} title={t('创作')} onClose={closeCreation} closeOnBackdrop={false}>
      <div className="plg-compose">
        {plugins.length > 1 ? (
          <div className="plg-chips">
            {plugins.map((p) => (
              <button
                key={p.id}
                type="button"
                className="plg-chip"
                aria-pressed={p.id === plugin.id}
                onClick={() => onPickPlugin(p)}
              >
                <PluginTile m={p.manifest} size={20} />
                {p.manifest.title}
              </button>
            ))}
          </div>
        ) : null}
        <div className="plg-compose__head">
          <h3 className="plg-compose__title">{t('想做个什么样的产品？')}</h3>
          <Button size="small" icon="plus" onClick={() => setImporting(true)}>
            {t('导入我的设计')}
          </Button>
        </div>
        <div className="plg-compose__box">
          <textarea
            className="plg-compose__input"
            aria-label={prompt?.label ?? promptId}
            placeholder={prompt?.placeholder ?? ''}
            value={text}
            rows={5}
            // biome-ignore lint/a11y/noAutofocus: the box is the whole point of the panel
            autoFocus
            onChange={(e) => setInput(promptId, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !blocked) onSubmit()
            }}
          />
          <AttachmentChips uploads={uploads} />
          <div className="plg-compose__bar">
            <PopMenu
              className="plg-compose__icon"
              aria-label={t('更多')}
              items={[
                { label: t('添加附件…'), value: ATTACH, icon: 'paperclip' },
                { label: t('先出 2–3 个视觉方向'), value: DIRECTIONS, checked: draft.directions },
              ]}
              onSelect={(v) =>
                v === ATTACH ? fileInput.current?.click() : onDraft({ directions: !draft.directions })
              }
            >
              <Icon name="plus" size={16} />
            </PopMenu>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-label={t('添加附件')}
              onChange={(e) => {
                uploads.add([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            {selects.map((i) => (
              <SegmentedControl
                key={i.id}
                aria-label={i.label}
                size="small"
                items={i.options.map((o) => ({ value: o, label: o }))}
                value={typeof draft.inputs[i.id] === 'string' ? (draft.inputs[i.id] as string) : ''}
                onChange={(v) => setInput(i.id, v)}
              />
            ))}
            <span className="plg-compose__spacer" />
            {m.designSystems.length ? (
              <PopMenu
                className="plg-compose__pill"
                aria-label={t('设计系统：{title}', { title: dsTitle })}
                items={dsItems}
                onSelect={pickDs}
              >
                {dsSwatches.length ? <Dots colors={dsSwatches} /> : <Icon name="palette" size={14} />}
                <span className="plg-compose__pill-text">{dsTitle}</span>
                <Icon name="chevron-down" size={10} />
              </PopMenu>
            ) : null}
            {usable.length > 1 ? (
              <PopMenu
                className="plg-compose__pill"
                aria-label={t('选择 Bot')}
                items={usable.map((b) => ({ label: b.name, value: b.id, checked: b.id === bot?.id }))}
                onSelect={(botId) => onDraft({ botId })}
              >
                <Icon name="bot" size={14} />
                <span className="plg-compose__pill-text">{bot?.name}</span>
                <Icon name="chevron-down" size={10} />
              </PopMenu>
            ) : null}
            <Button
              variant="primary"
              icon="arrow-up"
              aria-label={bot ? t('交给 {bot}', { bot: bot.name }) : t('交给 AI')}
              title={problems[0]}
              disabled={blocked}
              onClick={onSubmit}
            />
          </div>
        </div>
        {problems.length && text.trim() ? (
          <div className="plg-compose__warn" role="status">
            <Icon name="warning" size={12} />
            {problems[0]}
          </div>
        ) : null}
        <div className="plg-compose__examples">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              className="plg-chip"
              aria-label={t('示例：{text}', { text: ex })}
              onClick={() => setInput(promptId, ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
      {importing ? (
        <ImportDesignDialog
          groupId={group.id}
          onClose={() => setImporting(false)}
          onImported={(ds) => {
            setImporting(false)
            onDraft({ designSystemId: groupDesignSystemKey(ds.id) })
          }}
        />
      ) : null}
    </Dialog>
  )
}

function DsLabel({ title, swatches }: { title: string; swatches: string[] }) {
  return (
    <span className="plg-compose__ds">
      {swatches.length ? <Dots colors={swatches} /> : <Icon name="globe" size={12} />}
      {title}
    </span>
  )
}

function Dots({ colors }: { colors: string[] }) {
  return (
    <span className="plg-dots" aria-hidden="true">
      {colors.slice(0, 4).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: colours may repeat
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  )
}

/** A menu above its trigger, portalled so the dialog body cannot clip it. */
function PopMenu({
  items,
  onSelect,
  className,
  children,
  'aria-label': label,
}: {
  items: MenuItem[]
  onSelect: (value: string) => void
  className: string
  children: ReactNode
  'aria-label': string
}) {
  return (
    <Popover
      portal
      placement="top-start"
      trigger={
        <button type="button" className={className} aria-label={label}>
          {children}
        </button>
      }
    >
      {(close) => (
        <Menu
          items={items}
          autoFocus
          onClose={close}
          onSelect={(v) => {
            close()
            onSelect(v)
          }}
        />
      )}
    </Popover>
  )
}
