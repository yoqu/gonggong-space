import type { UserDto } from '@gonggong/protocol'
import type { users } from '../../db/schema.js'

export const toUserDto = (u: typeof users.$inferSelect): UserDto => ({
  id: u.id,
  account: u.account,
  name: u.name,
  role: u.role as UserDto['role'],
  mustChangePassword: u.mustChangePassword,
  disabled: u.disabledAt !== null,
})
