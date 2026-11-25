import type { BotDto, GroupDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { type Candidate, CandidatePopover, useCandidates } from '../src/features/chat/ComposerCandidates'

const items = Array.from(
  { length: 12 },
  (_, i) => ({ key: `b${i}`, label: `Bot ${i}`, icon: 'bot', insert: `@Bot${i} ` }) as unknown as Candidate,
)
const sections = [{ label: 'Bot', src: '', items }]

const popover = (active: Candidate | undefined) => (
  <CandidatePopover id="cand" char="@" sections={sections} active={active} onPick={() => {}} />
)

let viewport: { offsetTop: number; addEventListener: () => void; removeEventListener: () => void }
beforeEach(() => {
  viewport = { offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('visualViewport', viewport)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useWorkspace.setState({ bots: [] })
  useSession.setState({ user: null })
})

/** The popover's bottom edge sits at `bottom` in layout coordinates (it opens upward from the composer). */
const placeAt = (bottom: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom } as DOMRect)

describe('CandidatePopover on a short viewport', () => {
  it('fits the room above the composer that the keyboard leaves visible', () => {
    placeAt(600)
    viewport.offsetTop = 400
    render(popover(items[0]))
    expect(screen.getByTestId('composer-popover').style.maxHeight).toBe('192px')
  })

  it('keeps its usual cap when there is room', () => {
    placeAt(900)
    render(popover(items[0]))
    expect(screen.getByTestId('composer-popover').style.maxHeight).toBe('360px')
  })

  it('scrolls the highlighted row into view inside the list, never the page', () => {
    placeAt(600)
    const { rerender } = render(popover(items[0]))
    const list = screen.getByTestId('composer-popover')
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true })
    const row = screen.getByRole('option', { name: /Bot 9/ })
    Object.defineProperty(row, 'offsetTop', { value: 300, configurable: true })
    Object.defineProperty(row, 'offsetHeight', { value: 32, configurable: true })
    rerender(popover(items[9]))
    expect(list.scrollTop).toBe(232)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
})

function AtPopover({ group }: { group: GroupDto }) {
  const { sections, items } = useCandidates(group, '@')
  return <CandidatePopover id="cand" char="@" sections={sections} active={items[0]} onPick={() => {}} />
}

describe('CandidatePopover @ avatars', () => {
  it('renders uploaded member avatars, falls back to initials when null, and uses the @ badge for @所有人', () => {
    useSession.setState({ user: { id: 'u1', name: '姜维川' } as never })
    useWorkspace.setState({
      bots: [
        {
          id: 'b1',
          name: '共字君',
          ownerName: '姜维川',
          presence: 'online',
          avatar: 'role-gong',
          followAgent: false,
          agentKind: 'claude',
          avatarUrl: '/api/avatars/bot-1.png',
        } as BotDto,
      ],
    })
    const group = {
      id: 'g1',
      kind: 'group',
      botIds: ['b1'],
      members: [
        { userId: 'u1', name: '姜维川', avatar: '/api/avatars/u1.png', isAdmin: true },
        { userId: 'u2', name: '蒋庆', avatar: '/api/avatars/u2.png', isAdmin: false },
        { userId: 'u3', name: '王小明', avatar: null, isAdmin: false },
      ],
    } as unknown as GroupDto

    render(<AtPopover group={group} />)

    const jiang = screen.getByRole('option', { name: /蒋庆/ })
    expect(jiang.querySelector('img')?.getAttribute('src')).toBe('/api/avatars/u2.png')

    const jwc = screen.getByRole('option', { name: /^姜维川/ })
    expect(jwc.querySelector('img')?.getAttribute('src')).toBe('/api/avatars/u1.png')

    const wang = screen.getByRole('option', { name: /王小明/ })
    expect(wang.querySelector('img')).toBeNull()
    expect(wang.querySelector('.ui-avatar__text')?.textContent).toBe('小明')

    const bot = screen.getByRole('option', { name: /共字君/ })
    expect(bot.querySelector('img')?.getAttribute('src')).toBe('/api/avatars/bot-1.png')

    const all = screen.getByRole('option', { name: /所有人/ })
    expect(all.querySelector('.pn-mentionpicker__all')).not.toBeNull()
    expect(all.querySelector('.ui-avatar__text')).toBeNull()
  })
})
