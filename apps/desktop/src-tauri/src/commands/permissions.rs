//! 系统权限 guide: the macOS permissions the previews need, asked for by this app so that TCC lists 共工空间 — the daemon
//! runs in this process and gg-cast, its child, is attributed to this app too.
use super::Result;
use gonggong::permission::{self, Permission};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, PartialEq, Serialize)]
pub struct PermissionState {
    kind: Permission,
    granted: bool,
}

/// Empty where none is needed (Windows, Linux): the guide and reminders then stay hidden.
#[tauri::command]
pub fn permissions() -> Vec<PermissionState> {
    permission::ALL
        .into_iter()
        .filter_map(|kind| permission::granted(kind).map(|granted| PermissionState { kind, granted }))
        .collect()
}

/// Lists 共工空间 under the permission (with the system prompt where macOS still shows one), then opens its pane in
/// System Settings: a permission denied once is only switched on there.
#[tauri::command]
pub fn request_permission(kind: Permission, app: AppHandle) -> Result<()> {
    permission::request(kind);
    app.opener().open_url(permission::settings_url(kind), None::<&str>).map_err(|e| e.to_string())
}

/// Screen recording granted to a running app only applies once it restarts.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_permissions_only_where_they_exist() {
        let list = permissions();
        assert_eq!(list.len(), if cfg!(target_os = "macos") { 2 } else { 0 });
        let json = serde_json::to_value(PermissionState { kind: Permission::ScreenRecording, granted: false }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "screen_recording", "granted": false }));
    }
}
