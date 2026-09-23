// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod host;

use host::Host;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// Event carrying every `host::Snapshot` change to the UI (`onSnapshot` in `src/ipc.ts`).
const SNAPSHOT_EVENT: &str = "daemon://snapshot";

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Menu-bar icon: the daemon keeps running with the window closed; 退出 is the only way to stop it.
fn tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("AIWS Daemon")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn main() {
    let home = aiws::config::home();
    // Same log setup as `aiws run`: <home>/logs plus the in-memory recent lines (`Logs`, managed for the Logs page).
    let (logs, _log_guard) = aiws::logs::init(&home).expect("cannot set up logging");
    tauri::Builder::default()
        .manage(logs)
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(commands::handler())
        .setup(move |app| {
            let handle = app.handle().clone();
            let notify = Arc::new(move |snapshot| {
                let _ = handle.emit(SNAPSHOT_EVENT, snapshot);
            });
            app.manage(Host::new(home, notify));
            tray(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if aiws::config::Config::load().ok().flatten().is_some()
                    && let Err(e) = handle.state::<Host>().start()
                {
                    tracing::error!("daemon failed to start: {e}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the AIWS desktop app")
        .run(|_app, _event| {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                show_window(_app);
            }
        });
}
