use crate::protocol::{
    TERMINAL_MAX_BUFFERED_BYTES, TERMINAL_MAX_PER_MACHINE, TERMINAL_REPLAY_BYTES, TERMINAL_REPLAY_CHUNKS,
    TerminalClientControl, TerminalEndReason, TerminalHead, TerminalOpen, TerminalOpenAction, TerminalStatus,
};
use crate::workspace;
use hyper::body::Bytes;
use portable_pty::{CommandBuilder, ExitStatus, MasterPty, PtySize, PtySystem, native_pty_system};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{FromRawFd, OwnedFd};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{Mutex as AsyncMutex, mpsc, oneshot};

const CHUNK_SIZE: usize = 16 * 1024;
const COMMAND_QUEUE: usize = TERMINAL_MAX_BUFFERED_BYTES / CHUNK_SIZE / 2;
const OUTPUT_QUEUE: usize = TERMINAL_MAX_BUFFERED_BYTES / CHUNK_SIZE;

#[derive(Debug, Error)]
pub enum TerminalError {
    #[error("terminal_not_found")]
    NotFound,
    #[error("terminal_exists")]
    AlreadyExists,
    #[error("terminal_limit")]
    SessionLimit,
    #[error("replay_expired")]
    ReplayExpired,
    #[error("invalid_replay_cursor")]
    InvalidCursor,
    #[error("terminal_not_running")]
    NotRunning,
    #[error("workspace_not_found")]
    WorkspaceUnavailable,
    #[error("invalid_terminal_size")]
    InvalidSize,
    #[error("terminal_spawn_failed: {0}")]
    Spawn(String),
    #[error("terminal_io: {0}")]
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalOutput {
    pub seq: u64,
    pub data: Bytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalEvent {
    Output(TerminalOutput),
    Exit { next: u64, exit_code: Option<i32>, reason: TerminalEndReason },
}

pub struct TerminalAttachment {
    pub head: TerminalHead,
    pub replay: Vec<TerminalOutput>,
    pub events: mpsc::Receiver<TerminalEvent>,
    subscription: Option<Subscription>,
}

impl Drop for TerminalAttachment {
    fn drop(&mut self) {
        if let Some(subscription) = self.subscription.take() {
            subscription.state.lock().unwrap().subscribers.remove(&subscription.id);
        }
    }
}

struct Subscription {
    id: u64,
    state: Arc<Mutex<State>>,
}

#[derive(Clone)]
pub struct TerminalManager {
    home: PathBuf,
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    open_lock: Arc<AsyncMutex<()>>,
}

impl TerminalManager {
    pub fn new(home: PathBuf) -> Self {
        Self { home, sessions: Arc::default(), open_lock: Arc::default() }
    }

    /// Dropping the returned attachment only disconnects its web stream.
    pub async fn open(&self, open: TerminalOpen) -> Result<TerminalAttachment, TerminalError> {
        validate_size(open.cols, open.rows)?;
        let _guard = self.open_lock.lock().await;
        match open.action {
            TerminalOpenAction::Create => {
                if open.after != 0 {
                    return Err(TerminalError::InvalidCursor);
                }
                {
                    let sessions = self.sessions.lock().unwrap();
                    if sessions.contains_key(&open.session_id) {
                        return Err(TerminalError::AlreadyExists);
                    }
                    let active = sessions
                        .values()
                        .filter(|session| session.state.lock().unwrap().head.status == TerminalStatus::Running)
                        .count();
                    if active >= TERMINAL_MAX_PER_MACHINE {
                        return Err(TerminalError::SessionLimit);
                    }
                }
                let cwd = workspace::workspace_dir(&self.home, &open.group_id, &open.bot_id, &open.workspace);
                if !cwd.is_dir() {
                    return Err(TerminalError::WorkspaceUnavailable);
                }
                let session = Session::spawn(open.clone(), cwd).await?;
                let attachment = session.attach(0)?;
                self.sessions.lock().unwrap().insert(open.session_id, session);
                Ok(attachment)
            }
            TerminalOpenAction::Attach => {
                let session = self
                    .sessions
                    .lock()
                    .unwrap()
                    .get(&open.session_id)
                    .filter(|session| session.group_id == open.group_id && session.bot_id == open.bot_id)
                    .cloned()
                    .ok_or(TerminalError::NotFound)?;
                session.attach(open.after)
            }
        }
    }

    /// Raw keyboard bytes: Ctrl+C/Ctrl+D are not lifecycle commands.
    pub async fn input(&self, session_id: &str, data: impl Into<Bytes>) -> Result<(), TerminalError> {
        let mut data = data.into();
        let session = self.session(session_id)?;
        while !data.is_empty() {
            let take = data.len().min(CHUNK_SIZE);
            let chunk = data.split_to(take);
            let (reply, result) = oneshot::channel();
            session.command(Command::Input { data: chunk, reply }).await?;
            result.await.map_err(|_| TerminalError::NotRunning)?.map_err(TerminalError::Io)?;
        }
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<TerminalHead, TerminalError> {
        validate_size(cols, rows)?;
        let session = self.session(session_id)?;
        let (reply, result) = oneshot::channel();
        session.command(Command::Resize { cols, rows, reply }).await?;
        result.await.map_err(|_| TerminalError::NotRunning)?.map_err(TerminalError::Io)?;
        Ok(session.state.lock().unwrap().head.clone())
    }

    pub async fn terminate(&self, session_id: &str) -> Result<TerminalHead, TerminalError> {
        let session = self.session(session_id)?;
        if session.state.lock().unwrap().head.status != TerminalStatus::Running {
            return Ok(session.state.lock().unwrap().head.clone());
        }
        let (reply, result) = oneshot::channel();
        session.command(Command::Terminate { reply }).await?;
        result.await.map_err(|_| TerminalError::NotRunning)?.map_err(TerminalError::Io)?;
        Ok(session.state.lock().unwrap().head.clone())
    }

    pub async fn control(&self, control: TerminalClientControl) -> Result<TerminalHead, TerminalError> {
        match control {
            TerminalClientControl::Resize { session_id, cols, rows } => self.resize(&session_id, cols, rows).await,
            TerminalClientControl::Terminate { session_id } => self.terminate(&session_id).await,
            TerminalClientControl::Ping { session_id } => self.head(&session_id).await,
        }
    }

    pub async fn head(&self, session_id: &str) -> Result<TerminalHead, TerminalError> {
        Ok(self.session(session_id)?.state.lock().unwrap().head.clone())
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, TerminalError> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or(TerminalError::NotFound)
    }
}

struct Session {
    group_id: String,
    bot_id: String,
    state: Arc<Mutex<State>>,
    commands: mpsc::Sender<Command>,
}

impl Session {
    async fn spawn(open: TerminalOpen, cwd: PathBuf) -> Result<Arc<Self>, TerminalError> {
        let session_id = open.session_id.clone();
        let spawned = tokio::task::spawn_blocking(move || spawn_pty(cwd, open.cols, open.rows))
            .await
            .map_err(|error| TerminalError::Spawn(error.to_string()))??;
        let head = TerminalHead {
            session_id,
            status: TerminalStatus::Running,
            cols: open.cols,
            rows: open.rows,
            next: 0,
            created_at: now(),
            last_active_at: now(),
            exit_code: None,
            reason: None,
        };
        let state = Arc::new(Mutex::new(State {
            head,
            replay: VecDeque::new(),
            replay_bytes: 0,
            subscribers: HashMap::new(),
            next_subscriber: 0,
        }));
        let (commands, receiver) = mpsc::channel(COMMAND_QUEUE);
        let session = Arc::new(Self { group_id: open.group_id, bot_id: open.bot_id, state: state.clone(), commands });
        tokio::spawn(run_session(spawned, state, receiver));
        Ok(session)
    }

    fn attach(&self, after: u64) -> Result<TerminalAttachment, TerminalError> {
        let (events, receiver) = mpsc::channel(OUTPUT_QUEUE);
        let mut state = self.state.lock().unwrap();
        if after > state.head.next {
            return Err(TerminalError::InvalidCursor);
        }
        let oldest = state.replay.front().map_or(state.head.next + 1, |chunk| chunk.seq);
        if after + 1 < oldest {
            return Err(TerminalError::ReplayExpired);
        }
        let replay = state.replay.iter().filter(|chunk| chunk.seq > after).cloned().collect();
        let head = state.head.clone();
        let subscription = if head.status == TerminalStatus::Running {
            state.next_subscriber += 1;
            let id = state.next_subscriber;
            state.subscribers.insert(id, events);
            Some(Subscription { id, state: self.state.clone() })
        } else {
            None
        };
        Ok(TerminalAttachment { head, replay, events: receiver, subscription })
    }

    async fn command(&self, command: Command) -> Result<(), TerminalError> {
        if self.state.lock().unwrap().head.status != TerminalStatus::Running {
            return Err(TerminalError::NotRunning);
        }
        self.commands.send(command).await.map_err(|_| TerminalError::NotRunning)
    }
}

struct State {
    head: TerminalHead,
    replay: VecDeque<TerminalOutput>,
    replay_bytes: usize,
    subscribers: HashMap<u64, mpsc::Sender<TerminalEvent>>,
    next_subscriber: u64,
}

enum Command {
    Input { data: Bytes, reply: oneshot::Sender<Result<(), String>> },
    Resize { cols: u16, rows: u16, reply: oneshot::Sender<Result<(), String>> },
    Terminate { reply: oneshot::Sender<Result<(), String>> },
}

struct Spawned {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    root_pid: u32,
    events: mpsc::Receiver<IoEvent>,
    cancel_reader: Arc<AtomicBool>,
}

enum IoEvent {
    Output(Vec<u8>),
    Eof,
    Exit(ExitStatus),
    Error(String),
}

impl From<std::io::Error> for IoEvent {
    fn from(error: std::io::Error) -> Self {
        Self::Error(error.to_string())
    }
}

struct ReaderCancel(Arc<AtomicBool>);

impl Drop for ReaderCancel {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

async fn run_session(mut spawned: Spawned, state: Arc<Mutex<State>>, mut commands: mpsc::Receiver<Command>) {
    let _cancel = ReaderCancel(spawned.cancel_reader.clone());
    let mut child_exit = None;
    let mut reader_eof = false;
    let mut commands_open = true;
    let exit_grace = tokio::time::sleep(Duration::from_secs(1));
    tokio::pin!(exit_grace);
    loop {
        tokio::select! {
            command = commands.recv(), if commands_open => match command {
                Some(Command::Input { data, reply }) => {
                    let writer = spawned.writer.clone();
                    let result = tokio::task::spawn_blocking(move || {
                        let mut writer = writer.lock().unwrap();
                        writer.write_all(&data).and_then(|()| writer.flush()).map_err(|error| error.to_string())
                    }).await.map_err(|error| error.to_string()).and_then(|result| result);
                    if result.is_ok() {
                        touch(&state);
                    }
                    let failed = result.is_err();
                    let _ = reply.send(result);
                    if failed {
                        finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error).await;
                        return;
                    }
                }
                Some(Command::Resize { cols, rows, reply }) => {
                    let master = spawned.master.clone();
                    let result = tokio::task::spawn_blocking(move || {
                        master.lock().unwrap().resize(size(cols, rows)).map_err(|error| error.to_string())
                    }).await.map_err(|error| error.to_string()).and_then(|result| result);
                    if result.is_ok() {
                        let mut state = state.lock().unwrap();
                        state.head.cols = cols;
                        state.head.rows = rows;
                        state.head.last_active_at = now();
                    }
                    let failed = result.is_err();
                    let _ = reply.send(result);
                    if failed {
                        finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error).await;
                        return;
                    }
                }
                Some(Command::Terminate { reply }) => {
                    let root_pid = spawned.root_pid;
                    let result = tokio::task::spawn_blocking(move || kill_session(root_pid))
                        .await
                        .map_err(|error| error.to_string())
                        .and_then(|result| result);
                    if result.is_ok() {
                        finish(&state, TerminalStatus::Closed, None, TerminalEndReason::User).await;
                    }
                    let failed = result.is_err();
                    let _ = reply.send(result);
                    if !failed {
                        return;
                    }
                }
                None => commands_open = false,
            },
            event = spawned.events.recv() => match event {
                Some(IoEvent::Output(data)) => publish(&state, data).await,
                Some(IoEvent::Eof) => {
                    reader_eof = true;
                    if let Some(status) = child_exit.take() {
                        finish_exit(&state, status).await;
                        return;
                    }
                }
                Some(IoEvent::Exit(status)) => {
                    child_exit = Some(status);
                    if reader_eof {
                        finish_exit(&state, child_exit.take().unwrap()).await;
                        return;
                    }
                    exit_grace.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(1));
                }
                Some(IoEvent::Error(error)) => {
                    let _ = error;
                    finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error).await;
                    return;
                }
                None => {
                    if let Some(status) = child_exit.take() {
                        finish_exit(&state, status).await;
                    } else {
                        finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error).await;
                    }
                    return;
                }
            },
            _ = &mut exit_grace, if child_exit.is_some() => {
                finish_exit(&state, child_exit.take().unwrap()).await;
                return;
            }
        }
    }
}

