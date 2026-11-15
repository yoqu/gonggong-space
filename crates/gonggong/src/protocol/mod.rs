//! Wire types mirrored from `packages/protocol/src/{common,daemon}.ts`.
//! `tests/contract.rs` round-trips every shared JSON fixture to keep both sides aligned.
pub use crate::agent_settings::{AgentSettings, CliSettingsSnapshot, RunSettingsSnapshot};
pub use crate::ccswitch::CandidateView;
pub use crate::config::Mirror;
pub use crate::providers::{ModelMap, Preset, StoreView};
pub use crate::tools::{ToolKind, ToolStatus as ToolState};
use serde::{Deserialize, Serialize};

mod agent_tools;
mod common;
mod d2s;
mod git;
mod machine;
mod rest;
mod run;
mod run_payloads;
mod s2d;
mod services;
mod sync;
mod terminal;
#[cfg(test)]
mod tests;

pub use agent_tools::*;
pub use common::*;
pub use d2s::*;
pub use git::*;
pub use machine::*;
pub use rest::*;
pub use run::*;
pub use run_payloads::*;
pub use s2d::*;
pub use services::*;
pub use sync::*;
pub use terminal::*;
