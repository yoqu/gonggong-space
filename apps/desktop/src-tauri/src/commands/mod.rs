//! Tauri commands, one module per page. To add a page's commands: create `commands/<page>.rs`, declare it here and
//! list its commands in `handler()`; mirror each one in `src/ipc.ts`.
mod onboarding;
mod overview;
mod settings;
mod shell;

/// Command errors reach the frontend as the rejected promise's message.
pub type Result<T> = std::result::Result<T, String>;

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        shell::app_info,
        shell::snapshot,
        onboarding::login,
        onboarding::detect_agents,
        onboarding::start_daemon,
        onboarding::machine_bots,
        onboarding::confirm_bots,
        overview::overview,
        settings::get_settings,
        settings::set_auto_upgrade,
        settings::set_launch_at_login,
        settings::unbind,
    ]
}

fn client() -> Result<aiws::bots::Client> {
    let config = aiws::config::Config::load().map_err(|e| e.to_string())?.ok_or("尚未绑定")?;
    aiws::bots::Client::new(&config).map_err(|e| e.to_string())
}
