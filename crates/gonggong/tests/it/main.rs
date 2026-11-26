// One test binary instead of one per file: each extra binary is linked separately and, on macOS, scanned on its first
// launch. Tests that change process-wide state (env vars, the global tracing subscriber) or need the process-wide HTTP
// client to themselves (tls: its paused-clock timeouts) stay in their own tests/*.rs.
mod artifacts;
mod attachments;
mod bind;
mod bots;
#[cfg(unix)]
mod connectors;
mod contract;
mod daemon;
mod engine;
mod gemini;
mod git_identity;
mod git_ops;
mod git_ops3;
mod git_ops4;
mod git_ops4_r2;
mod git_ops4_r3;
mod git_ops4_r4;
mod git_ops5;
mod github_update;
mod hosted;
mod html_render;
mod link;
mod native_agents;
mod net;
mod plugins;
mod providers_run;
mod real_gate;
mod secrets;
mod service;
mod sites;
mod skills;
mod sync;
mod sync_round;
mod tools;
mod tunnel;
mod upgrade;
mod workspace;
