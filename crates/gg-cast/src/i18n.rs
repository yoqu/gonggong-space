//! gg-cast cannot depend on gonggong: the same locale rule (the daemon passes `GG_LANG`) and its own few messages.
use std::sync::OnceLock;

const EN: &[(&str, &str)] = &[
    ("{k} 缺少取值", "{k} is missing a value"),
    ("--pids 应为逗号分隔的进程号", "--pids must be comma-separated process ids"),
    ("--fps 应为 1 到 90 的整数", "--fps must be an integer from 1 to 90"),
    ("未知参数 {k}", "Unknown argument {k}"),
    (
        "Linux 上只能推送虚拟显示里的桌面应用：请用 service_start 的 display: \"virtual\" 重新启动服务（其他系统推送窗口，用 --pids）",
        "On Linux only desktop apps in a virtual display can be published: restart the service with service_start's display: \"virtual\" (other systems publish windows, with --pids)",
    ),
    ("缺少 --url", "Missing --url"),
    (
        "本机没有授予「屏幕录制」权限：请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许运行 gg 的程序（终端或共工空间桌面端）",
        "Screen recording isn't allowed on this machine: allow the program running gg (the terminal or the Gonggong Space desktop app) in System Settings → Privacy & Security → Screen Recording",
    ),
    ("应用还没有可见窗口（或窗口已最小化）", "The app has no visible window yet (or it is minimized)"),
    ("窗口已关闭", "The window was closed"),
    ("Linux 只推送虚拟屏", "Linux only publishes a virtual screen"),
    ("无法创建窗口采集器", "Can't create the window capturer"),
    (
        "要推送的窗口是置顶窗口，只能在主显示器上推送：请把它移到主显示器",
        "The window is always on top and can only be published on the main display: move it to the main display",
    ),
    ("采集器里没有要推送的画面（{window}）", "The capturer has nothing to publish ({window})"),
    ("缺少 GG_CAST_TOKEN", "Missing GG_CAST_TOKEN"),
    ("无法连接实时画面服务（LiveKit）", "Can't connect to the live view service (LiveKit)"),
    ("无法发布画面", "Can't publish the video"),
    ("与实时画面服务断开（{reason}）", "Disconnected from the live view service ({reason})"),
    ("与实时画面服务断开", "Disconnected from the live view service"),
    ("无法注入输入（需要辅助功能权限）", "Can't inject input (needs the Accessibility permission)"),
    ("无法连接虚拟显示（DISPLAY）", "Can't connect to the virtual display (DISPLAY)"),
];

/// Chinese unless the first set of `GG_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG` names another language.
fn english() -> bool {
    static EN_LOCALE: OnceLock<bool> = OnceLock::new();
    *EN_LOCALE.get_or_init(|| {
        let tag = ["GG_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .filter_map(|k| std::env::var(k).ok())
            .find(|v| !v.is_empty())
            .unwrap_or_default();
        !cfg!(test) && !chinese(&tag)
    })
}

fn chinese(tag: &str) -> bool {
    let t = tag.split([',', ';']).next().unwrap_or("").trim().to_ascii_lowercase();
    t.is_empty() || t == "*" || t.starts_with("zh") || t == "c" || t.starts_with("c.") || t == "posix"
}

pub fn tr(zh: &'static str) -> &'static str {
    if !english() {
        return zh;
    }
    EN.iter().find(|(k, _)| *k == zh).map_or(zh, |(_, v)| v)
}

/// `t!("中文")` → `&'static str`; `t!("{k} 缺少取值", k = x)` → `String`.
macro_rules! t {
    ($zh:literal) => {
        $crate::i18n::tr($zh)
    };
    ($zh:literal, $($k:ident = $v:expr),+ $(,)?) => {{
        let mut s = $crate::i18n::tr($zh).to_string();
        $(s = s.replace(concat!("{", stringify!($k), "}"), &($v).to_string());)+
        s
    }};
}
pub(crate) use t;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_tags() {
        assert!(chinese("") && chinese("C.UTF-8") && chinese("zh_CN.UTF-8"));
        assert!(!chinese("en_US.UTF-8") && !chinese("ja_JP"));
    }

    #[test]
    fn english_covers_every_literal() {
        for file in ["main.rs", "input.rs", "window.rs"] {
            let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/").to_string() + file).unwrap();
            for (i, _) in src.match_indices("t!(\"").filter(|(i, _)| !src[..*i].ends_with(char::is_alphanumeric)) {
                let (mut key, mut chars) = (String::new(), src[i + 4..].chars());
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => key.extend(chars.next()),
                        '"' => break,
                        c => key.push(c),
                    }
                }
                assert!(EN.iter().any(|(k, _)| *k == key), "{file}: missing English: {key}");
            }
        }
    }
}
