export interface MergedPreview<P, S> {
  preview: P
  service: S | null
}

export interface MergedPreviews<P, S> {
  items: MergedPreview<P, S>[]
  backgroundServices: S[]
}

/**
 * Merges open previews with their bound live services into a single user-facing list, leaving only orphan
 * background services (not bound to any open preview) separate.
 */
export function mergePreviewsAndServices<P extends { serviceId: string | null }, S extends { id: string }>(
  allPreviews: readonly P[],
  services: readonly S[],
): MergedPreviews<P, S> {
  const byId = new Map(services.map((s) => [s.id, s]))
  const bound = new Set<string>()
  for (const p of allPreviews) if (p.serviceId) bound.add(p.serviceId)
  return {
    items: allPreviews.map((preview) => ({
      preview,
      service: preview.serviceId ? (byId.get(preview.serviceId) ?? null) : null,
    })),
    backgroundServices: services.filter((s) => !bound.has(s.id)),
  }
}

export interface PreviewTechInfo {
  port: number | null
  path: string | null
  serviceName: string | null
  command: string | null
}

/** Whether a preview's bound background service can be paused while keeping the preview card. */
export const canPausePreview = (preview: { status: string }, service: unknown | null) =>
  Boolean(service && preview.status === 'online')

/** Whether closing a preview should also stop its bound service (`offline` previews only close the record). */
export const shouldStopServiceOnClose = (preview: { status: string; serviceId: string | null }) =>
  preview.status !== 'offline' && Boolean(preview.serviceId)

/** Whether a background service is active and can be stopped. */
export const canStopService = (service: { status: string }) =>
  service.status === 'running' || service.status === 'starting'

/** Extracts underlying technical metadata hidden behind the row's "查看技术详情" toggle. */
export function previewTechInfo(
  preview: { port: number | null; path: string; serviceName: string | null },
  service: { name: string; port: number | null; command: string } | null,
): PreviewTechInfo | null {
  const port = preview.port ?? service?.port ?? null
  const path = preview.path && preview.path !== '/' ? preview.path : null
  const serviceName = service?.name ?? preview.serviceName ?? null
  const command = service?.command ?? null
  if (port === null && !path && !serviceName && !command) return null
  return { port, path, serviceName, command }
}
