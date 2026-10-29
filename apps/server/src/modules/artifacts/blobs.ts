import { join } from 'node:path'
import { ARTIFACT_FILE_MAX_BYTES } from '@gonggong/protocol'
import { blobStore } from '../../lib/blob-store.js'
import { dataDir } from '../attachments/service.js'

/**
 * Artifact contents, apart from force sync's store: its sweeps delete whole group directories. Versions and
 * thumbnails keep every blob they reference for good (nothing is collected until artifacts can be deleted).
 */
export const artifactQuota = { bytes: 5 * 1024 ** 3 }
export const artifactBlobs = blobStore({
  root: () => join(dataDir(), 'artifacts'),
  quota: artifactQuota,
  maxFileBytes: ARTIFACT_FILE_MAX_BYTES,
})

export async function readBlob(groupId: string, hash: string) {
  const chunks: Buffer[] = []
  for await (const c of await artifactBlobs.open(groupId, hash)) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
