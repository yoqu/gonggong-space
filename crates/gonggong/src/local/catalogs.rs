//! Probed model catalogs, cached per agent and per local Claude profile.
use crate::protocol::{AgentCatalog, AgentKind};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A probed catalog and the adapter + CLI build and CLI config it came from (`agents::catalog_key`); any change is probed
/// again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedCatalog {
    pub key: String,
    pub catalog: AgentCatalog,
}

fn catalogs_path(home: &Path) -> PathBuf {
    home.join("models.json")
}

/// Catalogs of local Claude profiles (a provider's own `CLAUDE_CONFIG_DIR`), by provider id; older files were by
/// directory, which no id matches.
fn profile_catalogs_path(home: &Path) -> PathBuf {
    home.join("profile-models.json")
}

/// Empty until an adapter was probed here; a file in an older format reads as empty too.
pub fn load_catalogs(home: &Path) -> BTreeMap<AgentKind, CachedCatalog> {
    load_json(&catalogs_path(home))
}

pub fn load_profile_catalogs(home: &Path) -> BTreeMap<String, CachedCatalog> {
    load_json(&profile_catalogs_path(home))
}

fn load_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// The daemon and the desktop app may probe concurrently; their read-modify-write must not interleave.
static CATALOGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn save_catalog(home: &Path, kind: AgentKind, cached: CachedCatalog) -> Result<()> {
    save_entry(home, &catalogs_path(home), kind, cached)
}

pub fn save_profile_catalog(home: &Path, provider: &str, cached: CachedCatalog) -> Result<()> {
    save_entry(home, &profile_catalogs_path(home), provider.to_string(), cached)
}

fn save_entry<K: Ord + Serialize + serde::de::DeserializeOwned>(
    home: &Path,
    path: &Path,
    key: K,
    cached: CachedCatalog,
) -> Result<()> {
    let _guard = CATALOGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all: BTreeMap<K, CachedCatalog> = load_json(path);
    all.insert(key, cached);
    std::fs::create_dir_all(home)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&all)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
