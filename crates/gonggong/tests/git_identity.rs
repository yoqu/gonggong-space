//! The bot's git identity reaches the agent process (plan G3), against the mock ACP agent.
#[path = "support/provider_rig.rs"]
mod provider_rig;

use gonggong::config::Settings;
use gonggong::protocol::*;
use provider_rig::*;
use serde_json::json;
use std::time::Duration;

fn with_git(s: RunStart) -> RunStart {
    let git = Some(GitIdentity { name: "小王".into(), email: "b1@bots.gonggong.local".into() });
    RunStart { bot: RunBot { git, ..s.bot.clone() }, ..s }
}

#[tokio::test]
async fn author_and_committer_are_the_bot_and_win_over_the_user_env() {
    let mut r = rig(Duration::from_secs(60));
    let mut settings = Settings::default();
    settings.env.insert("GIT_AUTHOR_NAME".into(), "主人".into());
    settings.save(r.home()).unwrap();
    for (run, kind) in [("r1", AgentKind::Claude), ("r2", AgentKind::Codex)] {
        let s = with_git(start(run, kind));
        r.run(RunStart { bot: RunBot { id: run.into(), ..s.bot.clone() }, ..s });
        assert_eq!(
            echo(&r.finish(run).await)["gitEnv"],
            json!({
                "GIT_AUTHOR_NAME": "小王",
                "GIT_AUTHOR_EMAIL": "b1@bots.gonggong.local",
                "GIT_COMMITTER_NAME": "小王",
                "GIT_COMMITTER_EMAIL": "b1@bots.gonggong.local",
            })
        );
    }
}

#[tokio::test]
async fn no_identity_leaves_git_to_the_machine_config() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", AgentKind::Claude));
    let e = echo(&r.finish("r1").await);
    assert!(e["gitEnv"].as_object().unwrap().values().all(|v| v.is_null()));
}
