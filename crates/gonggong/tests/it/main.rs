// One test binary instead of one per file: each extra binary is linked separately and, on macOS, scanned on its first
// launch. Tests that change process-wide state (env vars, the global tracing subscriber) or need the process-wide HTTP
// client to themselves (tls: its paused-clock timeouts) stay in their own tests/*.rs.
mod attachments;
mod bind;
mod bots;
mod cast;
mod contract;
mod daemon;
mod engine;
mod git_identity;
mod git_ops;
mod git_ops3;
mod git_ops4;
mod git_ops4_r2;
mod git_ops4_r3;
mod git_ops4_r4;
mod git_ops5;
mod hosted;
mod html_render;
mod net;
mod plugins;
mod providers_run;
mod secrets;
mod service;
mod skills;
mod sync;
mod sync_round;
mod tools;
mod tunnel;
mod upgrade;
mod workspace;
