import type { TerminalSpaceCreateReq, TerminalSpaceDto } from '@gonggong/protocol'
import { create } from 'zustand'
import { api } from '../../lib/api'

/** My machine terminals, listed among the conversations. */
export const useTerminalSpaces = create<{ spaces: TerminalSpaceDto[] }>()(() => ({ spaces: [] }))

const put = (space: TerminalSpaceDto) =>
  useTerminalSpaces.setState((s) => ({
    spaces: s.spaces.some((x) => x.id === space.id)
      ? s.spaces.map((x) => (x.id === space.id ? space : x))
      : [space, ...s.spaces],
  }))

export async function loadTerminalSpaces() {
  useTerminalSpaces.setState({ spaces: await api.get<TerminalSpaceDto[]>('/terminal-spaces') })
}

export async function createTerminalSpace(input: TerminalSpaceCreateReq) {
  const space = await api.post<TerminalSpaceDto>('/terminal-spaces', input)
  put(space)
  return space
}

export async function renameTerminalSpace(id: string, name: string) {
  put(await api.patch<TerminalSpaceDto>(`/terminal-spaces/${id}`, { name }))
}

export async function deleteTerminalSpace(id: string) {
  await api.del<void>(`/terminal-spaces/${id}`)
  useTerminalSpaces.setState((s) => ({ spaces: s.spaces.filter((x) => x.id !== id) }))
}

/** Opening a space moves it up the list, as the server records. */
export const touchTerminalSpace = (id: string) =>
  useTerminalSpaces.setState((s) => ({
    spaces: s.spaces.map((x) => (x.id === id ? { ...x, lastActiveAt: new Date().toISOString() } : x)),
  }))
