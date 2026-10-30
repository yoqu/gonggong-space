---
version: alpha
name: 霓虹夜（深色荧光）
description: 深墨蓝底、荧光青与洋红点缀的深色设计系统，适合音乐、游戏、潮流活动、夜间与创作者类产品。尺寸以 375 宽设计稿 px 表示。
colors:
  primary: "#3DF5C8"
  on-primary: "#06121A"
  secondary: "#FF4FD8"
  on-secondary: "#1A0616"
  tertiary: "#7C5CFF"
  on-tertiary: "#FFFFFF"
  background: "#0B0D17"
  surface: "#151827"
  surface-high: "#1E2236"
  surface-variant: "#262B44"
  on-surface: "#F2F4FF"
  on-surface-variant: "#A3A9C7"
  on-surface-muted: "#6E7494"
  outline: "#2A2F4A"
  outline-glow: "rgba(61, 245, 200, 0.45)"
  success: "#3DF5C8"
  warning: "#FFC24D"
  error: "#FF5C7A"
  scrim: "rgba(5, 6, 12, 0.7)"
typography:
  display:
    fontFamily: PingFang SC
    fontSize: 32px
    fontWeight: 800
    lineHeight: 38px
  headline:
    fontFamily: PingFang SC
    fontSize: 22px
    fontWeight: 700
    lineHeight: 28px
  title:
    fontFamily: PingFang SC
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
  label:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  caption:
    fontFamily: PingFang SC
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
rounded:
  sm: 6px
  md: 12px
  lg: 20px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 36px
  page: 16px
components:
  page:
    backgroundColor: "{colors.background}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 14px
  card-raised:
    backgroundColor: "{colors.surface-high}"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 46px
  button-secondary:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    height: 46px
  badge-hot:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  cover:
    rounded: "{rounded.md}"
---

## Overview

**夜晚城市里的一束荧光。** 深墨蓝底与层层递进的深色卡片构成安静的背景，荧光青（primary）是唯一的行动色，洋红（secondary）只用于热度角标和直播、限时等状态，电紫（tertiary）用于渐变封面与插画。封面图和海报颜色饱满，UI 退到暗处衬托内容。

适合：音乐与播客、游戏、演出票务、潮流活动、夜间模式、创作者社区。

关键词：深色、荧光、发光描边、饱满封面、强对比文字。

## Colors

- **Primary · 荧光青 (#3DF5C8)：** 主按钮、播放键、选中态、进度条；上面的文字用 on-primary 深色。
- **Secondary · 洋红 (#FF4FD8)：** 热门、直播、限时角标，单屏不超过两处。
- **Tertiary · 电紫 (#7C5CFF)：** 封面渐变（tertiary → secondary）、插画、图表第二序列。
- **Background (#0B0D17) → surface (#151827) → surface-high (#1E2236) → surface-variant (#262B44)：** 四级深色，越靠前越亮。
- **On-surface (#F2F4FF) → variant (#A3A9C7) → muted (#6E7494)：** 正文、次要、辅助信息；不要用纯白。
- **Outline (#2A2F4A) / outline-glow：** 卡片描边与选中卡片的发光外框。

## Typography

无衬线 **PingFang SC**，标题粗字重、紧行距，正文 14px。

| Token | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| display | 32 / 800 / 38 | 首屏主视觉标题 |
| headline | 22 / 700 / 28 | 模块标题 |
| title | 16 / 600 / 22 | 卡片标题、歌曲名 |
| body | 14 / 400 / 21 | 正文、简介 |
| label | 13 / 600 / 18 | 按钮、Tab |
| caption | 11 / 500 / 16 | 角标、时长、播放量 |

## Layout

- 页面边距 16px，模块之间 36px，模块标题右侧放「全部」文字链接。
- 横滑封面列表露出下一张的边缘；封面 1:1（音乐）或 3:4（演出）。
- 底部迷你播放条 / 操作条吸底，surface-high 底色加顶部 1px outline。

## Elevation & Depth

深色界面靠亮度递进分层：越上层越亮（surface → surface-high → surface-variant）。选中或聚焦用 `0 0 0 1px var(--color-outline-glow)` 加 `0 0 16px` 同色外发光，不用黑色阴影。

## Shapes

卡片与封面 12px 圆角，弹层 20px，角标 6px，按钮与头像全圆。图标 1.75px 线性，选中时改为实心荧光青。

## Components

**卡片（card）**：surface 底、12px 圆角、14px 内边距，无描边；可点击的卡片按下时变 surface-high。

**主按钮（button-primary）**：荧光青全圆角胶囊、深色文字、高 46px；次按钮 surface-variant 底白字。

**热度角标（badge-hot）**：洋红底、深色字、6px 圆角，叠在封面左上角。

**封面（cover）**：12px 圆角，没有图片时用 tertiary → secondary 的 135° 渐变占位并写标题首字。

## Do's and Don'ts

**Do**

- 保持深色背景，让封面和荧光色成为焦点。
- 荧光青只用于行动和选中，洋红只用于状态角标。
- 正文对比度足够：on-surface 用于正文，variant 只用于次要信息。

**Don't**

- 不要大面积铺荧光色或做彩虹渐变背景。
- 不要使用纯黑 #000 底或纯白 #FFF 字。
- 不要用黑色投影表现层级。
