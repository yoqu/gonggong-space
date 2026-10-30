---
version: alpha
name: 暖纸（阅读与内容）
description: 米色纸感底、衬线标题、赭石点睛的阅读型设计系统，适合资讯、读书、知识与生活方式内容。尺寸以 375 宽设计稿 px 表示。
colors:
  primary: "#8A4B2A"
  on-primary: "#FFFDF8"
  primary-container: "#F1E0D2"
  on-primary-container: "#5A2E17"
  secondary: "#5E6B3A"
  on-secondary: "#FFFDF8"
  tertiary: "#B7832F"
  on-tertiary: "#FFFDF8"
  background: "#F7F1E6"
  surface: "#FFFDF8"
  surface-variant: "#EFE6D6"
  on-surface: "#2B2520"
  on-surface-variant: "#6B6158"
  on-surface-muted: "#8F857A"
  outline: "#E3D8C6"
  outline-strong: "#CDBFA8"
  success: "#4F7A3A"
  warning: "#B7832F"
  error: "#B3402F"
  scrim: "rgba(43, 37, 32, 0.5)"
typography:
  display:
    fontFamily: Songti SC
    fontSize: 28px
    fontWeight: 700
    lineHeight: 36px
  headline:
    fontFamily: Songti SC
    fontSize: 22px
    fontWeight: 700
    lineHeight: 30px
  title:
    fontFamily: Songti SC
    fontSize: 17px
    fontWeight: 600
    lineHeight: 24px
  body-lg:
    fontFamily: Songti SC
    fontSize: 16px
    fontWeight: 400
    lineHeight: 28px
  body:
    fontFamily: Songti SC
    fontSize: 14px
    fontWeight: 400
    lineHeight: 24px
  label:
    fontFamily: Songti SC
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  caption:
    fontFamily: Songti SC
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 40px
  page: 20px
components:
  page:
    backgroundColor: "{colors.background}"
  article-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
  article-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title}"
  article-meta:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 44px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 44px
  tag:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
---

## Overview

**像翻开一本排版考究的杂志。** 暖纸以米色纸张为底、深褐墨色为字，标题和正文统一使用衬线中文字体，营造安静、可长时间阅读的氛围。唯一的强调色是赭石（primary），用于主按钮、选中态和少量关键数字；橄榄绿（secondary）与琥珀（tertiary）只做分类标签和插画点缀。

适合：资讯与专栏、读书笔记、课程、博物馆与文旅导览、生活方式内容。

关键词：纸感、衬线、宽行距、留白、克制的暖色。

## Colors

- **Primary · 赭石 (#8A4B2A)：** 主按钮、链接、选中 Tab、进度。一屏只出现一处实心主按钮。
- **Primary container (#F1E0D2)：** 标签、引用块、选中卡片的浅底；文字用 on-primary-container。
- **Secondary · 橄榄 (#5E6B3A) / Tertiary · 琥珀 (#B7832F)：** 分类标签、插画与图表的第二、三色，不做按钮底色。
- **Background (#F7F1E6) / Surface (#FFFDF8)：** 米色页面底托出近白的卡片；surface-variant 用于输入框和分组底。
- **On-surface (#2B2520) → variant (#6B6158) → muted (#8F857A)：** 正文、次要信息、时间与来源三级灰阶，都带暖调。
- **Outline (#E3D8C6)：** 分隔线和卡片描边；输入框聚焦用 outline-strong。
- **Success / Warning / Error：** 降低饱和度的绿、琥珀、砖红，与纸感保持一致。

## Typography

全部使用衬线中文字体 **Songti SC**（fallback：Noto Serif SC、Source Han Serif SC、Georgia）。正文行高接近 1.75 倍，段落之间空一行。

| Token | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| display | 28 / 700 / 36 | 封面、专题大标题 |
| headline | 22 / 700 / 30 | 页面标题 |
| title | 17 / 600 / 24 | 卡片与段落标题 |
| body-lg | 16 / 400 / 28 | 文章正文 |
| body | 14 / 400 / 24 | 列表摘要、说明 |
| label | 13 / 500 / 18 | 按钮、Tab、表单标签 |
| caption | 12 / 400 / 18 | 作者、时间、来源、角标 |

## Layout

- 页面左右边距 20px；文章正文单栏，行宽在桌面上不超过 680px。
- 模块之间 40px，模块标题到内容 16px，卡片内边距 16px。
- 列表用细分隔线而不是卡片堆叠；封面图比例 3:2 或 4:3。
- 底部固定操作栏高 56px，加安全区。

## Elevation & Depth

扁平为主，层次靠米色底与近白卡片的明度差和 1px outline 描边。浮层（底部弹层、对话框）用 `0 8px 24px` 的暖褐色低透明阴影和 scrim 遮罩。

## Shapes

小圆角：按钮和标签 4px，卡片 8px，弹层 12px；头像全圆。图片保持直角或与卡片同圆角，不做大圆角。

## Components

**文章卡片（article-card）**：近白底、8px 圆角，封面在上或在右，标题用 title，摘要 body 两行省略，底部 caption 写作者与时间。

**主按钮（button-primary）**：赭石实心、4px 圆角、高 44px；次按钮为近白底赭石字加 outline 描边。

**标签（tag）**：primary-container 浅底、caption 字号、4px 圆角。

**引用块**：左侧 3px 赭石竖线，surface-variant 底，正文用 body-lg 斜体以外的常规衬线。

## Do's and Don'ts

**Do**

- 让文字和图片做主角，正文保持宽行距与充足留白。
- 一屏只用一处赭石实心按钮，其余操作用描边或文字链接。
- 分隔优先用细线与留白，而不是阴影。

**Don't**

- 不要使用纯白底或纯黑字，会破坏纸感。
- 不要引入高饱和的蓝、紫或荧光色。
- 不要给卡片加大圆角或厚重投影。
