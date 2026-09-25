# FinderExample

Finder 式文件窗口模板：可折叠分组的 `Sidebar`，工具栏里是前进 / 后退、视图切换、共享和搜索，内容是贴满的 `Table`（可排序、树形展开、多选），底部状态栏放 `PathControl` 和项目数。

- 表格贴满内容区时去掉自身边框和圆角（`style: {border: 0, borderRadius: 0}`）。
- 状态栏高 30px，`label-secondary` 小字，上方一条 `separator`。
