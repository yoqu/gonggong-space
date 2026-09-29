//! Tauri commands, one module per page. To add a page's commands: create `commands/<page>.rs`, declare it here and
//! list its commands in `handler()`; mirror each one in `src/ipc.ts`.
mod agents;
mod bots;
mod logs;
mod onboarding;
mod overview;
mod permissions;
mod settings;
mod shell;
mod tunnels;
mod workspaces;

/// Command errors reach the frontend as the rejected promise's message.
pub type Result<T> = std::result::Result<T, String>;

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        shell::app_info,
        shell::snapshot,
        onboarding::parse_link,
        onboarding::login,
        onboarding::start_daemon,
        overview::overview,
        overview::run_process,
        settings::get_settings,
        settings::set_auto_upgrade,
        settings::set_launch_at_login,
        settings::unbind,
        workspaces::workspaces,
        workspaces::reveal,
        workspaces::reset_cd,
        workspaces::delete_workspace,
        logs::diagnostics,
        logs::measure_net,
        logs::export_diagnostics,
        logs::recent_logs,
        agents::agents,
        agents::pick_agent_path,
        agents::reset_agent_path,
        bots::bots,
        bots::open_bot_in_web,
        tunnels::tunnels,
        tunnels::close_tunnel,
        tunnels::stop_service,
        tunnels::open_local,
        permissions::permissions,
        permissions::request_permission,
        permissions::restart_app,
    ]
}

fn client() -> Result<gonggong::bots::Client> {
    let config = gonggong::config::Config::load().map_err(|e| e.to_string())?.ok_or("尚未绑定")?;
    gonggong::bots::Client::new(&config).map_err(|e| e.to_string())
}

/// Applies a change to the owner's local settings (`local.json`); runs pick it up from their next turn.
fn local(home: &std::path::Path, change: impl FnOnce(&mut gonggong::local::LocalSettings)) -> Result<()> {
    gonggong::local::LocalStore::open(home.to_path_buf())
        .and_then(|store| store.update(change))
        .map(drop)
        .map_err(|e| format!("{e:#}"))
}