fn spawn_pty(cwd: PathBuf, cols: u16, rows: u16) -> Result<Spawned, TerminalError> {
    let pair =
        native_pty_system().openpty(size(cols, rows)).map_err(|error| TerminalError::Spawn(error.to_string()))?;
    let mut command = CommandBuilder::new_default_prog();
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(command).map_err(|error| TerminalError::Spawn(error.to_string()))?;
    let root_pid = child.process_id().ok_or_else(|| TerminalError::Spawn("missing shell pid".into()))?;
    let writer = pair.master.take_writer().map_err(|error| TerminalError::Spawn(error.to_string()))?;
    let reader = clone_reader(&*pair.master)?;
    let master = Arc::new(Mutex::new(pair.master));
    let writer = Arc::new(Mutex::new(writer));
    let (events, receiver) = mpsc::channel(OUTPUT_QUEUE);
    let cancel_reader = Arc::new(AtomicBool::new(false));
    spawn_reader(reader, events.clone(), cancel_reader.clone());
    std::thread::spawn(move || {
        let result = child.wait().map(IoEvent::Exit).unwrap_or_else(IoEvent::from);
        let _ = events.blocking_send(result);
    });
    Ok(Spawned { master, writer, root_pid, events: receiver, cancel_reader })
}

fn clone_reader(master: &dyn MasterPty) -> Result<File, TerminalError> {
    let fd = master.as_raw_fd().ok_or_else(|| TerminalError::Spawn("missing PTY fd".into()))?;
    // A nonblocking duplicate can be cancelled without closing an fd in use by another thread.
    let duplicate = unsafe { libc::dup(fd) };
    if duplicate < 0 {
        return Err(TerminalError::Io(std::io::Error::last_os_error().to_string()));
    }
    let owned = unsafe { OwnedFd::from_raw_fd(duplicate) };
    let flags = unsafe { libc::fcntl(duplicate, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(duplicate, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(TerminalError::Io(std::io::Error::last_os_error().to_string()));
    }
    Ok(File::from(owned))
}

fn spawn_reader(mut reader: File, events: mpsc::Sender<IoEvent>, cancel: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut buffer = vec![0; CHUNK_SIZE];
        loop {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = events.blocking_send(IoEvent::Eof);
                    return;
                }
                Ok(size) => {
                    if events.blocking_send(IoEvent::Output(buffer[..size].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => {
                    let _ = events.blocking_send(IoEvent::from(error));
                    return;
                }
            }
        }
    });
}

async fn publish(state: &Arc<Mutex<State>>, data: Vec<u8>) {
    let output = {
        let mut state = state.lock().unwrap();
        state.head.next += 1;
        state.head.last_active_at = now();
        let output = TerminalOutput { seq: state.head.next, data: Bytes::from(data) };
        state.replay_bytes += output.data.len();
        state.replay.push_back(output.clone());
        while state.replay_bytes > TERMINAL_REPLAY_BYTES || state.replay.len() > TERMINAL_REPLAY_CHUNKS {
            let removed = state.replay.pop_front().unwrap();
            state.replay_bytes -= removed.data.len();
        }
        output
    };
    emit(state, TerminalEvent::Output(output)).await;
}

async fn finish_exit(state: &Arc<Mutex<State>>, status: ExitStatus) {
    let exit_code = (status.signal().is_none()).then(|| status.exit_code() as i32);
    finish(state, TerminalStatus::Exited, exit_code, TerminalEndReason::Exited).await;
}

async fn finish(state: &Arc<Mutex<State>>, status: TerminalStatus, exit_code: Option<i32>, reason: TerminalEndReason) {
    let (next, subscribers) = {
        let mut state = state.lock().unwrap();
        state.head.status = status;
        state.head.exit_code = exit_code;
        state.head.reason = Some(reason);
        state.head.last_active_at = now();
        (state.head.next, std::mem::take(&mut state.subscribers))
    };
    for subscriber in subscribers.into_values() {
        let _ = subscriber.send(TerminalEvent::Exit { next, exit_code, reason }).await;
    }
}

async fn emit(state: &Arc<Mutex<State>>, event: TerminalEvent) {
    let subscribers = {
        let mut state = state.lock().unwrap();
        state.subscribers.retain(|_, sender| !sender.is_closed());
        state.subscribers.values().cloned().collect::<Vec<_>>()
    };
    for subscriber in subscribers {
        let _ = subscriber.send(event.clone()).await;
    }
}

fn touch(state: &Mutex<State>) {
    state.lock().unwrap().head.last_active_at = now();
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

fn validate_size(cols: u16, rows: u16) -> Result<(), TerminalError> {
    if (2..=500).contains(&cols) && (2..=500).contains(&rows) { Ok(()) } else { Err(TerminalError::InvalidSize) }
}

fn kill_session(root_pid: u32) -> Result<(), String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

    let root = i32::try_from(root_pid).map_err(|_| "invalid shell pid".to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut system = System::new();
    loop {
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let mut pids = system
            .processes()
            .keys()
            .map(|pid| pid.as_u32() as i32)
            .filter(|pid| unsafe { libc::getsid(*pid) } == root)
            .collect::<Vec<_>>();
        if pids.is_empty() {
            return Ok(());
        }
        pids.sort_by_key(|pid| *pid == root);
        for pid in pids {
            // Job control creates new process groups within the same PTY session.
            if unsafe { libc::kill(pid, libc::SIGKILL) } != 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::ESRCH) {
                    return Err(error.to_string());
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err("terminal processes did not exit".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
