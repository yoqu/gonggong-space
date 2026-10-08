//! Texts of the desktop shell (tray, dialogs, command errors). The locale follows the frontend's choice
//! (`set_locale`), which also switches the in-process daemon.

const EN: &[(&str, &str)] = &[
    ("打开", "Open"),
    ("退出", "Quit"),
    ("共工空间", "Gonggong Space"),
    ("尚未绑定", "Not bound yet"),
    ("环境变量名不合法：{name}", "Invalid environment variable name: {name}"),
    ("不是有效的 http(s) 地址：{url}", "Not a valid http(s) URL: {url}"),
    ("工作区不存在或已变化，请刷新", "The workspace is gone or has changed. Refresh and try again"),
    ("托管 {managed} · 本机目录 {cd} · {size}", "Managed {managed} · local directories {cd} · {size}"),
    ("找不到 {path}", "Not found: {path}"),
    ("选择 {agent} 可执行文件", "Choose the {agent} executable"),
];

pub fn text(zh: &'static str) -> &'static str {
    gonggong::i18n::tr_in(EN, zh)
}

/// Like `gonggong::t!`: a Chinese literal, then `name = value` params; `&'static str` without params, `String` with.
macro_rules! tr {
    ($zh:literal) => {
        $crate::i18n::text($zh)
    };
    ($zh:literal, $($k:ident = $v:expr),+ $(,)?) => {
        gonggong::i18n::fill($crate::i18n::text($zh), &[$((stringify!($k), ($v).to_string())),+])
    };
}
pub(crate) use tr;

#[cfg(test)]
mod tests {
    use super::EN;
    use std::path::Path;

    fn literals(dir: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                literals(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let src = std::fs::read_to_string(&path).unwrap();
                for part in src.split("tr!(\"").skip(1) {
                    out.push(part[..part.find('"').unwrap()].to_string());
                }
            }
        }
    }

    #[test]
    fn every_text_has_english() {
        let mut found = Vec::new();
        literals(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut found);
        assert!(!found.is_empty());
        let missing: Vec<_> = found.iter().filter(|zh| !EN.iter().any(|(k, _)| k == zh)).collect();
        assert!(missing.is_empty(), "no English for {missing:?}");
    }
}
