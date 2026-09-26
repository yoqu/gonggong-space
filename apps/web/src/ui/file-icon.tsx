export type FileType =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'archive'
  | 'audio'
  | 'image'
  | 'video'
  | 'md'
  | 'code'
  | 'text'
  | 'other'

const CODE_EXT =
  /^(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|kt|swift|rb|php|c|h|cc|cpp|cs|sh|sql|json|ya?ml|toml|css|scss|html|xml|vue)$/

const BY_EXT: [FileType, RegExp][] = [
  ['pdf', /^pdf$/],
  ['word', /^(docx?|rtf|odt|pages)$/],
  ['excel', /^(xlsx?|csv|tsv|ods|numbers)$/],
  ['ppt', /^(pptx?|odp|key)$/],
  ['archive', /^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/],
  ['md', /^(md|markdown)$/],
  ['code', CODE_EXT],
  ['text', /^(txt|log)$/],
  ['image', /^(png|jpe?g|gif|webp|bmp|svg|heic|avif|ico)$/],
  ['video', /^(mp4|mov|webm|mkv|avi|m4v)$/],
  ['audio', /^(mp3|wav|m4a|aac|flac|ogg|opus)$/],
]

/** Icon type by extension first, then mime (extensionless uploads). */
export function fileType(name: string, mime = ''): FileType {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const hit = BY_EXT.find(([, re]) => re.test(ext))
  if (hit) return hit[0]
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/markdown') return 'md'
  for (const t of ['image', 'video', 'audio', 'text'] as const) if (mime.startsWith(`${t}/`)) return t
  return 'other'
}

const GLYPH = {
  code: ['stroke', 'M13.5 15.5 10 19.5l3.5 4M18.5 15.5l3.5 4-3.5 4'],
  image: ['fill', 'M9.5 25l4.5-6 3 3.5 2.5-2.5 3 5zM20 13.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 1 1 0-3.6z'],
  video: ['fill', 'M13 15v9l7.5-4.5z'],
  audio: ['fill', 'M19 13v7.6a2.6 2.6 0 1 1-1.6-2.4V13zM19 13l3.5 1.2v2.2L19 15.2z'],
  other: ['stroke', 'M11 17h10M11 20.5h10M11 24h6'],
} as const

/** [--system-* colour, short label]; types without a label draw a glyph. */
const LOOK: Record<FileType, [string, string?]> = {
  pdf: ['red', 'PDF'],
  word: ['blue', 'W'],
  excel: ['green', 'X'],
  ppt: ['orange', 'P'],
  archive: ['brown', 'ZIP'],
  md: ['indigo', 'MD'],
  text: ['gray', 'TXT'],
  code: ['teal'],
  image: ['cyan'],
  video: ['purple'],
  audio: ['pink'],
  other: ['gray'],
}

// Presentation attributes can't read custom properties; styles can.
const ON = { fill: 'var(--on-accent)' }

export interface FileIconProps {
  name: string
  mime?: string
  size?: number
  className?: string
}

/** Tinted document with a folded corner; labels drop out below 20px where they'd be unreadable. */
export function FileIcon({ name, mime, size = 32, className }: FileIconProps) {
  const type = fileType(name, mime)
  const [color, label] = LOOK[type]
  const glyph = label ? null : GLYPH[type as keyof typeof GLYPH]
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      data-type={type}
      className={className}
      style={{ color: `var(--system-${color})`, flex: 'none' }}
    >
      <path
        fill="currentColor"
        d="M8.5 2H19l7 7v18.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 27.5v-23A2.5 2.5 0 0 1 8.5 2z"
      />
      <path style={ON} fillOpacity={0.45} d="M19 2l7 7h-4.5A2.5 2.5 0 0 1 19 6.5z" />
      {glyph ? (
        <path
          d={glyph[1]}
          style={glyph[0] === 'fill' ? ON : { fill: 'none', stroke: 'var(--on-accent)' }}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {label && size >= 20 ? (
        <text
          x="16"
          y="24"
          textAnchor="middle"
          style={{ ...ON, fontFamily: 'var(--font-sans)' }}
          fontWeight={700}
          fontSize={[0, 11, 8.5, 7][label.length]}
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}
