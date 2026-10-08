import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { arch, platform } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { AccessToken } from 'livekit-server-sdk'

/** Where clients and this server reach LiveKit (plan P12, B1); `url` null = this server's `/livekit` (hosted). */
export interface LiveKitEndpoint {
  url: string | null
  /** Its HTTP API (RoomService). */
  api: string
  key: string
  secret: string
}

export interface LiveKit {
  /** Starts a hosted server on first use; rejects with the reason it cannot run. */
  endpoint(): Promise<LiveKitEndpoint>
  /** Loopback signaling port of the running hosted server, behind `/livekit`; null otherwise. */
  readonly signalPort: number | null
  close(): Promise<void>
}

/** `LIVEKIT_URL/API_KEY/API_SECRET` point to an external LiveKit; otherwise the server hosts its own. */
export function liveKitFromEnv(env: NodeJS.ProcessEnv, dir: string): LiveKit {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = env
  if (url || key || secret) {
    if (!url || !key || !secret)
      throw new Error('LIVEKIT_URL、LIVEKIT_API_KEY、LIVEKIT_API_SECRET 需要同时设置')
    const ep = { url, api: url.replace(/^ws/, 'http'), key, secret }
    return { endpoint: async () => ep, signalPort: null, close: async () => {} }
  }
  return new HostedLiveKit({
    dir,
    bin: env.GONGGONG_LIVEKIT_BIN,
    udpPort: Number(env.GONGGONG_LIVEKIT_UDP_PORT ?? 7882),
    tcpPort: Number(env.GONGGONG_LIVEKIT_TCP_PORT ?? 7881),
    nodeIp: env.GONGGONG_LIVEKIT_NODE_IP,
  })
}

const VERSION = '1.13.7'
/** Official release archives (no macOS build: `brew install livekit` there), from the release's checksums.txt. */
const RELEASES: Record<string, { file: string; sha256: string }> = {
  'linux-x64': {
    file: `livekit_${VERSION}_linux_amd64.tar.gz`,
    sha256: '6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2',
  },
  'linux-arm64': {
    file: `livekit_${VERSION}_linux_arm64.tar.gz`,
    sha256: '5d167fdf52cf43c0c72972f25325364479f41f854bfef651056eab2504da5de9',
  },
  'win32-x64': {
    file: `livekit_${VERSION}_windows_amd64.zip`,
    sha256: 'e539e7d2f75807b9c9202cd2a0bf2cb3d52fc4c52978a6953e0f47bc339fe77f',
  },
  'win32-arm64': {
    file: `livekit_${VERSION}_windows_arm64.zip`,
    sha256: '8379c89b9973dc52577710b293f6190644bd6fad0c415df4279a24ea54df2363',
  },
}
const READY_MS = 15_000
const MAX_BACKOFF_MS = 30_000

interface HostedOptions {
  /** Data directory: the downloaded binary (`bin/`) and the running server's pid. */
  dir: string
  /** GONGGONG_LIVEKIT_BIN: a livekit-server to run instead of looking for one. */
  bin?: string
  /** Media ports that must be reachable by browsers and daemons: one UDP port, and TCP for networks without UDP. */
  udpPort: number
  tcpPort: number
  /** The address advertised to clients when the machine's own interfaces are not what they reach. */
  nodeIp?: string
}

/**
 * livekit-server as a supervised child (plan B1): single node, signaling on a loopback port proxied at `/livekit`,
 * keys generated per server process (tokens are short-lived). Restarted after a crash; one left behind by a killed
 * server is ended first, as it would hold the media ports.
 */
export class HostedLiveKit implements LiveKit {
  private readonly key = `gg${randomBytes(6).toString('hex')}`
  private readonly secret = randomBytes(32).toString('base64url')
  private port: number | null = null
  private child: ChildProcess | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private closed = false
  private backoff = 1000

  constructor(private readonly opts: HostedOptions) {}

  get signalPort() {
    return this.ready ? this.port : null
  }

  async endpoint(): Promise<LiveKitEndpoint> {
    if (!this.ready) {
      this.starting ??= this.start().finally(() => {
        this.starting = null
      })
      await this.starting
    }
    return { url: null, api: `http://127.0.0.1:${this.port}`, key: this.key, secret: this.secret }
  }

  private get pidFile() {
    return join(this.opts.dir, 'livekit.pid')
  }

