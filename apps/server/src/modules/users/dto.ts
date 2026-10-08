import type { UserDto } from '@gonggong/protocol'
import type { users } from '../../db/schema.js'

/** What clients load: uploads (`avatars/…`) through the API, the Feishu avatar as is. */
export const avatarUrl = (avatar: string | null) =>
  avatar?.startsWith('avatars/') ? `/api/${avatar}` : avatar

export const toUserDto = (u: typeof users.$inferSelect): UserDto => ({
  id: u.id,
  account: u.account,
  name: u.name,
  role: u.role as UserDto['role'],
  mustChangePassword: u.mustChangePassword,
  disabled: u.disabledAt !== null,
  gitProtocol: u.gitProtocol as UserDto['gitProtocol'],
  email: u.email,
  avatar: avatarUrl(u.avatar),
})
