import { type CSSProperties, type ReactNode, useRef, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { Button, type Glyph, renderGlyph } from './controls'
import { ProgressIndicator } from './display'
import { FileIcon } from './file-icon'
import { Icon } from './icon'
import './form.css'
import './dropzone.css'

export interface DropFile {
  name: string
  size?: string
  /** 0–100; 100 reads 「已上传」. */
  progress?: number
  error?: ReactNode
}

export interface DropZoneProps {
  onFiles?: (files: File[]) => void
  accept?: string
  multiple?: boolean
  title?: ReactNode
  overTitle?: ReactNode
  description?: ReactNode
  buttonLabel?: ReactNode
  icon?: Glyph
  files?: DropFile[]
  onRemove?: (index: number, file: DropFile) => void
  /** Horizontal layout for forms. */
  compact?: boolean
  disabled?: boolean
  defaultDragging?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** Drop target that always keeps a 「选择文件…」 button, with a per-file status list below. */
export function DropZone({
  onFiles,
  accept,
  multiple,
  title = t('将文件拖到这里'),
  overTitle = t('松开以添加'),
  description,
  buttonLabel = t('选择文件…'),
  icon = 'upload',
  files = [],
  onRemove,
  compact,
  disabled,
  defaultDragging = false,
  className,
  style,
  ...aria
}: DropZoneProps) {
  const [over, setOver] = useState(defaultDragging)
  const input = useRef<HTMLInputElement>(null)
  // dragenter/dragleave also fire for children; count them so hovering the button doesn't flicker.
  const depth = useRef(0)
  const take = (list: FileList | null | undefined) => {
    const arr = [...(list ?? [])]
    const picked = multiple ? arr : arr.slice(0, 1)
    if (picked.length) onFiles?.(picked)
  }
  return (
    <div className={cx('ui-dropwrap', className)} style={style}>
      {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> would need a legend; the drop area is named by aria-label */}
      <div
        role="group"
        aria-label={aria['aria-label'] ?? t('上传文件')}
        className={cx(
          'ui-drop',
          over && 'ui-drop--over',
          compact && 'ui-drop--compact',
          disabled && 'ui-disabled',
        )}
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current++
          setOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (!depth.current) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          depth.current = 0
          setOver(false)
          take(e.dataTransfer?.files)
        }}
      >
        <span className="ui-drop__icon" aria-hidden>
          {renderGlyph(icon)}
        </span>
        <div className="ui-drop__text">
          <div className="ui-drop__title">{over ? overTitle : title}</div>
          {description ? <div className="ui-drop__desc">{description}</div> : null}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            take(e.target.files)
            e.target.value = ''
          }}
        />
        <Button
          size={compact ? 'small' : 'regular'}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {buttonLabel}
        </Button>
      </div>
      {files.length ? (
        <ul className="ui-drop__list">
          {files.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; position identifies the upload
            <li key={`${f.name}-${i}`} className="ui-drop__file">
              <FileIcon name={f.name} />
              <div className="ui-drop__fbody">
                <div className="ui-drop__fname">{f.name}</div>
                {f.error ? (
                  <div className="ui-field__hint ui-field__hint--error">
                    <Icon name="warning" size={12} className="ui-field__hint-icon" />
                    {f.error}
                  </div>
                ) : f.progress != null && f.progress < 100 ? (
                  <ProgressIndicator
                    value={f.progress}
                    aria-label={t('{name} 上传进度', { name: f.name })}
                    style={{ width: '100%', height: 4 }}
                  />
                ) : (
                  <div className="ui-drop__fmeta">
                    {[f.size, f.progress === 100 ? t('已上传') : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              {onRemove ? (
                <button
                  type="button"
                  className="ui-inputwrap__btn"
                  aria-label={t('移除 {name}', { name: f.name })}
                  onClick={() => onRemove(i, f)}
                >
                  <Icon name="xmark" weight={2} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
