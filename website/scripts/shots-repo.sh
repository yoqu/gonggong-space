#!/usr/bin/env bash
# Creates the demo bare repo <dir>/todo-app.git: a tiny dependency-free TODO web app with a short history.
set -euo pipefail
DIR="$1"
BARE="$DIR/todo-app.git"
SEED="$DIR/seed"
rm -rf "$BARE" "$SEED" && mkdir -p "$DIR"
git init -q --bare -b main "$BARE"
git clone -q "$BARE" "$SEED" 2>/dev/null
cd "$SEED"
commit() { # author email date message
  git add -A
  GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" GIT_COMMITTER_DATE="$3" \
    git -c user.name="$1" -c user.email="$2" commit -q --date "$3" -m "$4"
}

cat >package.json <<'EOF'
{
  "name": "todo-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "星河工作室的待办清单小应用",
  "scripts": {
    "dev": "node server.js",
    "start": "node server.js"
  }
}
EOF
cat >server.js <<'EOF'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const PORT = Number(process.env.PORT ?? 3000)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const root = join(import.meta.dirname, 'public')

createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try {
    const body = await readFile(join(root, path))
    res.writeHead(200, { 'content-type': `${TYPES[extname(path)] ?? 'text/plain'}; charset=utf-8` })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(PORT, () => console.log(`todo-app running at http://localhost:${PORT}`))
EOF
cat >README.md <<'EOF'
# todo-app

星河工作室的待办清单小应用：纯原生 HTML/CSS/JS，无构建步骤，数据保存在浏览器 localStorage。

## 本地运行

```bash
npm run dev   # http://localhost:3000，可用 PORT 环境变量改端口
```

## 目录

- `server.js`：静态文件服务
- `public/index.html`：页面结构
- `public/app.js`：待办的增删改与渲染
- `public/style.css`：样式
EOF
cat >.gitignore <<'EOF'
node_modules/
.DS_Store
EOF
commit 王磊 wanglei@xinghe.dev "2026-09-21T10:12:00+08:00" "初始化 todo-app：静态服务与页面骨架"

mkdir -p public
cat >public/index.html <<'EOF'
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>待办清单</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="card">
      <h1>待办清单</h1>
      <form id="new-todo">
        <input id="title" placeholder="要做点什么？" autocomplete="off" />
        <button type="submit">添加</button>
      </form>
      <ul id="list"></ul>
      <footer id="summary"></footer>
    </main>
    <script type="module" src="app.js"></script>
  </body>
</html>
EOF
cat >public/app.js <<'EOF'
const KEY = 'todo-app.items'
const list = document.querySelector('#list')
const form = document.querySelector('#new-todo')
const input = document.querySelector('#title')
const summary = document.querySelector('#summary')

let todos = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? [
  { id: 1, title: '整理本周需求', done: true },
  { id: 2, title: '给登录页加表单校验', done: false },
  { id: 3, title: '周五发版前回归测试', done: false },
]

function save() {
  localStorage.setItem(KEY, JSON.stringify(todos))
}

function render() {
  list.innerHTML = ''
  for (const todo of todos) {
    const li = document.createElement('li')
    li.className = todo.done ? 'done' : ''
    li.innerHTML = `<label><input type="checkbox" ${todo.done ? 'checked' : ''} /> <span></span></label>
      <button class="remove" title="删除">×</button>`
    li.querySelector('span').textContent = todo.title
    li.querySelector('input').addEventListener('change', () => toggle(todo.id))
    li.querySelector('.remove').addEventListener('click', () => remove(todo.id))
    list.append(li)
  }
  const left = todos.filter((t) => !t.done).length
  summary.textContent = `共 ${todos.length} 项，未完成 ${left} 项`
}

function toggle(id) {
  todos = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
  save()
  render()
}

function remove(id) {
  todos = todos.filter((t) => t.id !== id)
  save()
  render()
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const title = input.value.trim()
  if (!title) return
  todos.push({ id: Date.now(), title, done: false })
  input.value = ''
  save()
  render()
})

render()
EOF
commit 李娜 lina@xinghe.dev "2026-09-23T15:40:00+08:00" "待办列表：新增、勾选完成、删除，数据存 localStorage"

cat >public/style.css <<'EOF'
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f4f6fb;
  color: #1f2430;
}
.card {
  width: min(480px, 92vw);
  background: #fff;
  border-radius: 14px;
  padding: 28px 28px 20px;
  box-shadow: 0 12px 32px rgba(31, 36, 48, 0.08);
}
h1 { margin: 0 0 18px; font-size: 24px; }
form { display: flex; gap: 8px; margin-bottom: 14px; }
input#title { flex: 1; padding: 10px 12px; border: 1px solid #d7dce6; border-radius: 8px; font-size: 15px; }
button { border: 0; border-radius: 8px; padding: 0 16px; background: #3b6cf6; color: #fff; font-size: 15px; cursor: pointer; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; justify-content: space-between; padding: 10px 4px; border-bottom: 1px solid #eef0f5; }
li.done span { color: #9aa1af; text-decoration: line-through; }
.remove { background: transparent; color: #9aa1af; font-size: 18px; padding: 0 6px; }
footer { margin-top: 14px; color: #7a8190; font-size: 13px; }
EOF

commit 陈晨 chenchen@xinghe.dev "2026-09-25T11:05:00+08:00" "页面样式：卡片布局与完成态"
git push -q origin main
cd / && rm -rf "$SEED"
