//! Antigravity CLI has no ACP extension for its subagents and background tasks: over ACP a subagent is only an
//! `invoke_subagent` call that returns at once, and a command gone to the background is a `run_command` left open
//! (its end comes after the turn, unannounced). What became of them is in the agent's own transcripts,
//! `<home>/brain/<conversation>/.system_generated/logs/transcript.jsonl` (one step per line, appended), read here as
//! they grow and told as the subagent and task events Claude Code and Codex send.
use crate::protocol::{RunEvent, SubagentState, TaskState, ToolStatus};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

const POLL: Duration = Duration::from_millis(500);
const DETAIL_MAX: usize = 200;
const TEXT_MAX: usize = 8000;
const SUMMARY_MAX: usize = 1500;

#[derive(Deserialize)]
struct Step {
    #[serde(default)]
    step_index: u64,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    thinking: String,
    #[serde(default)]
    tool_calls: Vec<Call>,
}

#[derive(Deserialize)]
struct Call {
    name: String,
    #[serde(default)]
    args: Map<String, Value>,
}

impl Call {
    /// Argument values are written JSON-encoded (`"\"ls\""`).
    fn arg(&self, key: &str) -> Option<String> {
        let v = self.args.get(key)?;
        let decoded = v.as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()).unwrap_or_else(|| v.clone());
        match decoded {
            Value::String(s) => Some(s),
            Value::Null => None,
            other => Some(other.to_string()),
        }
    }
}

/// What a transcript step tells, for the run that owns `key` (a subagent's conversation id or a task id).
#[derive(Debug, PartialEq)]
pub struct Emit {
    pub key: String,
    /// The subagent whose run takes a new `key`; None: the conversation's current run.
    pub parent: Option<String>,
    pub event: RunEvent,
    /// Whether `key` is still at work after this; None leaves it as it was.
    pub live: Option<bool>,
    /// For a new `key`: what to report if the adapter process goes away while it is at work.
    pub orphan: Option<RunEvent>,
}

#[derive(Clone)]
struct Sub {
    parent: Option<String>,
    role: String,
    task: String,
    state: SubagentState,
}

struct File {
    path: PathBuf,
    /// The subagent conversation it belongs to; None for the main agent's.
    sub: Option<String>,
    offset: u64,
    partial: Vec<u8>,
    /// `invoke_subagent` calls (role, prompt) waiting for the step naming the subagent they created.
    spawns: VecDeque<(String, String)>,
    /// A subagent's calls waiting for their result steps (None: not shown as a tool).
    calls: VecDeque<Option<Pending>>,
}

struct Pending {
    id: String,
    title: String,
    kind: &'static str,
    detail: Option<String>,
}

/// One conversation's transcripts: the main agent's and those of the subagents spawned in it.
pub struct Transcripts {
    brain: PathBuf,
    files: Vec<File>,
    subs: HashMap<String, Sub>,
    tasks: HashMap<String, (Option<String>, String)>,
    /// The main agent's last step was a response calling no tool: it is waiting (for a message, or the user).
    pub idle: bool,
}

pub fn transcript(brain: &Path, conversation: &str) -> PathBuf {
    brain.join(conversation).join(".system_generated/logs/transcript.jsonl")
}

impl Transcripts {
    /// Follows conversation `main` from its current end: what it did before is not this process's.
    pub fn new(brain: PathBuf, main: &str) -> Self {
        let path = transcript(&brain, main);
        let offset = std::fs::metadata(&path).map_or(0, |m| m.len());
        let file = File { path, sub: None, offset, partial: vec![], spawns: [].into(), calls: [].into() };
        Transcripts { brain, files: vec![file], subs: HashMap::new(), tasks: HashMap::new(), idle: false }
    }

    /// What the transcripts gained since the last poll.
    pub fn poll(&mut self) -> Vec<Emit> {
        let mut out = vec![];
        let mut i = 0;
        while i < self.files.len() {
            for line in read_lines(&mut self.files[i]) {
                match serde_json::from_str::<Step>(&line) {
                    Ok(step) => self.step(i, step, &mut out),
                    Err(e) => tracing::debug!("unreadable antigravity transcript step: {e}"),
                }
            }
            i += 1;
        }
        out
    }

    fn step(&mut self, i: usize, step: Step, out: &mut Vec<Emit>) {
        let agent = self.files[i].sub.clone();
        if agent.is_none() {
            self.idle = step.kind == "PLANNER_RESPONSE" && step.tool_calls.is_empty();
        }
        match step.kind.as_str() {
            "PLANNER_RESPONSE" => self.planned(i, step, out),
            "SYSTEM_MESSAGE" => {
                // A subagent that reported is at work again once told something more (it asked for guidance).
                if let Some(agent) = agent
                    && let Some(s) = self.subs.get_mut(&agent)
                    && s.state == SubagentState::Completed
                {
                    s.state = SubagentState::Running;
                    let event = subagent(&agent, s);
                    out.push(Emit { key: agent, parent: None, event, live: Some(true), orphan: None });
                }
                self.message(&step.content, out)
            }
            "USER_INPUT" => {}
            _ => {
                self.result(agent.as_deref(), &step.content, out);
                let Some(agent) = agent else { return };
                let Some(Some(Pending { id, title, kind, detail })) = self.files[i].calls.pop_front() else { return };
                let status = match step.status.as_str() {
                    "ERROR" => ToolStatus::Failed,
                    "RUNNING" => ToolStatus::InProgress,
                    _ => ToolStatus::Completed,
                };
                let event = tool(&agent, id, title, kind, status, detail);
                out.push(Emit { key: agent, parent: None, event, live: None, orphan: None });
            }
        }
    }