  private async start() {
    if (this.closed) throw new Error('LiveKit 已停止')
    const bin = await this.binary()
    const left = Number(await readFile(this.pidFile, 'utf8').catch(() => ''))
    if (left) {
      try {
        process.kill(left, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    this.port ??= await freePort()
    const child = spawn(bin, [], {
      env: { ...process.env, LIVEKIT_CONFIG: JSON.stringify(this.config()) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tail: string[] = []
    for (const out of [child.stdout, child.stderr])
      out.setEncoding('utf8').on('data', (s: string) => {
        tail.push(...s.split('\n').filter(Boolean))
        tail.splice(0, Math.max(0, tail.length - 20))
      })
    this.child = child
    // Listen before any await: a binary that fails at once may exit while the pid file is written.
    const exited = new Promise<never>((_, reject) =>
      child.once('exit', (code) =>
        reject(new Error(`livekit-server 退出（${code ?? 'signal'}）：${tail.join('\n')}`)),
      ),
    )
    exited.catch(() => {})
    child.once('exit', () => void this.onExit(child))
    await mkdir(this.opts.dir, { recursive: true })
    await writeFile(this.pidFile, String(child.pid))
    await Promise.race([waitHealthy(this.port), exited])
    this.ready = true
    this.backoff = 1000
  }

  private config() {
    const { udpPort, tcpPort, nodeIp } = this.opts
    return {
      port: this.port,
      bind_addresses: ['127.0.0.1'],
      rtc: {
        udp_port: udpPort,
        tcp_port: tcpPort,
        use_external_ip: false,
        ...(nodeIp ? { node_ip: nodeIp } : {}),
      },
      keys: { [this.key]: this.secret },
      logging: { level: 'warn' },
    }
  }

  private async onExit(child: ChildProcess) {
    if (this.child !== child) return
    const wasReady = this.ready
    this.child = null
    this.ready = false
    await rm(this.pidFile, { force: true })
    if (this.closed || !wasReady) return
    console.error(`livekit-server exited; restarting in ${this.backoff} ms`)
    setTimeout(
      () => void this.endpoint().catch((err) => console.error('livekit-server:', err)),
      this.backoff,
    ).unref()
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
  }

  /** GONGGONG_LIVEKIT_BIN, then one downloaded before, then one on PATH (brew), then the official release. */
  private async binary() {
    if (this.opts.bin) return this.opts.bin
    const exe = platform() === 'win32' ? 'livekit-server.exe' : 'livekit-server'
    const own = join(this.opts.dir, 'bin', exe)
    if (existsSync(own)) return own
    const onPath = (process.env.PATH ?? '')
      .split(delimiter)
      .map((d) => join(d, exe))
      .find(existsSync)
    if (onPath) return onPath
    const release = RELEASES[`${platform()}-${arch()}`]
    if (!release)
      throw new Error(
        '本机没有 livekit-server，也没有对应的官方发布包：macOS 请执行 brew install livekit，或用 GONGGONG_LIVEKIT_BIN 指定程序',
      )
    const url = `https://github.com/livekit/livekit/releases/download/v${VERSION}/${release.file}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`下载 livekit-server 失败（${res.status}）：${url}`)
    const archive = Buffer.from(await res.arrayBuffer())
    if (createHash('sha256').update(archive).digest('hex') !== release.sha256)
      throw new Error(`livekit-server 校验失败：${url}`)
    const dir = join(this.opts.dir, 'bin')
    await mkdir(dir, { recursive: true })
    const file = join(dir, release.file)
    await writeFile(file, archive)
    // bsdtar on Windows reads the zip as well.
    await promisify(execFile)('tar', ['-xf', file, '-C', dir, exe])
    await rm(file)
    await chmod(own, 0o755)
    return own
  }

  async close() {
    this.closed = true
    const child = this.child
    if (!child) return
    // An already exited child never emits 'exit' again.
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((r) => child.once('exit', r))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await gone
      clearTimeout(timer)
    }
    await rm(this.pidFile, { force: true })
  }
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

async function waitHealthy(port: number) {
  const until = Date.now() + READY_MS
  while (Date.now() < until) {
    const ok = await fetch(`http://127.0.0.1:${port}/`).then(
      (r) => r.ok,
      () => false,
    )
    if (ok) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`livekit-server 在 ${READY_MS / 1000} 秒内没有就绪`)
}

const TTL = '10m'

/**
 * Per-preview tokens, room = preview id (plan P12): the machine's gg-cast publishes the window; viewers subscribe;
 * the one viewer granted control may also send input on the data channel. Only the join needs a valid token:
 * LiveKit refreshes it for a connected participant.
 */
export const liveTokens = {
  publisher: (ep: LiveKitEndpoint, room: string) =>
    sign(
      ep,
      { identity: 'cast', ttl: TTL },
      { canPublish: true, canSubscribe: false, canPublishData: false },
      room,
    ),
  viewer: (ep: LiveKitEndpoint, room: string, who: { identity: string; name: string; control: boolean }) =>
    sign(
      ep,
      { identity: who.identity, name: who.name, ttl: TTL },
      { canPublish: false, canSubscribe: true, canPublishData: who.control },
      room,
    ),
}

function sign(
  ep: LiveKitEndpoint,
  options: { identity: string; name?: string; ttl: string },
  grants: { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean },
  room: string,
) {
  const token = new AccessToken(ep.key, ep.secret, options)
  token.addGrant({ roomJoin: true, room, ...grants })
  return token.toJwt()
}
