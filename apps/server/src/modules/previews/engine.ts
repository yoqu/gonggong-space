import type { DaemonToServer } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import { publishPreviews } from './service.js'
import { recordService, syncPreviews } from './services.js'

export function startPreviewEngine(ctx: Ctx) {
  // In order: a service's starting → running must not be applied backwards.
  let chain = Promise.resolve()
  const onMessage = (machineId: string, msg: DaemonToServer) => {
    if (msg.t === 'service.state')
      chain = chain
        .then(() => recordService(ctx, machineId, msg.service))
        .then(() => publishPreviews(ctx, msg.service.groupId))
        .catch((err) => console.error('service.state:', err))
  }
  const onOnline = (machineId: string) => {
    chain = chain
      .then(() => syncPreviews(ctx, machineId, { onConnect: true }))
      .catch((err) => console.error('previews.sync:', err))
  }
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    await chain
  }
}
