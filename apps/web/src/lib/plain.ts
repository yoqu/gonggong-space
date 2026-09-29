/** A one-line markdown preview as plain text: headings, quotes, list markers, emphasis, code ticks and link syntax go. */
export const plainText = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|：)\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/g, '$1')
    .replace(/`+|\*\*|__|~~/g, '')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])/g, '$1$2')
