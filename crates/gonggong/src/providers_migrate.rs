//! providers.json v1 → v2 (docs/plan/Agent管理重构-施工设计.md §3): v1 kept one provider per agent, v2 keeps vendors
//! with an endpoint per protocol. Copies of one vendor (same key, host and proxy, D2) merge; a local Claude profile
//! never does. The v1 file is kept byte for byte next to it (D4).
use crate::agent_settings::AgentSettings;
use crate::protocol::{AgentKind, ApiProtocol};
use crate::providers::{
    self, AgentDefault, Endpoint, ModelMap, OFFICIAL, Official, Provider, SessionPin, Source, Store, VERSION,
};
use crate::t;
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};

/// A v1 providers.json.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LegacyStore {
    pub machine: BTreeMap<AgentKind, String>,
    pub official: BTreeMap<AgentKind, Official>,
    pub bots: BTreeMap<String, String>,
    pub providers: Vec<LegacyProvider>,
    pub agent_settings: BTreeMap<AgentKind, AgentSettings>,
    pub sessions: BTreeMap<String, SessionPin>,
}

/// A v1 provider: one agent, one endpoint.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProvider {
    pub id: String,
    pub agent: AgentKind,
    pub name: String,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub revision: u32,
    #[serde(default)]
    pub config_dir: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_key_field: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub models: Option<ModelMap>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub wire_api: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub source: Option<Source>,
}

/// What a migration did, by provider id (never a key).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    /// Where the v1 file was copied to (set when the file is written).
    pub backup: Option<PathBuf>,
    /// (old id, the provider it merged into).
    pub merged: Vec<(String, String)>,
    /// Same vendor, but another URL for a protocol already taken: kept as a provider of its own.
    pub split: Vec<String>,
    /// Providers of agents that keep their own login (no protocol): dropped.
    pub dropped: Vec<String>,
}

/// providers.json as read: v2 as is, v1 migrated in memory (with what the migration did).
pub fn parse(bytes: &[u8]) -> Result<(Store, Option<Report>)> {
    let value: serde_json::Value = serde_json::from_slice(bytes).context(t!("providers.json 已损坏"))?;
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(v) if v == u64::from(VERSION) => {
            Ok((serde_json::from_value(value).context(t!("providers.json 已损坏"))?, None))
        }
        Some(v) => bail!(t!("providers.json 的版本 {v} 比这个客户端新，请升级共工客户端", v = v)),
        None => {
            let (store, report) = migrate(serde_json::from_value(value).context(t!("providers.json 已损坏"))?);
            Ok((store, Some(report)))
        }
    }
}

/// Reads `<home>/providers.json`, first writing a v1 file as v2 after copying it byte for byte to
/// `providers.v1.json` (or `providers.v1.<unix_ms>.json` when that exists). The caller holds `providers.lock`. The
/// report: what a migration did; None when there was nothing to migrate.
pub(crate) fn load_migrated(home: &Path) -> Result<(Store, Option<Report>)> {
    let bytes = match std::fs::read(Store::path(home)) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((Store::default(), None)),
        Err(e) => return Err(e.into()),
    };
    let (store, report) = parse(&bytes)?;
    let Some(mut report) = report else { return Ok((store, None)) };
    let backup = write_backup(home, &bytes)?;
    store.save(home)?;
    tracing::info!(
        backup = %backup.display(),
        merged = ?report.merged,
        split = ?report.split,
        dropped = ?report.dropped,
        "providers.json migrated to v2"
    );
    report.backup = Some(backup);
    Ok((store, Some(report)))
}

