use super::{Result, client};
use crate::host::Host;
use aiws::bots::Bot;
use aiws::local::LocalSettings;
use aiws::protocol::AgentInfo;
use tauri::State;

/// Step 1: exchanges the bind code for this machine's token, like `aiws login`.
#[tauri::command]
pub async fn login(server: String, code: String) -> Result<()> {
    let config =
        aiws::bind::login(&server, &code, aiws::bind::machine_info(), None).await.map_err(|e| format!("{e:#}"))?;
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn detect_agents(host: State<'_, Host>) -> Result<Vec<AgentInfo>> {
    Ok(aiws::agents::detect(&LocalSettings::load(&host.home).map_err(|e| e.to_string())?))
}

/// Step 2: connecting reports the detected agents in hello. Async so it runs inside the runtime the daemon needs.
#[tauri::command]
pub async fn start_daemon(host: State<'_, Host>) -> Result<()> {
    host.start()
}

#[tauri::command]
pub async fn machine_bots() -> Result<Vec<Bot>> {
    client()?.list().await.map_err(|e| e.to_string())
}

/// Step 3: confirms the bots someone else created for this machine.
#[tauri::command]
pub async fn confirm_bots(ids: Vec<String>) -> Result<()> {
    let client = client()?;
    for id in ids {
        client.confirm(&id).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
