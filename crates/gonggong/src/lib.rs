pub mod adapters;
pub mod agent_settings;
pub mod agents;
pub mod antigravity;
pub mod artifacts;
pub mod ask;
pub mod attachments;
pub mod autostart;
pub mod bind;
pub mod bots;
pub mod cast;
pub mod ccswitch;
pub mod claude_args;
pub mod coalesce;
pub mod config;
pub mod configure;
pub mod connectors;
pub mod daemon;
pub mod diag;
pub mod engine;
pub mod explorer;
pub mod files;
pub mod git;
pub mod git_access;
mod git_console;
pub mod git_ops;
pub mod git_write;
pub mod hosted;
pub mod html_render;
pub mod i18n;
pub mod inject;
pub mod janitor;
pub mod layout;
pub mod ledger;
pub mod local;
pub mod lock;
pub mod logs;
pub mod manage;
pub mod mcp_call;
pub mod mcp_tools;
pub mod net;
pub mod open_apps;
pub mod permission;
pub mod plugins;
pub mod previews;
pub mod proc;
pub mod protocol;
pub mod provider_cli;
pub mod providers;
pub mod providers_migrate;
mod replicas;
pub mod repo;
pub mod revoke;
pub mod service;
mod session;
pub mod skills;
pub mod snapshot;
pub mod static_site;
pub mod status;
pub mod sync;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub mod terminal;
pub mod tls;
pub mod tools;
pub mod tunnel;
pub mod turn;
pub mod upgrade;
pub mod web_call;
pub mod wechatide;
pub mod workspace;

fn display_width(s: &str) -> usize {
    s.chars()
        .map(|c| match c as u32 {
            0x1100..=0x115F
            | 0x2E80..=0x303E
            | 0x3040..=0xA4CF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0xFE10..=0xFE6F
            | 0xFF01..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x20000..=0x3FFFD => 2,
            _ => 1,
        })
        .sum()
}

/// Formats rows into left-aligned columns separated by two spaces, accounting for CJK double-width characters.
pub fn format_columns<S: AsRef<str>>(rows: &[Vec<S>]) -> Vec<String> {
    let mut widths: Vec<usize> = vec![];
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            let w = display_width(cell.as_ref());
            if i == widths.len() {
                widths.push(w);
            } else {
                widths[i] = widths[i].max(w);
            }
        }
    }
    rows.iter()
        .map(|row| {
            let mut out = String::new();
            for (i, cell) in row.iter().enumerate() {
                let s = cell.as_ref();
                if i > 0 {
                    out.push_str("  ");
                }
                out.push_str(s);
                if i + 1 < row.len() {
                    let pad = widths[i].saturating_sub(display_width(s));
                    for _ in 0..pad {
                        out.push(' ');
                    }
                }
            }
            out
        })
        .collect()
}
