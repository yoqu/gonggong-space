---
version: alpha
name: 冰川（冷蓝玻璃）
description: 冷灰蓝底、半透明玻璃卡片与清透蓝色强调的轻盈设计系统，适合工具、健康、出行与数据类产品。尺寸以 375 宽设计稿 px 表示。
colors:
  primary: "#2F6FED"
  on-primary: "#FFFFFF"
  primary-container: "#DCE7FD"
  on-primary-container: "#123A8C"
  secondary: "#4FA3C7"
  on-secondary: "#FFFFFF"
  tertiary: "#8B7FE8"
  on-tertiary: "#FFFFFF"
  background: "#EEF4F8"
  surface: "rgba(255, 255, 255, 0.72)"
  surface-solid: "#FFFFFF"
  surface-variant: "#E3EBF2"
  on-surface: "#14202B"
  on-surface-variant: "#5B6B7A"
  on-surface-muted: "#8796A5"
  outline: "rgba(20, 32, 43, 0.10)"
  outline-strong: "#C5D2DE"
  success: "#1F9D74"
  warning: "#E0A030"
  error: "#E5484D"
  scrim: "rgba(20, 32, 43, 0.4)"
typography:
  display:
    fontFamily: PingFang SC
    fontSize: 30px
    fontWeight: 600
    lineHeight: 38px
  headline:
    fontFamily: PingFang SC
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
  title:
    fontFamily: PingFang SC
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  label:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  caption:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  metric:
    fontFamily: PingFang SC
    fontSize: 32px
    fontWeight: 600
    lineHeight: 38px
rounded:
  sm: 10px
  md: 16px
  lg: 24px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  page: 16px
components:
  page:
    backgroundColor: "{colors.background}"
  glass-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
  metric-card:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.on-surface}"
    typography: "{typography.metric}"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    rounded: "{rounded.full}"
    height: 48px
  input:
    backgroundColor: "{colors.surface-variant}"
    rounded: "{rounded.sm}"
    height: 48px
  tab-bar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
---

## Overview

**清晨冰面般的通透感。** 冷灰蓝的页面底上漂浮着半透明白色玻璃卡片（背景模糊），信息分组清楚、边界柔和；强调色是干净的蓝，青色与淡紫只用于数据图表和状态。整体轻、静、可信赖。

适合：效率工具、健康与运动记录、出行、天气、金融与数据看板。

关键词：冷调、玻璃、柔和圆角、轻阴影、数据清晰。

## Colors

- **Primary · 冰蓝 (#2F6FED)：** 主按钮、选中态、进度与图表主序列。
- **Primary container (#DCE7FD)：** 次按钮、选中标签、提示条底色。
- **Secondary · 湖青 (#4FA3C7) / Tertiary · 淡紫 (#8B7FE8)：** 图表第二、三序列和分类标识。
- **Background (#EEF4F8)：** 页面底，可在顶部叠一层由 primary-container 到 background 的纵向渐变（用 color-mix 在令牌间过渡）。
- **Surface (72% 白)：** 玻璃卡片，配合 `backdrop-filter: blur(16px)`；不支持模糊时用 surface-solid。
- **On-surface (#14202B) → variant (#5B6B7A) → muted (#8796A5)：** 冷调灰阶。
- **Outline (10% 墨蓝)：** 玻璃卡片的 1px 描边，让卡片在浅底上有边界。

## Typography

无衬线 **PingFang SC**，字重以 400 / 600 为主，数字用 metric 大字号。

| Token | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| display | 30 / 600 / 38 | 首屏问候、主标题 |
| headline | 22 / 600 / 30 | 页面标题 |
| title | 16 / 600 / 22 | 卡片标题 |
| body | 15 / 400 / 22 | 正文 |
| label | 13 / 500 / 18 | 按钮、Tab、表单标签 |
| caption | 12 / 400 / 16 | 单位、时间、说明 |
| metric | 32 / 600 / 38 | 关键数据 |

## Layout

- 页面边距 16px，卡片间距 12px，模块之间 24–32px。
- 首页常用「问候 + 关键数据卡 + 两列快捷入口 + 列表」结构。
- 底部 TabBar 悬浮在内容上方，左右各留 16px，圆角 24px 的玻璃条。

## Elevation & Depth

- **Level 1：** 玻璃卡片，1px outline + `0 4px 16px` 的 6% 墨蓝阴影。
- **Level 2：** 悬浮 TabBar、浮动按钮，`0 8px 24px` 的 10% 墨蓝阴影。
- **Level 3：** 底部弹层与对话框，scrim 遮罩 + 实心 surface-solid。

## Shapes

柔和圆角：输入框 10px、卡片 16px、悬浮栏与大弹层 24px、按钮与标签全圆角。图标为 1.5px 线性圆角端点。

## Components

**玻璃卡片（glass-card）**：72% 白 + 背景模糊 + 1px outline，16px 圆角与内边距。

**数据卡（metric-card）**：实心白底，上方 caption 写指标名，中间 metric 大数字，下方小号趋势（success / error 色箭头）。

**主按钮（button-primary）**：冰蓝全圆角胶囊，高 48px；次按钮为 primary-container 底。

**输入框（input）**：surface-variant 底、10px 圆角、无描边，聚焦时 2px primary 描边。

## Do's and Don'ts

**Do**

- 用半透明卡片和轻阴影分层，保持界面通透。
- 数据用大号数字配小号单位，图表最多三种序列色。
- 留足卡片间距，让背景透出来。

**Don't**

- 不要使用暖色大面积底色或高饱和红橙做装饰。
- 不要叠加多层模糊卡片（最多两层）。
- 不要用纯黑文字或粗黑描边。
