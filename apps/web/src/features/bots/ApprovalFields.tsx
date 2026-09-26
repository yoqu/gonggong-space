import type { Approval } from '@gonggong/protocol'
import { FormRow, Kbd, SegmentedControl, type Token, TokenField } from '../../ui'

export const APPROVAL_LABEL: Record<Approval, string> = {
  ask: '每次询问',
  allowlist: '白名单自动',
  all: '全部自动',
}
const APPROVALS = Object.keys(APPROVAL_LABEL) as Approval[]

/** Trimmed, whitespace-collapsed, de-duplicated command prefixes. */
export const prefixes = (tokens: Token[]) => [
  ...new Set(
    tokens.map((t) => (typeof t === 'string' ? t : t.label).trim().replace(/\s+/g, ' ')).filter(Boolean),
  ),
]

export interface ApprovalValue {
  approval: Approval
  allowlist: string[]
}

/** 命令审批: editable by the bot owner only (plan J9); everyone else sees the current setting. */
export function ApprovalFields({
  owner,
  value,
  onChange,
}: {
  owner: boolean
  value: ApprovalValue
  onChange: (value: ApprovalValue) => void
}) {
  if (!owner)
    return (
      <FormRow label="命令审批" hint="只有 Bot 主人能修改命令审批">
        <span>
          {value.approval === 'allowlist' && value.allowlist.length
            ? `${APPROVAL_LABEL.allowlist} · ${value.allowlist.join('、')}`
            : APPROVAL_LABEL[value.approval]}
        </span>
      </FormRow>
    )
  return (
    <>
      <FormRow label="命令审批">
        <SegmentedControl<Approval>
          aria-label="命令审批"
          size="small"
          value={value.approval}
          onChange={(approval) => onChange({ ...value, approval })}
          items={APPROVALS.map((v) => ({ value: v, label: APPROVAL_LABEL[v] }))}
        />
      </FormRow>
      {value.approval === 'allowlist' ? (
        <FormRow
          label="命令白名单"
          align="top"
          hint={
            <>
              输入命令前缀后按 <Kbd>↩</Kbd> 添加。以这些前缀开头的命令自动批准；用 &&、;、|
              连接时每一段都要在白名单内（cat、ls、git status 等只读命令除外），写文件的重定向或 $( )
              仍需你审批。
            </>
          }
        >
          <TokenField
            aria-label="命令白名单"
            value={value.allowlist}
            placeholder="命令前缀，如 go build"
            onChange={(tokens) => onChange({ ...value, allowlist: prefixes(tokens) })}
          />
        </FormRow>
      ) : null}
    </>
  )
}
