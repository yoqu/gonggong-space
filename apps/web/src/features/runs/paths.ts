const CANDIDATE = /(?<![\w/.@-])(?:\.{1,2}\/|\/)?\.?[\w-]+(?:\/\.?[\w-]+|\.[\w-]+)*/g
/** Last segment has a file extension (`a.ts`) or is a dotfile (`.env`); `origin/main` is a ref, not a file. */
const FILE = /(?:^|\/)(?:[\w-]+\.[A-Za-z][A-Za-z0-9]{0,7}|\.[\w-]+(?:\.[\w-]+)*)$/

/** File paths mentioned in a reply (spec §8.10), outside code blocks and URLs. */
export function filePaths(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
  const found = (text.match(CANDIDATE) ?? []).filter((p) => FILE.test(p))
  return [...new Set(found)]
}
