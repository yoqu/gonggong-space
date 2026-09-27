import { useState } from 'react'
import { type McpCall, mcpArgs } from './mcp'

const HEAD_LINES = 8

/** An MCP call unfolded: its arguments as a key / value list, then the head of its result. */
export function McpDetail({ call }: { call: McpCall }) {
  const args = mcpArgs(call.input)
  return (
    <div className="act-detail act-detail--mono act-mcp">
      {call.input ? (
        <section>
          <div className="act-mcp__label">参数</div>
          {args ? (
            <dl className="act-mcp__args">
              {args.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <pre>{call.input}</pre>
          )}
        </section>
      ) : null}
      {call.output ? <Result text={call.output} /> : null}
    </div>
  )
}

/** Results read from the top (a message list, an answer), unlike a command's output. */
function Result({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const lines = text.split('\n')
  const hidden = all ? 0 : Math.max(0, lines.length - HEAD_LINES)
  return (
    <section>
      <div className="act-mcp__label">结果</div>
      <pre>{hidden ? lines.slice(0, HEAD_LINES).join('\n') : text}</pre>
      {hidden ? (
        <button type="button" className="act-detail__more" onClick={() => setAll(true)}>
          … 另有 {hidden} 行
        </button>
      ) : null}
    </section>
  )
}
