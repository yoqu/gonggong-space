const CANDIDATE = /(?<![\w/.@-])(?:\.{1,2}\/|\/)?[\w-]+(?:[./][\w-]+)*/g
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/

/** File paths mentioned in a reply (spec §8.10): tokens with a `/` or a file extension, outside code blocks and URLs. */
export function filePaths(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
  const found = (text.match(CANDIDATE) ?? []).filter((p) => p.includes('/') || EXTENSION.test(p))
  return [...new Set(found)]
}
