import type { Question } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { translator } from '../src/i18n/index.js'
import { summarize as summarizeAudit } from '../src/modules/admin/audit.js'
import { answerText } from '../src/modules/questions/dto.js'

const emptyNames = {
  user: () => '',
  bot: () => '',
  runBot: () => '',
}

describe('audit summaries (U-50)', () => {
  it('formats feishu.project.create_group, webhook actions, and all CLI tools', () => {
    expect(
      summarizeAudit(
        { category: 'admin', action: 'feishu.project.create_group' },
        { name: '项目群 A' },
        emptyNames,
      ),
    ).toBe('由飞书项目自动创建群 项目群 A')
    expect(
      summarizeAudit({ category: 'webhook', action: 'webhook.call' }, { name: '报警通知' }, emptyNames),
    ).toBe('触发 Webhook「报警通知」')
    expect(
      summarizeAudit(
        { category: 'webhook', action: 'webhook.auto_disable' },
        { name: '报警通知', reason: 'owner_left' },
        emptyNames,
      ),
    ).toBe('Webhook「报警通知」已自动停用（创建人已离群）')
    expect(
      summarizeAudit({ category: 'webhook', action: 'webhook.create' }, { name: '报警通知' }, emptyNames),
    ).toBe('新建 Webhook「报警通知」')
    expect(
      summarizeAudit(
        { category: 'admin', action: 'machine.tools.install' },
        { kind: 'opencode' },
        emptyNames,
      ),
    ).toBe('安装 OpenCode')
    expect(
      summarizeAudit({ category: 'admin', action: 'machine.tools.upgrade' }, { kind: 'copilot' }, emptyNames),
    ).toBe('升级 GitHub Copilot CLI')
  })

  it('translates audit summaries into English', () => {
    const en = translator('en')
    expect(
      summarizeAudit(
        { category: 'admin', action: 'feishu.project.create_group' },
        { name: 'Project A' },
        emptyNames,
        en,
      ),
    ).toBe('Auto-created group Project A from Feishu Project')
    expect(
      summarizeAudit({ category: 'webhook', action: 'webhook.call' }, { name: 'Alerts' }, emptyNames, en),
    ).toBe('Triggered webhook "Alerts"')
    expect(
      summarizeAudit(
        { category: 'webhook', action: 'webhook.auto_disable' },
        { name: 'Alerts', reason: 'owner_left' },
        emptyNames,
        en,
      ),
    ).toBe('Webhook "Alerts" auto-disabled (owner left the group)')
    expect(
      summarizeAudit(
        { category: 'admin', action: 'user.create' },
        { account: 'alice', role: 'sysadmin' },
        emptyNames,
        en,
      ),
    ).toBe('Created account alice (system admin)')
    expect(
      summarizeAudit(
        { category: 'admin', action: 'team.member.add' },
        { name: 'Alice', role: 'member' },
        emptyNames,
        en,
      ),
    ).toBe('Added Alice to the team (member)')
    expect(
      summarizeAudit(
        { category: 'admin', action: 'params.update' },
        { changes: { registrationOpen: [false, true] } },
        emptyNames,
        en,
      ),
    ).toBe('Changed system parameters: Opened self-registration')
  })
})

describe('answerText localization (U-50)', () => {
  const q: Question = {
    id: 'q1',
    type: 'multi',
    title: 'Channels?',
    options: ['WeChat', 'Alipay'],
    recommended: null,
  }

  it('renders Chinese by default and English when given an English translator', () => {
    expect(answerText(q, [{ questionId: 'q1', choices: [0, 1], text: 'UnionPay' }])).toBe(
      'WeChat、Alipay、其他：UnionPay',
    )
    expect(answerText(q, [{ questionId: 'q1', choices: [], text: null }])).toBe('（未作答）')

    const en = translator('en')
    expect(answerText(q, [{ questionId: 'q1', choices: [0, 1], text: 'UnionPay' }], en)).toBe(
      'WeChat, Alipay, Other: UnionPay',
    )
    expect(answerText(q, [{ questionId: 'q1', choices: [], text: null }], en)).toBe('(Not answered)')
  })
})
