//! 实时画面 page: which gg-cast this app runs; the live previews themselves come with `tunnels`.
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum CastComponent {
    /// GG_CAST_BIN: a developer's own build.
    Local { path: String },
    /// Shipped inside this app, same build as the daemon.
    Bundled { path: String },
    /// Not bundled (a dev build of the app): downloaded from the server on first use, like `gg` does.
    Download,
}

#[tauri::command]
pub fn cast_component() -> CastComponent {
    let local = std::env::var_os("GG_CAST_BIN").map(|p| p.to_string_lossy().into_owned());
    let bundled = gonggong::cast::bundled().map(|p| p.display().to_string());
    match (local, bundled) {
        (Some(path), _) => CastComponent::Local { path },
        (None, Some(path)) => CastComponent::Bundled { path },
        (None, None) => CastComponent::Download,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_the_page_where_gg_cast_comes_from() {
        let json = serde_json::to_value(CastComponent::Bundled {
            path: "/Applications/共工空间.app/Contents/MacOS/gg-cast".into(),
        })
        .unwrap();
        assert_eq!(json["source"], "bundled");
        assert_eq!(serde_json::to_value(CastComponent::Download).unwrap()["source"], "download");
    }
}
