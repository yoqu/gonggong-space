import type { SkillFile } from '@gonggong/protocol'
import { unzipSync } from 'fflate'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/

const base64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const toFile = (path: string, bytes: Uint8Array): SkillFile => {
  try {
    return { path, content: utf8.decode(bytes), encoding: 'utf8' }
  } catch {
    return { path, content: base64(bytes), encoding: 'base64' }
  }
}

/** Skill files from `[path, bytes]`: OS junk dropped, and a top folder shared by every file stripped. */
export function skillFiles(entries: [string, Uint8Array][]): SkillFile[] {
  const kept = entries.filter(([p]) => !p.endsWith('/') && !JUNK.test(p))
  const top = kept[0]?.[0].split('/')[0]
  const shared =
    top !== undefined && !kept.some(([p]) => p === 'SKILL.md') && kept.every(([p]) => p.startsWith(`${top}/`))
  return kept
    .map(([p, bytes]) => toFile(shared ? p.slice(top.length + 1) : p, bytes))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
}

const bytesOf = async (f: Blob) => new Uint8Array(await f.arrayBuffer())

export const zipSkillFiles = async (zip: Blob) => skillFiles(Object.entries(unzipSync(await bytesOf(zip))))

/** Files of a folder picked with `webkitdirectory` (paths start with the folder's name). */
export const folderSkillFiles = async (files: File[]) =>
  skillFiles(
    await Promise.all(
      files.map(async (f) => [f.webkitRelativePath || f.name, await bytesOf(f)] as [string, Uint8Array]),
    ),
  )
