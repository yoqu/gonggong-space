import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Toolbar } from './toolbar'
import './window.css'

export interface AppFrameProps {
  /** App navigation column (`NavRail`). */
  rail?: ReactNode
  /** Flush sidebar (`Sidebar`, `ConversationList`). */
  sidebar?: ReactNode
  /** Unified toolbar above the content (`Toolbar`, `ChatHeader`). */
  toolbar?: ReactNode
  /** Right panel docked flush after a separator (`ChatInfoPanel`, `ThreadPanel`). */
  inspector?: ReactNode
  children?: ReactNode
  contentStyle?: CSSProperties
  className?: string
  style?: CSSProperties
}

function Frame({
  lights,
  rail,
  sidebar,
  toolbar,
  inspector,
  children,
  contentStyle,
  className,
  style,
  ...rest
}: AppFrameProps & { lights?: ReactNode; role?: string; 'aria-label'?: string }) {
  return (
    <div className={cx('ui-frame', className)} style={style} {...rest}>
      {rail ? (
        <div className="ui-frame__rail">
          {lights ? <div className="ui-frame__lights ui-frame__lights--rail">{lights}</div> : null}
          {rail}
        </div>
      ) : null}
      {sidebar ? (
        <div className={cx('ui-frame__sidebar', !!rail && !!lights && 'ui-frame__sidebar--rail')}>
          {lights && !rail ? <div className="ui-frame__lights">{lights}</div> : null}
          {sidebar}
        </div>
      ) : null}
      <div className="ui-frame__main">
        {lights && !rail && !sidebar ? (
          <div className="ui-frame__chrome">
            <div className="ui-frame__lights">{lights}</div>
            <div className="ui-frame__grow">{toolbar}</div>
          </div>
        ) : (
          toolbar
        )}
        <div className="ui-frame__content" style={contentStyle}>
          {children}
        </div>
      </div>
      {inspector ? <aside className="ui-frame__inspector">{inspector}</aside> : null}
    </div>
  )
}

/**
 * Frameless Pane window layout for pages (D6: the viewport is the window): rail, sidebar, toolbar + content and an
 * inspector, all flush and split by hairlines. It is the positioning context for a `Sheet`.
 */
export function AppFrame(props: AppFrameProps) {
  return <Frame {...props} />
}

/** Pane traffic lights — only for gallery windows; the web app never draws a fake window frame (D6). */
export function TrafficLights({ inactive }: { inactive?: boolean }) {
  return (
    <div className={cx('ui-lights', inactive && 'ui-lights--inactive')} aria-hidden="true">
      <i data-light="close" />
      <i data-light="minimize" />
      <i data-light="zoom" />
    </div>
  )
}

export interface WindowProps extends AppFrameProps {
  title?: string
  /** Gray lights and the weaker inactive shadow. */
  inactive?: boolean
  width?: number | string
  height?: number | string
}

/** Pane Window for gallery demos: an AppFrame with traffic lights, window corners and shadow. */
export function Window({ title, inactive, width, height, toolbar, style, className, ...props }: WindowProps) {
  return (
    <Frame
      {...props}
      role="group"
      aria-label={title}
      lights={<TrafficLights inactive={inactive} />}
      toolbar={toolbar ?? <Toolbar title={title} scrolled={false} />}
      className={cx('ui-window', inactive && 'ui-window--inactive', className)}
      style={{ width, height, ...style }}
    />
  )
}
