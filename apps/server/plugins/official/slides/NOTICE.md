# NOTICE

本插件的 skill、模板与参考文档改编自 [open-design](https://github.com/nexu-io/open-design)，
固定提交 `4f69a426689bbd471c8f0774c13378e651ae7de8`。

```
Copyright 2026 Open Design contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## 其他许可的内容

- `templates/html-ppt/`：改编自 [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)（MIT，© 2026 lewis），`LICENSE` 原样保留在该目录；`html-ppt-*` 各模板的示例与起点同样来自它。
- `templates/html-ppt-zhangzara-*/`（v0.2 保留 8 套）：来自 [zarazhangrui/beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates)（MIT，© 2026 Zara Zhang），`LICENSE` 原样保留在各目录。
- `templates/guizang-ppt/`：MIT（© 2026 op7418 歸藏），`LICENSE` 原样保留在该目录。按固定提交时的许可收录；上游后来改为 AGPL-3.0，不再跟进上游。
- `templates/html-ppt-taste-{brutalist,editorial}/`：上游改编自 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)（MIT），署名保留在各 `GUIDE.md`。
- `templates/ib-pitch-book/`：上游改编自 [anthropics/financial-services](https://github.com/anthropics/financial-services)（Apache-2.0），署名见 `references/attribution.md`。
- `templates/kami-deck/`：美学来自 [tw93/kami](https://github.com/tw93/kami)（MIT），署名保留在 `GUIDE.md` 与 `design-system/DESIGN.md`。
- `craft/` 与 `references/critique.md`：同「产品原型」插件，`craft/*.md` 在上游注明改编自 [refero_skill](https://github.com/referodesign/refero_skill)（MIT）。

## 来源文件

| 本插件 | 上游 |
|---|---|
| `skills/slides/SKILL.md` | 依据各 deck 模板的公共流程重写为按模板路由的入口 |
| `skills/slides/templates/<id>/` | `design-templates/<id>/`（`SKILL.md` 改写为 `GUIDE.md`，其余文件照搬，删去 README、导出脚本与 OD 专用文件） |
| `skills/slides/templates/{simple-deck,weekly-update,ib-pitch-book}/design-system/` | 「产品原型」插件的 `neutral-modern`、`corporate` 设计系统 |
| `skills/slides/templates/kami-deck/design-system/` | `design-systems/kami/` |
| `previews/*.webp` | 由各模板示例截图生成 |
| `skills/slides/toolkit/deck-toolkit.js` | 自研放映工具包（总览、演讲者窗口、激光笔、画笔、黑白屏、跳页、打印排版），不来自上游 |
| `skills/slides/toolkit/stage-seed.html` 与 `templates/{gov-report,new-chinese,bento-grid,newspaper,metro-map,chat-story,living-model,blueprint}/` | 自研，代码与视觉原创，不来自上游 |

## 未收录

- `open-design-landing-deck`：open design 自己的品牌宣传稿。
- `replit-deck`：仿 Replit Slides 的主题，有商标风险。
