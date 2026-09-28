/**
 * Where previews are served (plan P4/P5). Domain mode: `<slug>.<domain>` on the main listener (wildcard DNS and
 * certificate; use a registrable domain of its own). Port mode (no domain): one listener per open preview on a port
 * from `ports`, next to the main one. `publicUrl`: the main site as browsers reach it, for sending strangers there.
 */
export interface PreviewConfig {
  domain: string | null
  ports: [number, number]
  publicUrl: string | null
  /** Interface the port-mode listeners bind: GONGGONG_PREVIEW_HOST, else the main server's HOST. On a LAN where the
   * main server stays on loopback behind the web port, set it to 0.0.0.0 so members reach the preview ports. */
  listenHost?: string
}

export function previewConfig(env: NodeJS.ProcessEnv = process.env): PreviewConfig {
  const [lo = 41000, hi = lo] = (env.GONGGONG_PREVIEW_PORTS ?? '41000-41099').split('-').map(Number)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi)
    throw new Error('GONGGONG_PREVIEW_PORTS must look like 41000-41099')
  return {
    domain: env.GONGGONG_PREVIEW_DOMAIN?.replace(/^\.+/, '') || null,
    ports: [lo, hi],
    publicUrl: env.GONGGONG_PUBLIC_URL?.replace(/\/+$/, '') || null,
    listenHost: env.GONGGONG_PREVIEW_HOST ?? env.HOST ?? '127.0.0.1',
  }
}
