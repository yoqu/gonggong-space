//! 穿透与服务 page: this machine's preview tunnels and hosted services, stopped here as on the Web.
use super::{Result, client};
use gonggong::previews::Tunnels;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn tunnels() -> Result<Tunnels> {
    client()?.tunnels().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_tunnel(id: String, stop_service: bool) -> Result<()> {
    client()?.close_preview(&id, stop_service).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn retry_cast(id: String) -> Result<()> {
    client()?.retry_cast(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_service(id: String) -> Result<()> {
    client()?.stop_service(&id).await.map_err(|e| e.to_string())
}

/// 本机打开: the forwarded port itself, no login needed on this machine.
#[tauri::command]
pub fn open_local(port: u16, path: String, app: AppHandle) -> Result<()> {
    app.opener().open_url(format!("http://localhost:{port}{path}"), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_server_list_and_hands_the_page_camel_case() {
        let tunnels: Tunnels = serde_json::from_str(
            r#"{"previews":[{"id":"p1","groupId":"g1","groupName":"支付重构","botId":"b1","botName":"小王的 Claude",
                "kind":"http","title":"登录页","path":"/login","serviceId":"sv1","serviceName":"web","port":5173,
                "snapshotAt":null,"status":"online","canManage":true,"createdAt":"2026-09-28T10:00:00Z"},
               {"id":"p2","groupId":"g1","groupName":"支付重构","botId":"b1","botName":"小王的 Claude",
                "kind":"gui","title":"桌面客户端","path":"/","serviceId":"sv2","serviceName":"app","port":null,
                "snapshotAt":null,"status":"online","canManage":true,"createdAt":"2026-09-28T10:00:00Z",
                "live":{"state":"failed","error":"窗口已关闭","missing":["accessibility"],"devtools":"port",
                  "retryAt":"2026-09-28T10:00:04.000Z"},
                "control":{"controller":{"id":"u2","name":"李建国"},"requests":[]}}],
               "services":[{"id":"sv1","groupId":"g1","groupName":"支付重构","botId":"b1","botName":"小王的 Claude",
                "name":"web","command":"pnpm dev","cwd":"apps/web","port":5173,"status":"running","canManage":true,
                "createdAt":"2026-09-28T10:00:00Z"}]}"#,
        )
        .unwrap();
        let json = serde_json::to_value(tunnels).unwrap();
        assert_eq!(json["previews"][0]["groupName"], "支付重构");
        assert_eq!(json["previews"][0]["serviceId"], "sv1");
        assert_eq!(json["services"][0]["port"], 5173);
        assert_eq!(json["previews"][0]["live"], serde_json::Value::Null);
        assert_eq!(json["previews"][1]["kind"], "gui");
        assert_eq!(json["previews"][1]["live"]["missing"][0], "accessibility");
        assert_eq!(json["previews"][1]["live"]["devtools"], "port");
        assert_eq!(json["previews"][1]["live"]["retryAt"], "2026-09-28T10:00:04.000Z");
        assert_eq!(json["previews"][1]["control"]["controller"]["name"], "李建国");
    }
}
