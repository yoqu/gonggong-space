use super::*;
use std::io::Write;

// Steps as Antigravity CLI 1.5.10 writes them (trimmed from a real conversation).
const MAIN: &str = "11111111-1111-1111-1111-111111111111";
const SUB: &str = "22222222-2222-2222-2222-222222222222";

fn spawn_step(index: u64) -> String {
    let call = |name: &str, args: Value| serde_json::json!({ "name": name, "args": args });
    serde_json::json!({
        "step_index": index, "source": "MODEL", "type": "PLANNER_RESPONSE", "status": "DONE",
        "tool_calls": [
            call("invoke_subagent", serde_json::json!({
                "Prompt": "\"列出目录文件\"", "Role": "\"File Lister\"", "TypeName": "\"self\""
            })),
            call("run_command", serde_json::json!({
                "CommandLine": "\"sleep 40; echo bg-done\"", "IsDaemon": "false", "WaitMsBeforeAsync": "500"
            })),
        ]
    })
    .to_string()
}

fn generic(index: u64, status: &str, content: &str) -> String {
    serde_json::json!({ "step_index": index, "source": "MODEL", "type": "GENERIC", "status": status, "content": content })
        .to_string()
}

fn system(index: u64, sender: &str, content: &str) -> String {
    let body = format!(
        "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] \
         timestamp=2026-11-19T02:10:44Z sender={sender} priority=MESSAGE_PRIORITY_HIGH content={content}\n</SYSTEM_MESSAGE>"
    );
    serde_json::json!({ "step_index": index, "source": "SYSTEM", "type": "SYSTEM_MESSAGE", "status": "DONE", "content": body })
        .to_string()
}

fn created(index: u64, id: &str) -> String {
    generic(
        index,
        "DONE",
        &format!(
            "Created At: 2026-11-18T18:10:00-08:00\nCreated the following subagent:\n{{\n  \"conversationId\":  \"{id}\",\n  \
             \"workspaceUris\":  [\n    \"file:///tmp/ws\"\n  ]\n}}\nThe subagent will send you a message when it has \
             completed its task or requires guidance."
        ),
    )
}

fn background(index: u64) -> String {
    generic(
        index,
        "RUNNING",
        &format!(
            "Created At: 2026-11-18T18:10:00-08:00\nTool is running as a background task with task id: {MAIN}/task-3\n\
             Task Description: sleep 40; echo bg-done\nTask logs are available at: file:///tmp/task-3.log"
        ),
    )
}

struct Brain(tempfile::TempDir);

impl Brain {
    fn new() -> Self {
        Brain(tempfile::tempdir().unwrap())
    }

    fn append(&self, conversation: &str, lines: &[String]) {
        let path = transcript(self.0.path(), conversation);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
    }
}

fn events(emits: Vec<Emit>) -> Vec<RunEvent> {
    emits.into_iter().map(|e| e.event).collect()
}

