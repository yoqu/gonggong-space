use super::Result;
use crate::host::Host;
use gonggong::bind::Link;
use tauri::State;

/// The 接入链接 or `gg login` command pasted, opened or found on the clipboard; binding waits for 绑定 (plan J3).
#[tauri::command]
pub fn parse_link(input: String) -> Result<Link> {
    gonggong::bind::parse_link(&input).map_err(|e| format!("{e:#}"))
}

/// Exchanges the bind code for this machine's token, like `gg login`.
#[tauri::command]
pub async fn login(server: String, code: String, fingerprint: Option<String>) -> Result<()> {
    let machine = gonggong::bind::machine_info();
    let (config, _) =
        gonggong::bind::login(&server, &code, machine, fingerprint.as_deref()).await.map_err(|e| format!("{e:#}"))?;
    config.save().map_err(|e| e.to_string())
}

/// Connecting reports the detected agents in hello. Async so it runs inside the runtime the daemon needs.
#[tauri::command]
pub async fn start_daemon(host: State<'_, Host>) -> Result<()> {
    host.start()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_links_for_the_page() {
        let link = parse_link("gonggong://bind?server=https%3A%2F%2Fg.corp&code=k7qm-4x2p".into()).unwrap();
        let json = serde_json::to_value(link).unwrap();
        assert_eq!(json, serde_json::json!({ "server": "https://g.corp", "code": "K7QM-4X2P", "fingerprint": null }));
        assert!(parse_link("K7QM-4X2P".into()).is_err());
    }
}
