---
name: feishu-card
description: Feishu card JSON 2.0 for feishu_send_card - card shape, header colors, components (markdown, table, column_set, img, button, hr) and local images. Read before sending a custom Feishu card.
---

# Feishu cards (JSON 2.0)

Only for `feishu_send_card`; ordinary replies reach Feishu by themselves. JSON 2.0 rejects properties it does not support, so stick to what is listed here. Write the card's text in the chat's language.

## Shape

```json
{
  "schema": "2.0",
  "header": {
    "title": { "tag": "plain_text", "content": "部署完成" },
    "subtitle": { "tag": "plain_text", "content": "luke-server → test" },
    "template": "green"
  },
  "body": { "elements": [] }
}
```

- `schema: "2.0"` is required. Elements stack top to bottom in array order.
- `template`: blue, wathet, turquoise, green, yellow, orange, red, carmine, violet, purple, indigo, grey, default.

## Components

- **markdown** `{"tag":"markdown","content":"**粗体** [链接](https://…)"}`: headings `#`–`######`, lists (`-`, `1.`, 4 spaces per level), links (http/https only), `<font color=green>…</font>`, `<at id=all></at>`, code blocks, `>` quotes, `---` dividers. Its tables page after 5 rows and allow 4 per component: use **table** beyond that.
- **table** `{"tag":"table","page_size":5,"columns":[{"name":"svc","display_name":"服务","data_type":"text","width":"auto"}],"rows":[{"svc":"api"}]}`: `data_type` is text, lark_md, options, number, persons, date or markdown; each row maps column `name` to its value.
- **column_set** `{"tag":"column_set","flex_mode":"none","columns":[{"tag":"column","width":"weighted","weight":1,"elements":[…]}]}`: `width` auto, weighted (`weight` 1–5) or 16–600px; `flex_mode` none, stretch, flow, bisect, trisect.
- **img** `{"tag":"img","img_key":"chart","alt":{"tag":"plain_text","content":""}}`: `alt` is required; `scale_type` crop_center, crop_top or fit_horizontal.
- **button** `{"tag":"button","text":{"tag":"plain_text","content":"查看日志"},"type":"primary","behaviors":[{"type":"open_url","default_url":"https://…"}]}`: `type` default, primary, danger, text, primary_text, danger_text, primary_filled, danger_filled, laser.
- **hr** `{"tag":"hr"}`.

## Local images

Write a placeholder as the `img_key` (such as `"chart"`) and map it in the tool's `images`: `{"chart": "out/chart.png"}` (workspace paths, at most 10, 10 MB each). The tool uploads them and fills in the real keys. Render a chart to PNG first to show it.

## Example

```json
{
  "schema": "2.0",
  "header": { "title": { "tag": "plain_text", "content": "周报 · 支付服务" }, "template": "blue" },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "本周上线 **3** 个需求，<font color=red>1 个回滚</font>。" },
      {
        "tag": "table",
        "page_size": 5,
        "columns": [
          { "name": "item", "display_name": "需求", "data_type": "text", "width": "auto" },
          { "name": "state", "display_name": "状态", "data_type": "text", "width": "auto" }
        ],
        "rows": [{ "item": "退款对账", "state": "已上线" }, { "item": "分账", "state": "已回滚" }]
      },
      { "tag": "img", "img_key": "trend", "alt": { "tag": "plain_text", "content": "" } },
      { "tag": "hr" },
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "查看详情" },
        "type": "primary",
        "behaviors": [{ "type": "open_url", "default_url": "https://example.com/report" }]
      }
    ]
  }
}
```

with `images: {"trend": "out/trend.png"}`.
