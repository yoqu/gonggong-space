import type { RunEvent } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type Action, buildItems } from '../src/features/runs/activity'
import { ProcessView } from '../src/features/runs/ProcessView'
import { processSteps } from '../src/features/runs/steps'

const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 1, 0, s)).toISOString()
let id = 0
const tool = (e: Partial<Extract<RunEvent, { kind: 'tool' }>>): RunEvent => ({
  kind: 'tool',
  toolCallId: `w${++id}`,
  title: 'Web search',
  toolKind: 'fetch',
  status: 'completed',
  ...e,
})
const hit = (host: string, title: string) => ({ title, url: `https://${host}/${title.length}` })
const search = (
  query: string,
  hits: { title: string; url: string }[] = [],
  o: Partial<Extract<RunEvent, { kind: 'tool' }>> = {},
) => tool({ title: `Search "${query}"`, web: { query, hits }, ...o })
const fetchPage = (url: string) => tool({ title: `Fetch ${url}`, web: { url } })
const steps = (events: RunEvent[], live = false) =>
  processSteps(
    events.map((event, i) => ({ id: i + 1, at: at(i), event })),
    [],
    live,
  )
const actions = (events: RunEvent[], live = false) =>
  buildItems(steps(events, live), null, live, null).flatMap((i) =>
    i.kind === 'action' ? [i as Action] : i.kind === 'group' ? i.actions : [],
  )

describe('web searches in the process', () => {
  it('fold consecutive searches and fetches into one row counting the pages found', () => {
    const all = actions([
      search('fastify 5', [hit('fastify.dev', 'Migration Guide'), hit('github.com', 'Release v5')]),
      { kind: 'thought', delta: '再查一下' },
      search('fastify reply.sent', [
        hit('fastify.dev', 'Migration Guide'),
        hit('stackoverflow.com', 'reply.sent'),
      ]),
      fetchPage('https://nodejs.org/en/blog'),
      tool({ title: 'Read a.ts', toolKind: 'read', detail: 'a.ts' }),
    ])
    expect(all.map((a) => a.family)).toEqual(['fetch', 'thought', 'explore'])
    expect(all[0]).toMatchObject({ verb: '已搜索 4 个网站' })
    expect(all[0]?.web).toHaveLength(3)
  })

  it('name the query being searched while running, and the queries when nothing was listed (Codex)', () => {
    const [live] = actions([search('rust 2024', [], { status: 'in_progress' })], true)
    expect(live).toMatchObject({ verb: '正在搜索', target: '“rust 2024”' })
    const [codex] = actions([
      search('rust 2024', [], { toolKind: 'search', title: 'Web search: rust 2024' }),
      search('edition guide', [], { toolKind: 'search' }),
    ])
    expect(codex).toMatchObject({ verb: '已搜索', target: '“rust 2024”、“edition guide”' })
    const [page] = actions([fetchPage('https://nodejs.org/en/blog')])
    expect(page).toMatchObject({ verb: '已访问 1 个网页' })
  })

  it('leaves calls an older daemon sent without web details as they were', () => {
    const [a, b] = actions([tool({ title: 'Search "x"' }), tool({ title: 'Fetch https://a.dev' })])
    expect([a?.web, a?.verb, b?.verb]).toEqual([undefined, '已访问', '已访问'])
  })

  it('lists the sources while searching and folds them once done', () => {
    const events = [
      search('fastify 5', [hit('fastify.dev', 'Migration Guide')]),
      search('fastify reply.sent', [], { status: 'in_progress' }),
    ]
    const { rerender } = render(
      <ProcessView steps={steps(events, true)} root={null} live startedAt={null} workedMs={null} />,
    )
    const link = screen.getByRole('link', { name: /Migration Guide/ })
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
      'https://fastify.dev/15',
      '_blank',
      'noopener noreferrer',
    ])
    expect(screen.getByText('“fastify reply.sent”', { selector: '.act-web__query' })).toBeTruthy()

    const done = [events[0]!, search('fastify reply.sent', [hit('stackoverflow.com', 'reply.sent')])]
    rerender(<ProcessView steps={steps(done)} root={null} live={false} startedAt={null} workedMs={null} />)
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /已搜索 2 个网站/ }))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      expect.stringContaining('Migration Guide'),
      expect.stringContaining('reply.sent'),
    ])
  })
})
