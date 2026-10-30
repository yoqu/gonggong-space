---
version: alpha
name: 几何构成（高对比）
description: 白底黑线、红蓝黄三原色与直角几何块面的高对比设计系统，适合活动、展览、工具与品牌感强的产品。尺寸以 375 宽设计稿 px 表示。
colors:
  primary: "#D62828"
  on-primary: "#FFFFFF"
  secondary: "#1D4E89"
  on-secondary: "#FFFFFF"
  tertiary: "#F2B705"
  on-tertiary: "#111111"
  background: "#FFFFFF"
  surface: "#FFFFFF"
  surface-variant: "#F2F2EE"
  on-surface: "#111111"
  on-surface-variant: "#4A4A4A"
  on-surface-muted: "#7A7A7A"
  outline: "#111111"
  outline-soft: "#D9D9D4"
  success: "#2E7D32"
  warning: "#F2B705"
  error: "#D62828"
  scrim: "rgba(17, 17, 17, 0.6)"
typography:
  display:
    fontFamily: PingFang SC
    fontSize: 34px
    fontWeight: 800
    lineHeight: 38px
  headline:
    fontFamily: PingFang SC
    fontSize: 24px
    fontWeight: 800
    lineHeight: 30px
  title:
    fontFamily: PingFang SC
    fontSize: 17px
    fontWeight: 700
    lineHeight: 22px
  body:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  label:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 700
    lineHeight: 16px
  caption:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  number:
    fontFamily: PingFang SC
    fontSize: 40px
    fontWeight: 800
    lineHeight: 44px
rounded:
  none: 0px
  sm: 2px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 48px
  page: 16px
  border: 2px
components:
  page:
    backgroundColor: "{colors.background}"
  block-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    padding: 16px
  block-card-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.none}"
  section-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.headline}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    height: 48px
  chip:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.on-surface}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
---

## Overview

**用几何块面与粗黑线组织信息。** 白底上以 2px 黑色描边划分区域，红、蓝、黄三原色作为大块面出现在标题条、数字卡和插画里，形成强烈的节奏感。字体全部使用粗字重无衬线，标题紧凑、数字醒目。

适合：活动报名、展览与演出、校园与社团、效率工具、需要强识别度的首页。

关键词：直角、粗线、块面、三原色、强对比。

## Colors

- **Primary · 红 (#D62828)：** 主按钮、关键提示、错误。每屏一个红色主操作。
- **Secondary · 蓝 (#1D4E89)：** 信息块、选中态、链接。
- **Tertiary · 黄 (#F2B705)：** 强调块面、数字卡、角标；黄底上一律用黑字（on-tertiary）。
- **Background / Surface (#FFFFFF)：** 纯白；surface-variant (#F2F2EE) 用于输入框和次级分组。
- **On-surface (#111111)：** 正文与描边同色，variant (#4A4A4A)、muted (#7A7A7A) 用于次要信息。
- **Outline (#111111)：** 2px 粗描边是主要的分区手段；细分隔用 outline-soft。

## Typography

无衬线 **PingFang SC**，大量使用 700–800 字重。

| Token | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| display | 34 / 800 / 38 | 首屏主标题，可两行 |
| headline | 24 / 800 / 30 | 模块标题 |
| title | 17 / 700 / 22 | 卡片标题 |
| body | 15 / 400 / 22 | 正文 |
| label | 13 / 700 / 16 | 按钮、Tab |
| caption | 12 / 500 / 16 | 辅助信息、标签 |
| number | 40 / 800 / 44 | 数据卡、倒计时、价格 |

## Layout

- 页面边距 16px；模块之间 48px，模块用 2px 黑线或整块色面分隔。
- 网格感：两列或三列等宽块，块与块共用描边（相邻不留缝）。
- 标题左对齐，可在左侧放 8px 宽的色条。

## Elevation & Depth

完全扁平，不用阴影。层次通过块面颜色、粗描边和位移（按下时向右下偏移 2px 的实色投影 `2px 2px 0 var(--color-outline)`）表达。

## Shapes

直角为主（0px）；标签与头像可全圆，形成方圆对比。插画只用圆、方、三角和直线。

## Components

**块卡片（block-card）**：白底、2px 黑描边、直角、16px 内边距；强调版为整块黄底黑字。

**主按钮（button-primary）**：红底白字、直角、高 48px、2px 黑描边，按下时实色投影消失。

**次按钮（button-secondary）**：白底黑字黑描边。

**标签（chip）**：浅灰底全圆角，选中时变蓝底白字。

## Do's and Don'ts

**Do**

- 用粗描边和块面分区，保持直角与对齐。
- 三原色成块使用，每块只放一种颜色。
- 数字和标题用大字号粗字重，形成视觉锚点。

**Don't**

- 不要使用渐变、柔和阴影或毛玻璃。
- 不要在一个元素上同时叠两种原色。
- 不要用细字重做标题。
