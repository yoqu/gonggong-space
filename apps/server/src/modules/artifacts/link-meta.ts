import type { ArtifactLinkMetaRes } from '@gonggong/protocol'
import { linkMeta } from '../group-tabs/link-meta.js'

const TITLE_MAX = 120
const FEISHU = /(?:^|\.)(?:feishu\.cn|feishu\.net|larksuite\.com|larkoffice\.com|larksuite\.cn)$/i

/** Feishu / Lark docs: the member's browser frames them with its own Feishu login; the server would only see a login page. */
export const isFeishuDoc = (url: URL) => FEISHU.test(url.hostname)

/** POST /api/artifacts/:id/link-meta. Fetched with the group-tab link guard (public addresses only, every redirect checked). */
export async function artifactLinkMeta(
  url: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<ArtifactLinkMetaRes> {
  if (isFeishuDoc(new URL(url))) return { title: null, embeddable: true }
  const meta = await linkMeta(url, opts)
  return { title: meta.title?.slice(0, TITLE_MAX).trim() || null, embeddable: meta.embeddable }
}
