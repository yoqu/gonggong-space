import type { InheritedMcpDto, InheritedSkillDto, McpServerDto, SkillDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Alert, EmptyState, GroupBox, GroupRow, Spinner, Tag } from '../../ui'
import './config.css'

type Row = { name: string; scope: 'group' | 'team' | 'platform'; on: boolean; description?: string }
const SOURCE = { group: t('本群'), team: t('团队'), platform: t('平台') }

type Item = McpServerDto | SkillDto | InheritedMcpDto | InheritedSkillDto
const nameOf = (d: Item) => ('config' in d ? d.config.name : d.name)
const descriptionOf = (d: Item) => ('description' in d ? d.description : undefined)

const rowsOf = (
  own: (McpServerDto | SkillDto)[],
  inherited: (InheritedMcpDto | InheritedSkillDto)[],
): Row[] => [
  ...own.map((d) => ({
    name: nameOf(d),
    scope: 'group' as const,
    on: d.enabled,
    description: descriptionOf(d),
  })),
  ...inherited.map((d) => ({
    name: nameOf(d),
    scope: d.scope,
    on: d.enabledInGroup,
    description: descriptionOf(d),
  })),
]

/** What plain members see of the group's MCP servers or skills: name, source and whether it is on, nothing to edit. */
export function GroupConfigView({ groupId, kind }: { groupId: string; kind: 'mcp' | 'skill' }) {
  const path = kind === 'mcp' ? 'mcp' : 'skills'
  const own = useGet<(McpServerDto | SkillDto)[]>(`/groups/${groupId}/${path}`)
  const inherited = useGet<(InheritedMcpDto | InheritedSkillDto)[]>(`/groups/${groupId}/inherited-${path}`)
  const error = own.error || inherited.error
  const rows = own.data && inherited.data ? rowsOf(own.data, inherited.data) : null
  return (
    <>
      <div className="gs-note">{t('仅群管理员可修改')}</div>
      {error ? (
        <Alert
          variant="error"
          title={t('配置加载失败')}
          description={error}
          retrying={own.loading || inherited.loading}
          onRetry={() => {
            own.reload()
            inherited.reload()
          }}
        />
      ) : null}
      {!rows && !error ? <Spinner /> : null}
      {rows && !rows.length ? (
        <EmptyState compact title={kind === 'mcp' ? t('暂无 MCP') : t('暂无 Skill')} />
      ) : null}
      {rows?.length ? (
        <GroupBox>
          {rows.map((r) => (
            <GroupRow
              key={`${r.scope}:${r.name}`}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{r.name}</span>
                  <Tag tone={r.scope === 'group' ? 'blue' : 'gray'}>{SOURCE[r.scope]}</Tag>
                </span>
              }
              description={r.description}
              value={r.on ? t('已开启') : t('已关闭#off')}
            />
          ))}
        </GroupBox>
      ) : null}
    </>
  )
}