/// Owner-only from the first byte, never over an existing file, on disk before the original is replaced.
fn write_backup(home: &Path, bytes: &[u8]) -> Result<PathBuf> {
    let ms = chrono::Utc::now().timestamp_millis();
    let names =
        std::iter::once("providers.v1.json".to_string()).chain((0..).map(|i| format!("providers.v1.{}.json", ms + i)));
    for name in names {
        let path = home.join(name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = match options.open(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            opened => opened?,
        };
        file.write_all(bytes)?;
        file.sync_all()?;
        return Ok(path);
    }
    unreachable!("an unbounded list of names")
}

/// A provider of a group, its position in the file and the protocol it becomes an endpoint of.
type Member = (usize, LegacyProvider, ApiProtocol);

#[derive(PartialEq, Eq)]
enum Group {
    /// A local profile: never merged.
    Own(String),
    Vendor {
        key: String,
        host: String,
        proxy: Option<String>,
    },
}

/// v1 → v2 (§3): each provider becomes an endpoint of its agent's first protocol; copies of one vendor merge into
/// the one machine defaults, bots and sessions use most, references to the others follow it.
pub fn migrate(v1: LegacyStore) -> (Store, Report) {
    let LegacyStore { machine, official, bots, providers, agent_settings, sessions } = v1;
    let rank = |id: &str| {
        if machine.values().any(|v| v == id) {
            0
        } else if bots.values().any(|v| v == id) {
            1
        } else if sessions.values().any(|s| s.provider == id) {
            2
        } else {
            3
        }
    };
    let mut report = Report::default();
    let mut groups: Vec<(Group, Vec<Member>)> = vec![];
    for (i, p) in providers.into_iter().enumerate() {
        let Some(&protocol) = p.agent.protocols().first() else {
            report.dropped.push(p.id);
            continue;
        };
        let group = match &p.config_dir {
            Some(_) => Group::Own(p.id.clone()),
            None => {
                Group::Vendor { key: p.api_key.clone(), host: providers::host(&p.base_url), proxy: p.proxy.clone() }
            }
        };
        match groups.iter_mut().find(|(g, _)| *g == group) {
            Some((_, members)) => members.push((i, p, protocol)),
            None => groups.push((group, vec![(i, p, protocol)])),
        }
    }
    let mut alias: HashMap<String, String> = HashMap::new();
    let mut out = vec![];
    for (_, mut members) in groups {
        let manifest = |a: AgentKind| !matches!(a, AgentKind::Claude | AgentKind::Codex);
        members.sort_by_key(|(i, p, _)| (rank(&p.id), manifest(p.agent), Reverse(p.revision), *i));
        let mut members = members.into_iter().map(|(_, p, protocol)| (endpoint(&p, protocol), p));
        let (first, p) = members.next().expect("a group has a member");
        let mut winner = provider(&p, first);
        let mut revision = p.revision;
        alias.insert(p.id.clone(), p.id.clone());
        let mut split = vec![];
        for (e, p) in members {
            match winner.endpoint_mut(e.protocol) {
                Some(taken) if !taken.same_url(&e.base_url) => {
                    report.split.push(p.id.clone());
                    alias.insert(p.id.clone(), p.id.clone());
                    split.push(Provider { revision: p.revision + 1, ..provider(&p, e) });
                    continue;
                }
                Some(taken) => fill(taken, e),
                None => winner.endpoints.push(e),
            }
            revision = revision.max(p.revision);
            winner.preset_id = winner.preset_id.or(p.preset_id);
            report.merged.push((p.id.clone(), winner.id.clone()));
            alias.insert(p.id, winner.id.clone());
        }
        winner.revision = revision + 1;
        out.push(winner);
        out.extend(split);
    }
    let follow = |id: &str| if id == OFFICIAL { Some(OFFICIAL.to_string()) } else { alias.get(id).cloned() };
    let machine = machine
        .into_iter()
        .filter_map(|(agent, id)| Some((agent, AgentDefault { provider: follow(&id)?, model: None })))
        .collect();
    let bots = bots
        .into_iter()
        .filter(|(_, id)| !report.dropped.contains(id))
        .map(|(bot, id)| (bot, follow(&id).unwrap_or(id)))
        .collect();
    let sessions = sessions
        .into_iter()
        .map(|(sid, pin)| (sid, SessionPin { provider: follow(&pin.provider).unwrap_or(pin.provider.clone()), ..pin }))
        .collect();
    let store = Store { machine, official, bots, providers: out, agent_settings, sessions };
    (store, report)
}

fn endpoint(p: &LegacyProvider, protocol: ApiProtocol) -> Endpoint {
    Endpoint {
        protocol,
        base_url: p.base_url.clone(),
        api_key_field: p.api_key_field.clone(),
        model: p.model.clone(),
        models: p.models.clone(),
        env: p.env.clone(),
        args: p.args.clone(),
        wire_api: p.wire_api.clone(),
        effort: p.effort.clone(),
        config_dir: p.config_dir.clone(),
        executable_path: p.executable_path.clone(),
    }
}

fn provider(p: &LegacyProvider, endpoint: Endpoint) -> Provider {
    Provider {
        id: p.id.clone(),
        name: p.name.clone(),
        preset_id: p.preset_id.clone(),
        revision: p.revision,
        api_key: p.api_key.clone(),
        proxy: p.proxy.clone(),
        source: p.source.clone(),
        endpoints: vec![endpoint],
    }
}

/// The same protocol at the same URL: the loser only fills what the winner left empty.
fn fill(e: &mut Endpoint, from: Endpoint) {
    e.model = e.model.take().or(from.model);
    e.models = e.models.take().or(from.models);
    e.api_key_field = e.api_key_field.take().or(from.api_key_field);
    e.wire_api = e.wire_api.take().or(from.wire_api);
    e.effort = e.effort.take().or(from.effort);
    for (k, v) in from.env {
        e.env.entry(k).or_insert(v);
    }
}

#[cfg(test)]
mod tests;
