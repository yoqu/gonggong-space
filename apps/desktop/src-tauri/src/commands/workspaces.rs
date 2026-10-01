use super::Result;
use crate::host::Host;
use crate::i18n::tr;
use gonggong::config::Config;
use gonggong::workspace::{self, Entry, EntryKind, EntryState, human_size};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    group_id: String,
    bot_id: String,
    group: String,
    bot: String,
    kind: EntryKind,
    kind_label: &'static str,
    path: PathBuf,
    state: EntryState,
    state_label: String,
    deletable: bool,
}

impl From<&Entry> for Row {
    fn from(e: &Entry) -> Self {
        Row {
            group_id: e.group_id.clone(),
            bot_id: e.bot_id.clone(),
            group: e.group_label(),
            bot: e.bot_label().to_string(),
            kind: e.kind,
            kind_label: e.kind_label(),
            path: e.path.clone(),
            state: e.state,
            state_label: e.state_label(),
            deletable: e.deletable(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRow {
    name: String,
    path: PathBuf,
    size: String,
    modified_ms: Option<u128>,
}

#[derive(Serialize)]
pub struct Workspaces {
    rows: Vec<Row>,
    backups: Vec<BackupRow>,
    offline: bool,
}

/// Every workspace of this machine; without the server (`offline`), from disk alone.
pub async fn entries(home: &Path) -> (Vec<Entry>, bool) {
    let pairs = match Config::load().ok().flatten() {
        Some(config) => workspace::fetch_pairs(&config).await.ok(),
        None => None,
    };
    let offline = pairs.is_none();
    let home = home.to_path_buf();
    let pairs = pairs.unwrap_or_default();
    let list = tauri::async_runtime::spawn_blocking(move || workspace::list(&home, &pairs)).await;
    (list.unwrap_or_default(), offline)
}

#[tauri::command]
pub async fn workspaces(host: State<'_, Host>) -> Result<Workspaces> {
    let (entries, offline) = entries(&host.home).await;
    let backups = workspace::backups(&host.home)
        .into_iter()
        .map(|b| BackupRow {
            name: b.name,
            path: b.path,
            size: human_size(b.size),
            modified_ms: b.modified.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()),
        })
        .collect();
    Ok(Workspaces { rows: entries.iter().map(Row::from).collect(), backups, offline })
}

/// 打开 / 在 Finder 中显示.
#[tauri::command]
pub fn reveal(path: PathBuf, app: AppHandle) -> Result<()> {
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// 改回托管 (`/cd @bot --reset`).
#[tauri::command]
pub async fn reset_cd(group_id: String, bot_id: String) -> Result<()> {
    let config = Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?;
    workspace::reset_cd(&config, &group_id, &bot_id).await.map_err(|e| format!("{e:#}"))
}

/// Deletes the listed entry at `path`, re-checked against a fresh listing so only removed / unused managed dirs go.
#[tauri::command]
pub async fn delete_workspace(group_id: String, bot_id: String, path: PathBuf, host: State<'_, Host>) -> Result<()> {
    let (entries, _) = entries(&host.home).await;
    let entry = entries
        .iter()
        .find(|e| e.group_id == group_id && e.bot_id == bot_id && e.path == path)
        .ok_or(tr!("工作区不存在或已变化，请刷新"))?;
    workspace::delete(&host.home, entry)
}

/// 概览 · 工作区: `5 个` / `托管 4 · 本机目录 1 · 1.8 GB` (托管 includes removed dirs still on disk).
pub fn summary(entries: &[Entry]) -> (usize, String) {
    let cd = entries.iter().filter(|e| e.kind == EntryKind::Cd).count();
    let size: u64 = entries.iter().filter_map(|e| e.size).sum();
    (
        entries.len(),
        tr!("托管 {managed} · 本机目录 {cd} · {size}", managed = entries.len() - cd, cd = cd, size = human_size(size)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: EntryKind, size: Option<u64>, state: EntryState) -> Entry {
        Entry {
            group_id: "g".into(),
            group_name: Some("支付服务重构".into()),
            dm: false,
            bot_id: "b".into(),
            bot_name: None,
            kind,
            path: "/x".into(),
            size,
            state,
        }
    }

    #[test]
    fn summarizes_counts_by_kind_and_total_size() {
        gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
        let entries = [
            entry(EntryKind::Managed, Some(1_200_000_000), EntryState::Running),
            entry(EntryKind::Empty, Some(0), EntryState::Idle),
            entry(EntryKind::Cd, None, EntryState::Idle),
            entry(EntryKind::Managed, Some(600_000_000), EntryState::Removed),
        ];
        assert_eq!(summary(&entries), (4, "托管 3 · 本机目录 1 · 1.8 GB".into()));
        assert_eq!(summary(&[]), (0, "托管 0 · 本机目录 0 · 0 B".into()));
    }

    #[test]
    fn rows_carry_the_prototype_labels() {
        gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
        let row = Row::from(&entry(EntryKind::Managed, Some(412_000_000), EntryState::Removed));
        assert_eq!((row.group.as_str(), row.bot.as_str()), ("支付服务重构", "b"));
        assert_eq!((row.kind_label, row.state_label.as_str(), row.deletable), ("托管", "已移出 · 412 MB", true));
    }
}
