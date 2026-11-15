import type { GroupDto } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { Avatar, type AvatarTile } from '../../ui'
import { botFace, DOT_MIN } from '../bots/avatars'
import { presenceBadge } from '../bots/model'

/** An uploaded image; else a DM shows its bot and a group tiles its first members (people, then bots) like Feishu. */
export function GroupAvatar({
  group,
  size,
}: {
  group: Pick<GroupDto, 'name' | 'kind' | 'avatar' | 'members' | 'botIds'>
  size: number
}) {
  const bots = useWorkspace((s) => s.bots)
  if (group.avatar) return <Avatar name={group.name} shape="square" size={size} src={group.avatar} />
  const tiles: AvatarTile[] = []
  for (const id of group.botIds) {
    const b = bots.find((x) => x.id === id)
    if (b) tiles.push({ name: b.name, src: botFace(b) })
  }
  if (group.kind === 'dm' && tiles[0]) {
    const bot = bots.find((x) => x.id === group.botIds[0])
    return (
      <Avatar
        name={group.name}
        shape="square"
        size={size}
        src={tiles[0].src}
        {...(size >= DOT_MIN ? presenceBadge(bot) : {})}
      />
    )
  }
  const members = [...group.members.map((m) => ({ name: m.name, src: m.avatar ?? undefined })), ...tiles]
  return <Avatar name={group.name} shape="square" size={size} members={members} />
}
