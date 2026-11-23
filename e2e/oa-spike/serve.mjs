#!/usr/bin/env node
// Spike servers. Host (main-site stand-in): host.html and the test deck's files for its in-memory store.
// Editor (preview-origin stand-in): the built Slides editor under /__oa/slides/, plus the URL paths the editor may load
// by itself (`project/…` beside the page, `/_blob/<id>` at the root), so the spike can see whether it does.
// OA_SPIKE_CSP: a Content-Security-Policy header for every editor response, to find what the editor needs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const vendor = join(here, '../../vendor/open-artifact')
const editorDir = join(vendor, 'dist/editors/slides')
const deckDir = join(vendor, 'test-artifacts/slides/browser-smoke')
const hostPort = Number(process.env.OA_SPIKE_HOST_PORT ?? 4811)
const editorPort = Number(process.env.OA_SPIKE_EDITOR_PORT ?? 4812)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function sendFile(res, root, rel, headers = {}) {
  const full = normalize(join(root, rel))
  if (relative(root, full).startsWith('..')) return void res.writeHead(403).end()
  try {
    const body = readFileSync(full)
    res.writeHead(200, {
      'content-type': MIME[extname(full)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      ...headers,
    })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}

function walk(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(root, full) : [relative(root, full).split('\\').join('/')]
  })
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/') return sendFile(res, here, 'host.html')
  if (pathname === '/deck-index.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(walk(deckDir)))
  }
  if (pathname.startsWith('/deck/')) return sendFile(res, deckDir, decodeURIComponent(pathname.slice(6)))
  res.writeHead(404).end()
}).listen(hostPort, '127.0.0.1')

const csp = process.env.OA_SPIKE_CSP ? { 'content-security-policy': process.env.OA_SPIKE_CSP } : {}
const blobs = new Map()
const editor = (req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  const path = decodeURIComponent(pathname)
  if (path.startsWith('/__spike/blob/')) {
    const cors = {
      'access-control-allow-origin': `http://127.0.0.1:${hostPort}`,
      'access-control-allow-methods': 'PUT',
      'access-control-allow-headers': 'content-type',
    }
    if (req.method !== 'PUT') return void res.writeHead(204, cors).end()
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      blobs.set(path.slice('/__spike/blob/'.length), {
        body: Buffer.concat(chunks),
        type: req.headers['content-type'],
      })
      res.writeHead(204, cors).end()
    })
    return
  }
  const blob = path.startsWith('/_blob/') && blobs.get(path.slice('/_blob/'.length))
  if (blob) {
    res.writeHead(200, {
      'content-type': blob.type ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      ...csp,
    })
    return res.end(blob.body)
  }
  if (path.startsWith('/__oa/slides/project/'))
    return sendFile(res, deckDir, path.slice('/__oa/slides/'.length), csp)
  if (path.startsWith('/__oa/slides/'))
    return sendFile(res, editorDir, path.slice('/__oa/slides/'.length) || 'index.html', csp)
  res.writeHead(404, csp).end()
}
// `localhost` may resolve to either loopback address.
createServer(editor).listen(editorPort, '127.0.0.1')
createServer(editor).listen(editorPort, '::1')

console.log(`host http://127.0.0.1:${hostPort}/  editor http://localhost:${editorPort}/__oa/slides/`)