    /// A model response: the calls it makes; a subagent's thoughts, text and calls are its process.
    fn planned(&mut self, i: usize, step: Step, out: &mut Vec<Emit>) {
        let agent = self.files[i].sub.clone();
        for c in step.tool_calls.iter().filter(|c| c.name == "invoke_subagent") {
            let role = c.arg("Role").or_else(|| c.arg("TypeName")).unwrap_or_else(|| "subagent".into());
            self.files[i].spawns.push_back((role, c.arg("Prompt").unwrap_or_default()));
        }
        let Some(agent) = agent else { return };
        let mut emit = |event| out.push(Emit { key: agent.clone(), parent: None, event, live: None, orphan: None });
        if !step.thinking.trim().is_empty() {
            emit(RunEvent::Thought { delta: clip(&step.thinking, TEXT_MAX), agent_id: Some(agent.clone()) });
        }
        if !step.content.trim().is_empty() {
            emit(RunEvent::Text { delta: clip(&step.content, TEXT_MAX), agent_id: Some(agent.clone()) });
        }
        for (n, c) in step.tool_calls.iter().enumerate() {
            // What a subagent tells its parent is its answer.
            if c.name == "send_message" {
                if let Some(m) = c.arg("Message") {
                    emit(RunEvent::Text { delta: clip(&format!("\n\n{m}"), TEXT_MAX), agent_id: Some(agent.clone()) });
                }
                self.files[i].calls.push_back(None);
                continue;
            }
            let id = format!("{agent}/{}/{n}", step.step_index);
            let title = c.arg("toolSummary").filter(|t| !t.trim().is_empty()).unwrap_or_else(|| c.name.clone());
            let kind = tool_kind(&c.name);
            let detail = c
                .arg("CommandLine")
                .map(|cmd| format!("$ {cmd}"))
                .or_else(|| c.arg("Path"))
                .map(|d| clip(&d, DETAIL_MAX));
            emit(tool(&agent, id.clone(), title.clone(), kind, ToolStatus::InProgress, detail.clone()));
            self.files[i].calls.push_back(Some(Pending { id, title, kind, detail }));
        }
    }

    /// A tool's result in the transcript of `agent` (None: the main agent): subagents created or killed, commands
    /// gone to the background.
    fn result(&mut self, agent: Option<&str>, content: &str, out: &mut Vec<Emit>) {
        if let Some((_, rest)) = content.split_once("Created the following subagent:")
            && let Some(id) = json_object(rest).and_then(|v| v["conversationId"].as_str().map(String::from))
        {
            let i = self.files.iter().position(|f| f.sub.as_deref() == agent).unwrap_or(0);
            let (role, task) = self.files[i].spawns.pop_front().unwrap_or_else(|| ("subagent".into(), String::new()));
            let sub = Sub {
                parent: agent.map(String::from),
                role,
                task: clip(&task, DETAIL_MAX),
                state: SubagentState::Running,
            };
            let event = subagent(&id, &sub);
            let orphan = Some(subagent(&id, &Sub { state: SubagentState::Disconnected, ..sub.clone() }));
            out.push(Emit { key: id.clone(), parent: sub.parent.clone(), event, live: Some(true), orphan });
            self.subs.insert(id.clone(), sub);
            let path = transcript(&self.brain, &id);
            let file = File { path, sub: Some(id), offset: 0, partial: vec![], spawns: [].into(), calls: [].into() };
            self.files.push(file);
        }
        if let Some((_, rest)) = content.split_once("Tool is running as a background task with task id: ") {
            let id = rest.lines().next().unwrap_or_default().trim().to_string();
            let name = rest.lines().find_map(|l| l.strip_prefix("Task Description: ")).unwrap_or_default().to_string();
            if !id.is_empty() {
                let event = task(&id, agent, &name, TaskState::Running, None);
                let orphan = Some(task(&id, agent, &name, TaskState::Stopped, None));
                let parent = agent.map(String::from);
                out.push(Emit { key: id.clone(), parent, event, live: Some(true), orphan });
                self.tasks.insert(id, (agent.map(String::from), name));
            }
        }
        if let Some((_, roles)) = content.split_once("Killed roles: ") {
            let roles: Vec<&str> = roles.lines().next().unwrap_or_default().split(", ").map(str::trim).collect();
            for (id, s) in self.subs.iter_mut() {
                if s.state == SubagentState::Running && roles.contains(&s.role.as_str()) {
                    s.state = SubagentState::Cancelled;
                    out.push(Emit {
                        key: id.clone(),
                        parent: None,
                        event: subagent(id, s),
                        live: Some(false),
                        orphan: None,
                    });
                }
            }
        }
    }

