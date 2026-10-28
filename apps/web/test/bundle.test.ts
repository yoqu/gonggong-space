import { resolve } from 'node:path'
import { build, type Rolldown } from 'vite'
import { expect, it } from 'vitest'

async function bundle() {
  const out = (await build({
    root: resolve(import.meta.dirname, '..'),
    logLevel: 'silent',
    build: { write: false },
  })) as Rolldown.RolldownOutput
  const chunks = out.output.filter((c): c is Rolldown.OutputChunk => c.type === 'chunk')
  const html = out.output.find((o) => o.fileName === 'index.html') as Rolldown.OutputAsset
  // What the browser downloads before the first render: the entry script and its modulepreloads.
  const first = [...String(html.source).matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) =>
    chunks.find((c) => c.fileName === m[1]),
  )
  return { chunks, first: first.filter((c) => c !== undefined) }
}

it('keeps the English dictionary and conditionally shown UI out of the first load', async () => {
  const { chunks, first } = await bundle()
  const modules = first.flatMap((c) => c.moduleIds)
  expect(modules.some((id) => id.endsWith('/src/App.tsx'))).toBe(true)
  expect(
    first.some((c) => c.code.includes('Admin console')),
    'an English-only text is in the first load',
  ).toBe(false)
  const lazy = [
    '/i18n/en.ts',
    '/fflate/',
    '/BotDialog.tsx',
    '/BotPage.tsx',
    '/NewBotDialog.tsx',
    '/NewGroupDialog.tsx',
    '/FeishuGroupDialog.tsx',
    '/BindMachineDialog.tsx',
    '/MachinePage.tsx',
    '/workbench/Workbench.tsx',
    '/NotificationPanel.tsx',
    '/SearchOverlay.tsx',
    '/SettingsDialog.tsx',
    '/GroupSettingsDialog.tsx',
    '/TeamSettingsDialog.tsx',
    '/UsagePage.tsx',
    '/CreationSheet.tsx',
    '/PluginLayer.tsx',
    '/node_modules/mermaid/',
  ]
  expect(lazy.filter((name) => modules.some((id) => id.includes(name)))).toEqual([])
  // The i18n module awaits the dictionary: a chunk the dictionary imported back would never finish loading.
  const dict = chunks.find((c) => c.moduleIds.some((id) => id.endsWith('/i18n/en.ts')))
  expect(dict?.imports).toEqual([])
}, 60_000)
