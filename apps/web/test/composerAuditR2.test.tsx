import { readFileSync } from 'node:fs'
import type { BotDto, GroupDto, GroupPluginDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { escFree } from '../src/features/chat/unreadMark'
import { usePluginStore } from '../src/features/plugins/store'
import { useEscape } from '../src/ui'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
}

const creationPlugin: GroupPluginDto = {
  id: 'p1',
  layer: 'platform',
  manifest: {
    name: 'web-prototype',
    version: '1.2.0',
    title: '网页原型',
    description: '落地页、官网、活动页',
    category: 'web',
    agents: ['claude'],
    minDaemon: '0.4.0',
    entry: 'web-prototype',
    permissions: [],
    contributes: { mcp: [], commands: [], providers: [], agents: [] },
    templates: [],
    designSystems: [],
    inputs: [],
    secrets: [],
    license: 'Apache-2.0',
    source: null,
    composer: null,
  },
  versionId: 'v1',
  revision: 1,
  size: 1024,
  updatedBy: '王磊',
  updatedAt: '2026-09-23T02:00:00.000Z',
  builtin: false,
  enabledInGroup: true,
  bots: [{ botId: 'b1', blocker: null }],
}

beforeEach(() => {
  sessionStorage.clear()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ bots: [bot], botStates: {} })
  usePluginStore.setState({ lists: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Composer Round 2 audit fixes', () => {
  it('pops EmojiPicker on Escape before outer layer, guards IME, refocuses trigger, and blocks read', () => {
    const onOuterClose = vi.fn()
    const onRead = vi.fn()
    function Host() {
      useEscape(onOuterClose)
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape' && !e.defaultPrevented && escFree()) onRead()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return <MessageComposer group={group} onSent={() => {}} />
    }
    render(<Host />)

    const emojiBtn = screen.getByRole('button', { name: '表情' })
    fireEvent.click(emojiBtn)
    const dialog = screen.getByRole('dialog', { name: '选择表情' })
    const search = within(dialog).getByRole('searchbox', { name: '搜索表情' })
    search.focus()

    // Esc during CJK IME composition does not close EmojiPicker or lower layers.
    fireEvent.compositionStart(search)
    fireEvent.keyDown(search, { key: 'Escape' })
    fireEvent.keyDown(search, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('dialog', { name: '选择表情' })).toBeTruthy()
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(onRead).not.toHaveBeenCalled()

    // Esc after composition closes only EmojiPicker, restores focus to its trigger, and does not mark read.
    fireEvent.compositionEnd(search)
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
    expect(document.activeElement).toBe(emojiBtn)
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(onRead).not.toHaveBeenCalled()

    // Next Esc reaches the outer layer (e.g. ThreadView).
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onOuterClose).toHaveBeenCalledOnce()
    expect(onRead).not.toHaveBeenCalled()
  })

  it('keeps EmojiPicker and @ CandidatePopover mutually exclusive with zero overlap', () => {
    mockApi({})
    render(<MessageComposer group={group} onSent={() => {}} />)
    const box = screen.getByRole('combobox') as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } })
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()

    // Opening EmojiPicker dismisses the open @ CandidatePopover.
    fireEvent.click(screen.getByRole('button', { name: '表情' }))
    expect(screen.getByRole('dialog', { name: '选择表情' })).toBeTruthy()
    expect(screen.queryByRole('listbox', { name: '@ 候选' })).toBeNull()

    // Opening @ CandidatePopover again closes EmojiPicker.
    fireEvent.click(screen.getByRole('button', { name: '@ 提及' }))
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '选择表情' })).toBeNull()
  })

  it('closes @ CandidatePopover on outside press, blurred Escape, and moving caret away from @', () => {
    mockApi({})
    const onOuterClose = vi.fn()
    function Host() {
      useEscape(onOuterClose)
      return (
        <div>
          <button type="button">外部区域</button>
          <MessageComposer group={group} onSent={() => {}} />
        </div>
      )
    }
    render(<Host />)
    const box = screen.getByRole('combobox') as HTMLTextAreaElement

    // Outside click dismisses CandidatePopover.
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } })
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部区域' }))
    expect(screen.queryByRole('listbox', { name: '@ 候选' })).toBeNull()

    // Blurred Escape dismisses CandidatePopover before outer useEscape.
    fireEvent.change(box, { target: { value: '@小', selectionStart: 2 } })
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()
    box.blur()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: '@ 候选' })).toBeNull()
    expect(onOuterClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOuterClose).toHaveBeenCalledOnce()

    // Moving cursor away from the @ token closes CandidatePopover and restores normal arrow navigation.
    box.focus()
    fireEvent.change(box, { target: { value: '请看下 @', selectionStart: 5 } })
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()
    box.setSelectionRange(2, 2)
    fireEvent.keyUp(box, { key: 'ArrowLeft' })
    expect(screen.queryByRole('listbox', { name: '@ 候选' })).toBeNull()
    expect(fireEvent.keyDown(box, { key: 'ArrowDown' })).toBe(true)

    // Returning caret to @ reopens; moving away via selection closes again.
    box.setSelectionRange(5, 5)
    fireEvent.click(box)
    expect(screen.getByRole('listbox', { name: '@ 候选' })).toBeTruthy()
    box.setSelectionRange(1, 1)
    fireEvent.select(box)
    expect(screen.queryByRole('listbox', { name: '@ 候选' })).toBeNull()
  })

  it('inserts " /" at the caret after existing text and toggles the command popover', async () => {
    mockApi({
      'GET /groups/g1/candidates/commands': {
        system: [{ name: 'new', hint: '开新会话' }],
        skill: [],
        plugin: [],
        agent: [],
      },
    })
    render(<MessageComposer group={group} onSent={() => {}} />)
    const box = screen.getByRole('combobox') as HTMLTextAreaElement
    box.focus()
    fireEvent.change(box, { target: { value: '请检查一下', selectionStart: 5 } })

    const cmdBtn = screen.getByRole('button', { name: '命令' })
    fireEvent.click(cmdBtn)
    expect(box.value).toBe('请检查一下 /')
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(7)
    const list = await screen.findByRole('listbox', { name: '/ 命令' })
    expect(within(list).getByRole('option', { name: /\/new/ })).toBeTruthy()

    // Clicking the command button again dismisses the open popover without duplicating " /".
    fireEvent.click(cmdBtn)
    expect(screen.queryByRole('listbox', { name: '/ 命令' })).toBeNull()
    expect(box.value).toBe('请检查一下 /')
    expect(document.activeElement).toBe(box)
  })

  it('omits the 创作 button in thread and canvasChat modes while keeping it in main chat', () => {
    usePluginStore.setState({ lists: { g1: [creationPlugin] } })
    const { rerender } = render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.getByRole('button', { name: '创作' })).toBeTruthy()

    rerender(<MessageComposer group={group} thread="m1" onSent={() => {}} />)
    expect(screen.queryByRole('button', { name: '创作' })).toBeNull()

    rerender(
      <MessageComposer
        group={group}
        canvasChat={{ rootId: 'r1', artifactId: 'a1', botId: 'b1' }}
        onSent={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '创作' })).toBeNull()
  })

  it('enforces narrow-width popover/bar wrapping and coarse touch-target minimums in CSS', () => {
    const readCss = (p: string) => readFileSync(`src/${p}`, 'utf8')
    const pickers = readCss('ui/im/pickers.css')
    const composer = readCss('ui/im/composer.css')
    const runConfig = readCss('features/chat/run-config.css')
    const context = readCss('features/chat/context.css')
    const segmented = readCss('ui/segmented.css')

    expect(pickers).toContain('max-width: calc(100vw - 24px);')
    expect(composer).toContain('max-width: calc(100% - 16px);')
    expect(composer).toMatch(/\.pn-composer__bar \{[^}]*flex-wrap: wrap;[^}]*row-gap: var\(--space-6\);/)
    expect(composer).toMatch(
      /\.pn-threadpanel \.pn-composer__bar \.pn-composer__accessory:not\(:empty\) \{[^}]*order: -1;[^}]*flex: 1 0 100%;/,
    )
    expect(runConfig).toMatch(/@media \(pointer: coarse\) \{\s*\.run-config__chip \{\s*min-height: 32px;/)
    expect(context).toMatch(
      /@media \(pointer: coarse\) \{\s*\.ctx-meter \{\s*min-height: 32px;[\s\S]*?\.ctx-pop__actions \.ui-btn \{\s*min-height: 32px;/,
    )
    expect(segmented).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-seg--small \{\s*height: 32px;/)
  })
})
