import { useState } from 'react'
import { t } from '../../i18n'
import { type AskedQuestion, askedQuestions, type McpCall, mcpArgs, QUESTION_TYPE } from './mcp'

const HEAD_LINES = 8

/** An MCP call unfolded: its arguments as a key / value list, then the head of its result. */
export function McpDetail({ call }: { call: McpCall }) {
  const asked = askedQuestions(call)
  const args = mcpArgs(call.input)
  return (
    <div className="act-detail act-detail--mono act-mcp">
      {asked ? (
        <Asked questions={asked} />
      ) : call.input ? (
        <section>
          <div className="act-mcp__label">{t('参数')}</div>
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

function Asked({ questions }: { questions: AskedQuestion[] }) {
  return (
    <section>
      <div className="act-mcp__label">{t('问题')}</div>
      <ol className="act-ask">
        {questions.map((q, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: questions are positional
          <li key={i}>
            <div>
              <span className="act-ask__type">{QUESTION_TYPE[q.type]}</span> {q.title}
            </div>
            {q.options?.length ? (
              <div className="act-ask__opts">
                {q.options
                  .map((o, j) => (j === q.recommended ? t('{option}（推荐）', { option: o }) : o))
                  .join(' / ')}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Results read from the top (a message list, an answer), unlike a command's output. */
function Result({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const lines = text.split('\n')
  const hidden = all ? 0 : Math.max(0, lines.length - HEAD_LINES)
  return (
    <section>
      <div className="act-mcp__label">{t('结果')}</div>
      <pre>{hidden ? lines.slice(0, HEAD_LINES).join('\n') : text}</pre>
      {hidden ? (
        <button type="button" className="act-detail__more" onClick={() => setAll(true)}>
          {t('… 另有 {n} 行', { n: hidden })}
        </button>
      ) : null}
    </section>
  )
}
