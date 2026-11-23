#!/usr/bin/env node
// Writes vendor/open-artifact's root package.json and tsconfig.json, cut down to the packages kept.
// Usage: node scripts/vendor-open-artifact-manifest.mjs <upstream checkout> <dest> <package>...
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dest, ...packages] = process.argv.slice(2)
const pkg = JSON.parse(readFileSync(`${src}/package.json`, 'utf8'))
pkg.workspaces = packages.map((p) => `packages/${p}`)
pkg.scripts = {
  typecheck: 'tsc -p tsconfig.json',
  test: 'node --test "packages/*/test/*.test.ts"',
}
writeFileSync(`${dest}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`)
const ts = JSON.parse(readFileSync(`${src}/tsconfig.json`, 'utf8'))
ts.include = ['packages/*/src', 'packages/*/test', 'packages/*/vite.config.ts']
delete ts.exclude
writeFileSync(`${dest}/tsconfig.json`, `${JSON.stringify(ts, null, 2)}\n`)