    /// A message to an agent: from a subagent, its report (done or asking for guidance); from a background task, its
    /// end.
    fn message(&mut self, content: &str, out: &mut Vec<Emit>) {
        let Some(sender) = content.split_once(" sender=").and_then(|(_, r)| r.split_whitespace().next()) else {
            return;
        };
        if let Some(s) = self.subs.get_mut(sender) {
            if s.state == SubagentState::Running {
                s.state = SubagentState::Completed;
                let event = subagent(sender, s);
                out.push(Emit { key: sender.into(), parent: None, event, live: Some(false), orphan: None });
            }
            return;
        }
        let Some((agent, name)) = self.tasks.remove(sender) else { return };
        let result = content.split_once("finished with result:\n").map_or("", |(_, r)| r);
        let result =
            result.split("\nLog: ").next().unwrap_or_default().split("\n</SYSTEM_MESSAGE>").next().unwrap_or_default();
        let failed = result
            .split_once("exited with code ")
            .and_then(|(_, r)| r.split(|c: char| !c.is_ascii_digit()).next()?.parse::<i64>().ok())
            .is_some_and(|code| code != 0);
        let state = if failed { TaskState::Failed } else { TaskState::Completed };
        let summary = Some(tail(result.trim(), SUMMARY_MAX)).filter(|s| !s.is_empty());
        let event = task(sender, agent.as_deref(), &name, state, summary);
        out.push(Emit { key: sender.into(), parent: None, event, live: Some(false), orphan: None });
    }
}

fn subagent(id: &str, s: &Sub) -> RunEvent {
    RunEvent::Subagent {
        agent_id: id.into(),
        parent_id: s.parent.clone(),
        name: s.role.clone(),
        task: s.task.clone(),
        state: s.state,
    }
}

fn task(id: &str, agent: Option<&str>, name: &str, state: TaskState, summary: Option<String>) -> RunEvent {
    RunEvent::Task {
        task_id: id.into(),
        agent_id: agent.map(String::from),
        tool_call_id: None,
        name: clip(name, DETAIL_MAX),
        task_type: "shell".into(),
        state,
        summary,
        output_path: None,
        can_stop: false,
    }
}

fn tool(agent: &str, id: String, title: String, kind: &str, status: ToolStatus, detail: Option<String>) -> RunEvent {
    RunEvent::Tool {
        agent_id: Some(agent.into()),
        tool_call_id: id,
        title,
        tool_kind: kind.into(),
        status,
        detail,
        mcp: None,
        web: None,
    }
}

fn tool_kind(name: &str) -> &'static str {
    match name {
        "run_command" => "execute",
        "read_file" | "view_file" | "list_dir" => "read",
        "write_to_file" | "replace_file_content" | "multi_replace_file_content" | "edit_file" => "edit",
        "grep_search" | "find_by_name" | "codebase_search" => "search",
        "search_web" | "read_url_content" => "fetch",
        _ => "other",
    }
}

/// The JSON object a text continues with (`{` … its matching `}`).
fn json_object(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    serde_json::Deserializer::from_str(&text[start..]).into_iter::<Value>().next()?.ok()
}

fn read_lines(f: &mut File) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(&f.path) else { return vec![] };
    let mut buf = Vec::new();
    if file.seek(SeekFrom::Start(f.offset)).is_err() || file.read_to_end(&mut buf).is_err() {
        return vec![];
    }
    f.offset += buf.len() as u64;
    f.partial.extend_from_slice(&buf);
    // A step being written is read whole next time.
    let Some(end) = f.partial.iter().rposition(|&b| b == b'\n') else { return vec![] };
    let rest = f.partial.split_off(end + 1);
    let done = std::mem::replace(&mut f.partial, rest);
    String::from_utf8_lossy(&done).lines().filter(|l| !l.trim().is_empty()).map(String::from).collect()
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn tail(s: &str, max: usize) -> String {
    let skip = s.chars().count().saturating_sub(max);
    s.chars().skip(skip).collect()
}

/// Polls conversation `main`'s transcripts while it lives; dropping it stops.
pub struct Watch(tokio::task::JoinHandle<()>);

impl Drop for Watch {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// `emit` gets what the transcripts tell, `idle` whether the main agent waits after each poll.
pub fn watch(
    brain: PathBuf,
    main: &str,
    mut emit: impl FnMut(Emit) + Send + 'static,
    mut idle: impl FnMut(bool) + Send + 'static,
) -> Watch {
    let mut t = Transcripts::new(brain, main);
    Watch(tokio::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            t.poll().into_iter().for_each(&mut emit);
            idle(t.idle);
        }
    }))
}

#[cfg(test)]
mod tests;
