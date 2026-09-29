import type { RunEvent } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { classify } from '../src/features/runs/activity'
import { mcpArgs, toolTitle } from '../src/features/runs/mcp'
import { ProcessView } from '../src/features/runs/ProcessView'
import { processSteps } from '../src/features/runs/steps'

const at = (s: number) => new Date(Date.UTC(2026, 8, 27, 1, 0, s)).toISOString()
const tool = (e: Partial<Extract<RunEvent, { kind: 'tool' }>>): RunEvent => ({
  kind: 'tool',
  toolCallId: 'm1',
  title: 'mcp__gonggong__list_messages',
  toolKind: 'other',
  status: 'completed',
  ...e,
})
const listMessages = {
  server: 'gonggong',
  tool: 'list_messages',
  input: '{"limit":20,"author":"王磊"}',
  output: '#1 王磊: 退款要兼容 v1\n#2 陈晨: 好',
}

describe('MCP tool names', () => {
  it('names gonggong tools in Chinese and other servers by server and tool', () => {
    expect(toolTitle('mcp__gonggong__list_messages')).toBe('读取聊天记录')
    expect(toolTitle('mcp.gonggong.ask_group_members')).toBe('向群成员提问')
    expect(toolTitle('mcp__claude_ai_Figma__get_metadata')).toBe('Figma · get_metadata')
    expect(toolTitle('Read src/a.ts')).toBe('Read src/a.ts')
  })

  it('hides session config echoes from the run card step', () => {
    expect(toolTitle('已切换推理强度：High')).toBe('')
    expect(toolTitle('已切换模型：Opus')).toBe('')
    expect(toolTitle('档位已切换为「完全访问」，自动批准：ls')).toBe('档位已切换为「完全访问」，自动批准：ls')
  })

  it('lists arguments as key and short value', () => {
    expect(mcpArgs('{"limit":20,"author":"王磊","all":true}')).toEqual([
      ['limit', '20'],
      ['author', '王磊'],
      ['all', 'true'],
    ])
    expect(mcpArgs('{"questions":[{"title":"a"},{"title":"b"}],"q":{"a":1}}')).toEqual([
      ['questions', '2 项'],
      ['q', '{"a":1}'],
    ])
    expect(mcpArgs('{"cut":"abc…')).toBeNull()
    expect(mcpArgs(undefined)).toBeNull()
  })
})

describe('MCP steps', () => {
  it('turn Claude and Codex MCP calls into named steps with an argument summary', () => {
    const steps = processSteps(
      [
        { id: 1, at: at(1), event: tool({ status: 'pending', mcp: { ...listMessages, output: undefined } }) },
        { id: 2, at: at(2), event: tool({ mcp: listMessages }) },
        {
          id: 3,
          at: at(3),
          event: tool({
            toolCallId: 'c1',
            title: 'mcp.gonggong.search_messages',
            toolKind: 'execute',
            status: 'failed',
            mcp: { server: 'gonggong', tool: 'search_messages', input: '{"query":"登录"}' },
          }),
        },
      ],
      [],
      false,
    )
    expect(steps.map((s) => [s.kind, s.title, s.mono, s.failed])).toEqual([
      ['mcp', '读取聊天记录', 'limit=20 · author=王磊', false],
      ['mcp', '检索聊天记录', 'query=登录', true],
    ])
    expect(steps[0]!.mcp).toEqual(listMessages)
    expect(classify(steps[0]!, null)).toMatchObject({
      family: 'mcp',
      verb: '读取聊天记录',
      target: 'limit=20 · author=王磊',
    })
    expect(classify(steps[1]!, null)).toMatchObject({ family: 'mcp', verb: '检索聊天记录失败' })
  })

  it('unfolds to the arguments and the result', () => {
    const steps = processSteps([{ id: 1, at: at(1), event: tool({ mcp: listMessages }) }], [], false)
    render(<ProcessView steps={steps} root={null} live={false} startedAt={null} workedMs={null} />)
    fireEvent.click(screen.getByRole('button', { name: /读取聊天记录/ }))
    expect(screen.getByText('参数')).toBeTruthy()
    expect(screen.getByText('author')).toBeTruthy()
    expect(screen.getByText('王磊')).toBeTruthy()
    expect(screen.getByText('结果')).toBeTruthy()
    expect(screen.getByText(/退款要兼容 v1/)).toBeTruthy()
  })

  it('shows the questions of an ask call and the answer', () => {
    const ask = {
      server: 'gonggong',
      tool: 'ask_group_members',
      input: JSON.stringify({
        questions: [
          { type: 'single', title: '用哪种语言？', options: ['Python', 'Go'], recommended: 0 },
          { type: 'text', title: '还有什么要注意？' },
        ],
      }),
      output: '王磊 的回答：\n1. 用哪种语言？（单选）→ Go\n2. 还有什么要注意？（自由文本）→ 幂等',
    }
    const steps = processSteps(
      [{ id: 1, at: at(1), event: tool({ title: 'mcp__gonggong__ask_group_members', mcp: ask }) }],
      [],
      false,
    )
    expect(steps[0]!.mono).toBe('用哪种语言？ / 还有什么要注意？')
    render(<ProcessView steps={steps} root={null} live={false} startedAt={null} workedMs={null} />)
    fireEvent.click(screen.getByRole('button', { name: /向群成员提问/ }))
    expect(screen.getByText('问题')).toBeTruthy()
    expect(screen.getByText('Python（推荐） / Go')).toBeTruthy()
    expect(screen.queryByText('questions')).toBeNull()
    expect(screen.getByText(/1\. 用哪种语言？（单选）→ Go/)).toBeTruthy()
  })
})
