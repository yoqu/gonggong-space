//! Tauri commands, one module per page. To add a page's commands: create `commands/<page>.rs`, declare it here and
//! list its commands in `handler()`; mirror each one in `src/ipc.ts`.
mod agents;
mod bots;
mod logs;
mod market;
mod onboarding;
mod overview;
mod providers;
mod settings;
mod shell;
mod tools;
mod tunnels;
mod updates;
mod workspaces;

use crate::i18n::tr;

/// Command errors reach the frontend as the rejected promise's message.
pub type Result<T> = std::result::Result<T, String>;

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        shell::app_info,
        shell::set_locale,
        shell::snapshot,
        shell::open_web,
        onboarding::parse_link,
        onboarding::login,
        onboarding::start_daemon,
        overview::overview,
        overview::run_process,
        settings::get_settings,
        settings::set_auto_upgrade,
        settings::set_mirror,
        settings::set_env,
        settings::set_launch_at_login,
        settings::set_hide_dock_on_close,
        settings::unbind,
        settings::stop_daemon,
        updates::check_update,
        workspaces::workspaces,
        workspaces::reveal,
        workspaces::reset_cd,
        workspaces::delete_workspace,
        workspaces::workspace_changes,
        logs::diagnostics,
        logs::measure_net,
        logs::export_diagnostics,
        logs::recent_logs,
        tools::tools,
        tools::run_tool,
        agents::agent_local,
        agents::pick_agent_path,
        agents::reset_agent_path,
        agents::group_names,
        providers::agent_features,
        providers::providers_cmd,
        providers::ccswitch_preview,
        providers::ccswitch_apply,
        providers::claude_dirs,
        providers::claude_default_dir,
        providers::pick_dir,
        bots::bots,
        bots::open_bot_in_web,
        market::market_installs,
        market::market_listings,
        market::open_market_in_web,
        tunnels::tunnels,
        tunnels::close_tunnel,
        tunnels::start_preview,
        tunnels::stop_service,
        tunnels::open_local,
    ]
}

/// The daemon's handling of the Web's agent and provider commands, run here on this machine's files.
fn manage(home: &std::path::Path) -> gonggong::manage::Manage {
    gonggong::manage::Manage::new(home.to_path_buf(), gonggong::config::user_home())
}

/// Sends one command the way the server would and waits for the message `answer` picks out of what comes back.
async fn relay<T>(
    send: impl FnOnce(&gonggong::service::Outbox),
    mut answer: impl FnMut(gonggong::protocol::DaemonToServer) -> Option<T>,
) -> Result<T> {
    let (out, mut rx) = gonggong::service::Outbox::channel();
    send(&out);
    // The handler holds its own sender until it is done; then the channel closes.
    drop(out);
    while let Some(msg) = rx.recv().await {
        if let Some(found) = answer(msg) {
            return Ok(found);
        }
    }
    Err(tr!("共工客户端没有响应，请稍后重试").to_string())
}

fn client() -> Result<gonggong::bots::Client> {
    let config = gonggong::config::Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?;
    gonggong::bots::Client::new(&config).map_err(|e| e.to_string())
}
