import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function releaseNotes(path) {
  if (!path) return undefined
  const body = readFileSync(path, 'utf8').trim()
  return body || undefined
}

export function releaseManifest(version, builds, notes) {
  return {
    version,
    ...(notes ? { releaseNotes: notes } : {}),
    builds: JSON.parse(builds),
  }
}

export function updaterManifest(version, notes, pubDate, platforms) {
  return {
    version,
    ...(notes ? { notes } : {}),
    pub_date: pubDate,
    platforms: JSON.parse(platforms),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, version, notesFile, ...args] = process.argv.slice(2)
  const notes = releaseNotes(notesFile)
  const output =
    kind === 'release'
      ? releaseManifest(version, args[0], notes)
      : kind === 'updater'
        ? updaterManifest(version, notes, args[0], args[1])
        : undefined
  if (!output) throw new Error(`unknown manifest kind: ${kind}`)
  process.stdout.write(`${JSON.stringify(output)}\n`)
}
