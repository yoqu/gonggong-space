# Switch

开关：立即生效的二元设置（macOS 27 设置里的主要控件）。

**你需要提供**：`checked`/`defaultChecked`、`onChange(checked)`；没有可见 `label` 时传 `aria-label`。`size="small"` 用于密集列表；`labelPosition="after"` 把标签放在右侧（默认在左，适配设置行）。

打开态轨道为 `accent`，圆钮为 `knob` + `shadow-control`。需要「应用/取消」确认的设置用 Checkbox，不用 Switch。
