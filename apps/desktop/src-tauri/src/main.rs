// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod host;
mod i18n;

use host::Host;
use i18n::tr;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

/// Event carrying every `host::Snapshot` change to the UI (`onSnapshot` in `src/ipc.ts`).
const SNAPSHOT_EVENT: &str = "daemon://snapshot";

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_menu<R: Runtime>(app: &impl Manager<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", tr!("打开"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr!("退出"), true, None::<&str>)?;
    Menu::with_items(app, &[&open, &quit])
}

/// Menu-bar icon: the daemon keeps running with the window closed; 退出 is the only way to stop it.
fn tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip(tr!("共工空间"))
        .menu(&tray_menu(app)?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Re-labels the tray and the window title once the frontend has reported its locale.
fn localize(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(tray_menu(app)?))?;
        tray.set_tooltip(Some(tr!("共工空间")))?;
    }
    if let Some(window) = app.get_webview_window("main") {
        window.set_title(tr!("共工空间"))?;
    }
    Ok(())
}

fn main() {
    #[cfg(unix)]
    if let Some(path) = gonggong::agents::login_shell_path() {
        // SAFETY: first thing in main, before any other thread exists.
        unsafe { std::env::set_var("PATH", path) };
    }
    let home = gonggong::config::home();
    // Same log setup as `gg run`: <home>/logs plus the in-memory recent lines (`Logs`, managed for the Logs page).
    let (logs, _log_guard) = gonggong::logs::init(&home).expect("cannot set up logging");
    tauri::Builder::default()
        // First, so a second launch (a 接入链接 on Windows / Linux) is handed to this instance's deep-link plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(logs)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        // App updates from GitHub Releases (`plugins.updater` in tauri.conf.json), driven by `src/updater.ts`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(commands::handler())
        .setup(move |app| {
            let handle = app.handle().clone();
            let notify = Arc::new(move |snapshot| {
                let _ = handle.emit(SNAPSHOT_EVENT, snapshot);
            });
            app.manage(Host::new(home, notify));
            tray(app)?;
            // The frontend reads the 接入链接 itself (`onBindLinks` in `src/ipc.ts`); here it only comes to the front.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_| show_window(&handle));
            // Installers register the scheme; unbundled Linux / Windows dev builds register it here.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if let Err(e) = app.deep_link().register_all() {
                tracing::warn!("cannot register the gonggong:// scheme: {e}");
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if gonggong::config::Config::load().ok().flatten().is_some()
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
        .expect("error while building the Gonggong desktop app")
        .run(|_app, _event| {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                show_window(_app);
            }
        });
}
