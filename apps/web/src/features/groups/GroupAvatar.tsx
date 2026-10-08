import type { GroupDto } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { Avatar, type AvatarTile } from '../../ui'
import { avatarSrc } from '../bots/avatars'

/** A DM shows its bot; a group tiles its first members (people, then bots) like Feishu. */
export function GroupAvatar({
  group,
  size,
}: {
  group: Pick<GroupDto, 'name' | 'kind' | 'members' | 'botIds'>
  size: number
}) {
  const bots = useWorkspace((s) => s.bots)
  const tiles: AvatarTile[] = []
  for (const id of group.botIds) {
    const b = bots.find((x) => x.id === id)
    if (b) tiles.push({ name: b.name, src: avatarSrc(b.avatar) })
  }
  if (group.kind === 'dm' && tiles[0])
    return <Avatar name={group.name} shape="square" size={size} src={tiles[0].src} />
  const members = [...group.members.map((m) => ({ name: m.name, src: m.avatar ?? undefined })), ...tiles]
  return <Avatar name={group.name} shape="square" size={size} members={members} />
}