#[test]
fn a_subagent_and_a_background_command_are_reported_with_their_ends() {
    let brain = Brain::new();
    brain.append(MAIN, &[generic(0, "DONE", "an earlier turn: not this process's")]);
    let mut t = Transcripts::new(brain.0.path().into(), MAIN);
    assert!(t.poll().is_empty());

    brain.append(MAIN, &[spawn_step(1), created(2, SUB), background(3)]);
    let emits = t.poll();
    assert_eq!(emits.len(), 2);
    assert_eq!((emits[0].key.as_str(), emits[0].parent.as_deref(), emits[0].live), (SUB, None, Some(true)));
    assert_eq!(
        emits[0].event,
        RunEvent::Subagent {
            agent_id: SUB.into(),
            parent_id: None,
            name: "File Lister".into(),
            task: "列出目录文件".into(),
            state: SubagentState::Running,
        }
    );
    assert!(matches!(&emits[0].orphan, Some(RunEvent::Subagent { state: SubagentState::Disconnected, .. })));
    let task_id = format!("{MAIN}/task-3");
    assert_eq!(emits[1].key, task_id);
    assert!(matches!(
        &emits[1].event,
        RunEvent::Task { name, state: TaskState::Running, can_stop: false, .. } if name == "sleep 40; echo bg-done"
    ));
    assert!(matches!(&emits[1].orphan, Some(RunEvent::Task { state: TaskState::Stopped, .. })));

    // The subagent's own process, its report as its last words.
    let sub_steps = [
        system(0, MAIN, "列出目录文件"),
        serde_json::json!({
            "step_index": 1, "type": "PLANNER_RESPONSE", "status": "DONE", "thinking": "Listing the files.",
            "tool_calls": [{ "name": "run_command", "args": { "CommandLine": "\"ls -a\"", "toolSummary": "\"List files\"" } }]
        })
        .to_string(),
        generic(2, "DONE", "Command exited with code 0."),
        serde_json::json!({
            "step_index": 3, "type": "PLANNER_RESPONSE", "status": "DONE",
            "tool_calls": [{ "name": "send_message", "args": { "Message": "\"一共 2 个文件\"", "Recipient": format!("\"{MAIN}\"") } }]
        })
        .to_string(),
        generic(4, "DONE", "Message sent."),
    ];
    assert!(!t.idle);
    brain.append(SUB, &sub_steps);
    let emits = t.poll();
    assert!(emits.iter().all(|e| e.key == SUB && e.live.is_none()));
    let id = format!("{SUB}/1/0");
    assert_eq!(
        events(emits),
        vec![
            RunEvent::Thought { delta: "Listing the files.".into(), agent_id: Some(SUB.into()) },
            tool(SUB, id.clone(), "List files".into(), "execute", ToolStatus::InProgress, Some("$ ls -a".into())),
            tool(SUB, id, "List files".into(), "execute", ToolStatus::Completed, Some("$ ls -a".into())),
            RunEvent::Text { delta: "\n\n一共 2 个文件".into(), agent_id: Some(SUB.into()) },
        ]
    );

    brain.append(
        MAIN,
        &[
            system(4, &task_id, &format!("Task id \"{task_id}\" finished with result:\nCommand exited with code 0.\n\nCommand output:\nbg-done\r\n\nLog: file:///tmp/task-3.log")),
            system(5, SUB, "一共 2 个文件"),
        ],
    );
    let emits = t.poll();
    assert_eq!(emits.len(), 2);
    assert_eq!((emits[0].key.as_str(), emits[0].live), (task_id.as_str(), Some(false)));
    assert!(matches!(
        &emits[0].event,
        RunEvent::Task { state: TaskState::Completed, summary: Some(s), .. } if s.ends_with("bg-done")
    ));
    assert_eq!((emits[1].key.as_str(), emits[1].live), (SUB, Some(false)));
    assert!(matches!(&emits[1].event, RunEvent::Subagent { state: SubagentState::Completed, .. }));
    assert!(!t.idle, "woken by the messages");

    // Its closing words after the report do not take it back to work; a new message does.
    let closing =
        serde_json::json!({ "step_index": 5, "type": "PLANNER_RESPONSE", "status": "DONE", "content": "已回报" });
    brain.append(SUB, &[closing.to_string()]);
    let emits = t.poll();
    assert!(emits.iter().all(|e| matches!(e.event, RunEvent::Text { .. }) && e.live.is_none()));
    brain.append(SUB, &[system(6, MAIN, "再看一下隐藏文件")]);
    let emits = t.poll();
    assert!(matches!(
        &emits[..],
        [Emit { event: RunEvent::Subagent { state: SubagentState::Running, .. }, live: Some(true), .. }]
    ));
    brain.append(MAIN, &[system(7, SUB, "也没有隐藏文件")]);
    assert!(matches!(&t.poll()[..], [Emit { live: Some(false), .. }]));

    let answered =
        serde_json::json!({ "step_index": 6, "type": "PLANNER_RESPONSE", "status": "DONE", "content": "都完成了" });
    brain.append(MAIN, &[answered.to_string()]);
    assert!(t.poll().is_empty(), "the main agent's text comes over ACP");
    assert!(t.idle);
}

#[test]
fn a_failed_command_a_killed_subagent_and_a_step_written_in_two_parts() {
    let brain = Brain::new();
    let mut t = Transcripts::new(brain.0.path().into(), MAIN);
    brain.append(MAIN, &[spawn_step(1), created(2, SUB), background(3)]);
    assert_eq!(t.poll().len(), 2);

    let killed =
        generic(6, "DONE", "Successfully killed 1 subagent(s) and their descendants.\nKilled roles: File Lister");
    let task_id = format!("{MAIN}/task-3");
    let ended = system(
        7,
        &task_id,
        &format!("Task id \"{task_id}\" finished with result:\nCommand exited with code 2.\n\nLog: x"),
    );
    let path = transcript(brain.0.path(), MAIN);
    let text = format!("{killed}\n{ended}\n");
    let (head, rest) = text.split_at(text.len() - 20);
    std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(head.as_bytes()).unwrap();
    let emits = t.poll();
    assert_eq!(emits.len(), 1);
    assert!(matches!(&emits[0].event, RunEvent::Subagent { state: SubagentState::Cancelled, .. }));

    std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(rest.as_bytes()).unwrap();
    let emits = t.poll();
    assert!(matches!(&emits[..], [Emit { event: RunEvent::Task { state: TaskState::Failed, .. }, .. }]));
}

#[test]
fn a_subagent_spawned_by_a_subagent_reports_to_its_parent() {
    let brain = Brain::new();
    let mut t = Transcripts::new(brain.0.path().into(), MAIN);
    brain.append(MAIN, &[spawn_step(1), created(2, SUB)]);
    t.poll();
    let nested = "33333333-3333-3333-3333-333333333333";
    brain.append(SUB, &[spawn_step(1), created(2, nested)]);
    let emits = t.poll();
    let spawn = emits.iter().find(|e| e.key == nested).unwrap();
    assert_eq!(spawn.parent.as_deref(), Some(SUB));
    assert!(matches!(&spawn.event, RunEvent::Subagent { parent_id: Some(p), .. } if p == SUB));
}
