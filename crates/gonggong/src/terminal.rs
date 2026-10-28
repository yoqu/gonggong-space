use crate::protocol::{
    TERMINAL_IDLE_MS, TERMINAL_MAX_BUFFERED_BYTES, TERMINAL_MAX_PER_MACHINE, TERMINAL_REPLAY_BYTES,
    TERMINAL_REPLAY_CHUNKS, TerminalClientControl, TerminalEndReason, TerminalHead, TerminalLive, TerminalOpen,
    TerminalOpenAction, TerminalStatus,
};
use crate::workspace;
use hyper::body::Bytes;
use portable_pty::{CommandBuilder, ExitStatus, MasterPty, PtySize, native_pty_system};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak, mpsc as sync_mpsc};
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{Mutex as AsyncMutex, mpsc};

const CHUNK_SIZE: usize = 16 * 1024;
/// Keystrokes waiting for the PTY; beyond it input is refused instead of waiting on a program that does not read.
const INPUT_QUEUE: usize = TERMINAL_MAX_BUFFERED_BYTES / CHUNK_SIZE / 4;
const OUTPUT_QUEUE: usize = TERMINAL_MAX_BUFFERED_BYTES / CHUNK_SIZE;
/// Ended sessions kept so a late attach still learns how the shell ended.
const ENDED_KEPT: usize = 16;
const POLL_MS: i32 = 100;

#[derive(Debug, Error)]
pub enum TerminalError {
    #[error("terminal_not_found")]
    NotFound,
    #[error("terminal_exists")]
    AlreadyExists,
    #[error("terminal_limit")]
    SessionLimit,
    #[error("invalid_replay_cursor")]
    InvalidCursor,
    #[error("terminal_not_running")]
    NotRunning,
    #[error("terminal_input_backlog")]
    InputBacklog,
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

/// A viewer of one session. Its events end without an `Exit` when it fell too far behind: it reattaches from its
/// last sequence instead of holding up the shell or the other viewers.
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

type Sessions = Arc<Mutex<HashMap<String, Arc<Session>>>>;

#[derive(Clone)]
pub struct TerminalManager {
    home: PathBuf,
    sessions: Sessions,
    open_lock: Arc<AsyncMutex<()>>,
    _reaper: Arc<Reaper>,
}

impl TerminalManager {
    pub fn new(home: PathBuf) -> Self {
        Self::with_idle_timeout(home, Duration::from_millis(TERMINAL_IDLE_MS))
    }

    pub fn with_idle_timeout(home: PathBuf, idle: Duration) -> Self {
        let sessions = Sessions::default();
        let reaper = Reaper(tokio::spawn(reap_idle(Arc::downgrade(&sessions), idle)));
        Self { home, sessions, open_lock: Arc::default(), _reaper: Arc::new(reaper) }
    }

    /// Dropping the returned attachment only disconnects its web stream. An `after` older than the retained output
    /// resumes from the oldest retained chunk: the viewer sees the gap and redraws.
    pub async fn open(&self, open: TerminalOpen) -> Result<TerminalAttachment, TerminalError> {
        validate_size(open.cols, open.rows)?;
        let _guard = self.open_lock.lock().await;
        match open.action {
            TerminalOpenAction::Create => {
                if open.after != 0 {
                    return Err(TerminalError::InvalidCursor);
                }
                {
                    let mut sessions = self.sessions.lock().unwrap();
                    if sessions.contains_key(&open.session_id) {
                        return Err(TerminalError::AlreadyExists);
                    }
                    forget_ended(&mut sessions);
                    if sessions.values().filter(|session| session.running()).count() >= TERMINAL_MAX_PER_MACHINE {
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
            TerminalOpenAction::Attach => self.session_in(&open)?.attach(open.after),
            TerminalOpenAction::Terminate => unreachable!("terminate opens are answered by terminate_open"),
        }
    }

    /// Raw keyboard bytes: Ctrl+C/Ctrl+D are not lifecycle commands. Never waits for the PTY: input a program does
    /// not read fails with [`TerminalError::InputBacklog`] once the queue is full.
    pub async fn input(&self, session_id: &str, data: impl Into<Bytes>) -> Result<(), TerminalError> {
        let mut data = data.into();
        let session = self.session(session_id)?;
        if !session.running() {
            return Err(TerminalError::NotRunning);
        }
        while !data.is_empty() {
            let chunk = data.split_to(data.len().min(CHUNK_SIZE));
            session.input.try_send(chunk).map_err(|error| match error {
                sync_mpsc::TrySendError::Full(_) => TerminalError::InputBacklog,
                sync_mpsc::TrySendError::Disconnected(_) => TerminalError::NotRunning,
            })?;
        }
        touch(&session.state);
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<TerminalHead, TerminalError> {
        validate_size(cols, rows)?;
        let session = self.session(session_id)?;
        if !session.running() {
            return Err(TerminalError::NotRunning);
        }
        session
            .master
            .lock()
            .unwrap()
            .resize(size(cols, rows))
            .map_err(|error| TerminalError::Io(error.to_string()))?;
        let mut state = session.state.lock().unwrap();
        state.head.cols = cols;
        state.head.rows = rows;
        drop(state);
        touch(&session.state);
        Ok(session.head())
    }

    pub async fn terminate(&self, session_id: &str) -> Result<TerminalHead, TerminalError> {
        self.session(session_id)?.terminate(TerminalEndReason::User).await
    }

    /// The `terminate` open action: the session must belong to the opener's group and bot, like an attach.
    pub async fn terminate_open(&self, open: &TerminalOpen) -> Result<TerminalHead, TerminalError> {
        self.session_in(open)?.terminate(TerminalEndReason::User).await
    }

    pub async fn control(&self, control: TerminalClientControl) -> Result<TerminalHead, TerminalError> {
        match control {
            TerminalClientControl::Resize { session_id, cols, rows } => self.resize(&session_id, cols, rows).await,
            TerminalClientControl::Terminate { session_id } => self.terminate(&session_id).await,
            TerminalClientControl::Ping { session_id } => self.head(&session_id).await,
        }
    }

    pub async fn head(&self, session_id: &str) -> Result<TerminalHead, TerminalError> {
        Ok(self.session(session_id)?.head())
    }

    /// Running shells, for hello.
    pub fn live(&self) -> Vec<TerminalLive> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter_map(|session| {
                let head = session.head();
                (head.status == TerminalStatus::Running).then(|| TerminalLive {
                    session_id: head.session_id,
                    group_id: session.group_id.clone(),
                    bot_id: session.bot_id.clone(),
                    cols: head.cols,
                    rows: head.rows,
                    created_at: head.created_at,
                })
            })
            .collect()
    }

    fn session(&self, id: &str) -> Result<Arc<Session>, TerminalError> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or(TerminalError::NotFound)
    }

    fn session_in(&self, open: &TerminalOpen) -> Result<Arc<Session>, TerminalError> {
        let session = self.session(&open.session_id)?;
        if session.group_id != open.group_id || session.bot_id != open.bot_id {
            return Err(TerminalError::NotFound);
        }
        Ok(session)
    }
}

fn forget_ended(sessions: &mut HashMap<String, Arc<Session>>) {
    let mut ended = sessions
        .iter()
        .filter_map(|(id, session)| session.state.lock().unwrap().ended.map(|at| (at, id.clone())))
        .collect::<Vec<_>>();
    if ended.len() < ENDED_KEPT {
        return;
    }
    ended.sort();
    for (_, id) in &ended[..ended.len() + 1 - ENDED_KEPT] {
        sessions.remove(id);
    }
}

struct Reaper(tokio::task::JoinHandle<()>);

impl Drop for Reaper {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn reap_idle(sessions: Weak<Mutex<HashMap<String, Arc<Session>>>>, idle: Duration) {
    let interval = (idle / 4).clamp(Duration::from_millis(25), Duration::from_secs(60));
    loop {
        tokio::time::sleep(interval).await;
        let now = tokio::time::Instant::now();
        let Some(sessions) = sessions.upgrade() else { return };
        let expired = sessions
            .lock()
            .unwrap()
            .values()
            .filter(|session| {
                session.running() && now.duration_since(session.state.lock().unwrap().last_active) >= idle
            })
            .cloned()
            .collect::<Vec<_>>();
        for session in expired {
            // A failed kill leaves the session running, so the next round tries again.
            tokio::spawn(async move { session.terminate(TerminalEndReason::IdleTimeout).await });
        }
    }
}

struct Session {
    group_id: String,
    bot_id: String,
    state: Arc<Mutex<State>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    input: sync_mpsc::SyncSender<Bytes>,
    root_pid: u32,
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
            last_active: tokio::time::Instant::now(),
            replay: VecDeque::new(),
            replay_bytes: 0,
            subscribers: HashMap::new(),
            next_subscriber: 0,
            terminating: false,
            exited: None,
            ended: None,
        }));
        let Spawned { master, input, root_pid, events, stop } = spawned;
        tokio::spawn(run_session(events, stop, state.clone()));
        Ok(Arc::new(Self { group_id: open.group_id, bot_id: open.bot_id, state, master, input, root_pid }))
    }

    fn running(&self) -> bool {
        self.state.lock().unwrap().head.status == TerminalStatus::Running
    }

    fn head(&self) -> TerminalHead {
        self.state.lock().unwrap().head.clone()
    }

    fn attach(&self, after: u64) -> Result<TerminalAttachment, TerminalError> {
        let (events, receiver) = mpsc::channel(OUTPUT_QUEUE);
        let mut state = self.state.lock().unwrap();
        if after > state.head.next {
            return Err(TerminalError::InvalidCursor);
        }
        let replay = state.replay.iter().filter(|chunk| chunk.seq > after).cloned().collect();
        let head = state.head.clone();
        let subscription = (head.status == TerminalStatus::Running).then(|| {
            state.next_subscriber += 1;
            let id = state.next_subscriber;
            state.subscribers.insert(id, events);
            Subscription { id, state: self.state.clone() }
        });
        Ok(TerminalAttachment { head, replay, events: receiver, subscription })
    }

    /// Kills the shell's whole process tree first; the session ends only once that worked.
    async fn terminate(&self, reason: TerminalEndReason) -> Result<TerminalHead, TerminalError> {
        {
            let mut state = self.state.lock().unwrap();
            if state.head.status != TerminalStatus::Running {
                return Ok(state.head.clone());
            }
            state.terminating = true;
        }
        let root_pid = self.root_pid;
        let killed = tokio::task::spawn_blocking(move || kill_session(root_pid))
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
        let mut state = self.state.lock().unwrap();
        state.terminating = false;
        if let Err(error) = killed {
            if let Some((status, exit_code, reason)) = state.exited.take() {
                end(&mut state, status, exit_code, reason);
            }
            return Err(TerminalError::Io(error));
        }
        end(&mut state, TerminalStatus::Closed, None, reason);
        Ok(state.head.clone())
    }
}

struct State {
    head: TerminalHead,
    last_active: tokio::time::Instant,
    replay: VecDeque<TerminalOutput>,
    replay_bytes: usize,
    subscribers: HashMap<u64, mpsc::Sender<TerminalEvent>>,
    next_subscriber: u64,
    /// Set while a terminate kills the process tree; only the terminate ends the session then.
    terminating: bool,
    /// The shell's own end, seen while terminating; reported if the kill fails.
    exited: Option<(TerminalStatus, Option<i32>, TerminalEndReason)>,
    ended: Option<std::time::Instant>,
}

struct Spawned {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    input: sync_mpsc::SyncSender<Bytes>,
    root_pid: u32,
    events: mpsc::Receiver<IoEvent>,
    stop: Arc<AtomicBool>,
}

enum IoEvent {
    Output(Vec<u8>),
    Eof,
    Exit(ExitStatus),
    Error,
}

impl From<std::io::Error> for IoEvent {
    fn from(_: std::io::Error) -> Self {
        Self::Error
    }
}

/// Stops the PTY reader and writer threads once the session is over.
struct StopThreads(Arc<AtomicBool>);

impl Drop for StopThreads {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

async fn run_session(mut events: mpsc::Receiver<IoEvent>, stop: Arc<AtomicBool>, state: Arc<Mutex<State>>) {
    let _stop = StopThreads(stop);
    let mut child_exit = None;
    let mut reader_eof = false;
    let exit_grace = tokio::time::sleep(Duration::from_secs(1));
    tokio::pin!(exit_grace);
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Some(IoEvent::Output(data)) => publish(&state, data),
                Some(IoEvent::Eof) => {
                    reader_eof = true;
                    if let Some(status) = child_exit.take() {
                        return finish_exit(&state, status);
                    }
                }
                Some(IoEvent::Exit(status)) => {
                    if reader_eof {
                        return finish_exit(&state, status);
                    }
                    child_exit = Some(status);
                    exit_grace.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(1));
                }
                Some(IoEvent::Error) => return finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error),
                None => {
                    return match child_exit.take() {
                        Some(status) => finish_exit(&state, status),
                        None => finish(&state, TerminalStatus::Exited, None, TerminalEndReason::Error),
                    };
                }
            },
            _ = &mut exit_grace, if child_exit.is_some() => return finish_exit(&state, child_exit.take().unwrap()),
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
    let reader = clone_nonblocking(&*pair.master)?;
    let fd = pair.master.as_raw_fd().ok_or_else(|| TerminalError::Spawn("missing PTY fd".into()))?;
    let (events, receiver) = mpsc::channel(OUTPUT_QUEUE);
    let (input, queue) = sync_mpsc::sync_channel(INPUT_QUEUE);
    let stop = Arc::new(AtomicBool::new(false));
    spawn_writer(writer, fd, queue, stop.clone());
    spawn_reader(reader, events.clone(), stop.clone());
    std::thread::spawn(move || {
        let result = child.wait().map(IoEvent::Exit).unwrap_or_else(IoEvent::from);
        let _ = events.blocking_send(result);
    });
    Ok(Spawned { master: Arc::new(Mutex::new(pair.master)), input, root_pid, events: receiver, stop })
}

/// A duplicate of the PTY master for the reader thread. O_NONBLOCK belongs to the open file description, so every
/// handle on the master, the writer's too, stops blocking: both threads wait in poll() and can be stopped.
fn clone_nonblocking(master: &dyn MasterPty) -> Result<File, TerminalError> {
    let fd = master.as_raw_fd().ok_or_else(|| TerminalError::Spawn("missing PTY fd".into()))?;
    // CLOEXEC is set atomically so agents and git spawned meanwhile cannot inherit another group's terminal.
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
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

/// Waits until `fd` is ready for `events` or [`POLL_MS`] passed; false once `stop` is set.
fn wait_ready(fd: RawFd, events: libc::c_short, stop: &AtomicBool) -> bool {
    let mut poll = libc::pollfd { fd, events, revents: 0 };
    unsafe { libc::poll(&mut poll, 1, POLL_MS) };
    !stop.load(Ordering::Relaxed)
}

fn spawn_reader(mut reader: File, events: mpsc::Sender<IoEvent>, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let mut buffer = vec![0; CHUNK_SIZE];
        loop {
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
                    if !wait_ready(reader.as_raw_fd(), libc::POLLIN, &stop) {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                #[cfg(target_os = "linux")]
                // Linux PTY masters report EIO after the slave closes; wait() supplies the real exit status.
                Err(error) if error.raw_os_error() == Some(libc::EIO) => {
                    let _ = events.blocking_send(IoEvent::Eof);
                    return;
                }
                Err(error) => {
                    let _ = events.blocking_send(IoEvent::from(error));
                    return;
                }
            }
        }
    });
}

/// Writes queued input on its own thread: a program that never reads stalls only this thread, never the session.
/// A write error is left to the reader and wait() to report.
fn spawn_writer(
    mut writer: Box<dyn Write + Send>,
    fd: RawFd,
    queue: sync_mpsc::Receiver<Bytes>,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            let Ok(data) = queue.recv_timeout(Duration::from_millis(POLL_MS as u64)) else {
                if matches!(queue.try_recv(), Err(sync_mpsc::TryRecvError::Disconnected)) {
                    return;
                }
                continue;
            };
            let mut rest = &data[..];
            while !rest.is_empty() {
                match writer.write(rest) {
                    Ok(written) => rest = &rest[written..],
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if !wait_ready(fd, libc::POLLOUT, &stop) {
                            return;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => return,
                }
            }
        }
    });
}

fn publish(state: &Mutex<State>, data: Vec<u8>) {
    let mut state = state.lock().unwrap();
    state.head.next += 1;
    state.head.last_active_at = now();
    state.last_active = tokio::time::Instant::now();
    let output = TerminalOutput { seq: state.head.next, data: Bytes::from(data) };
    state.replay_bytes += output.data.len();
    state.replay.push_back(output.clone());
    while state.replay_bytes > TERMINAL_REPLAY_BYTES || state.replay.len() > TERMINAL_REPLAY_CHUNKS {
        let removed = state.replay.pop_front().unwrap();
        state.replay_bytes -= removed.data.len();
    }
    // A viewer whose queue is full is dropped: its stream ends and it reattaches from its last sequence.
    state.subscribers.retain(|_, subscriber| subscriber.try_send(TerminalEvent::Output(output.clone())).is_ok());
}

fn finish_exit(state: &Mutex<State>, status: ExitStatus) {
    let exit_code = status.signal().is_none().then(|| status.exit_code() as i32);
    finish(state, TerminalStatus::Exited, exit_code, TerminalEndReason::Exited);
}

/// The shell ended on its own. During a terminate the exit is held back until the whole process tree is gone.
fn finish(state: &Mutex<State>, status: TerminalStatus, exit_code: Option<i32>, reason: TerminalEndReason) {
    let mut state = state.lock().unwrap();
    if state.terminating {
        state.exited = Some((status, exit_code, reason));
        return;
    }
    end(&mut state, status, exit_code, reason);
}

fn end(state: &mut State, status: TerminalStatus, exit_code: Option<i32>, reason: TerminalEndReason) {
    if state.head.status != TerminalStatus::Running {
        return;
    }
    state.head.status = status;
    state.head.exit_code = exit_code;
    state.head.reason = Some(reason);
    state.ended = Some(std::time::Instant::now());
    let next = state.head.next;
    for subscriber in std::mem::take(&mut state.subscribers).into_values() {
        let _ = subscriber.try_send(TerminalEvent::Exit { next, exit_code, reason });
    }
}

fn touch(state: &Mutex<State>) {
    let mut state = state.lock().unwrap();
    state.head.last_active_at = now();
    state.last_active = tokio::time::Instant::now();
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
    use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System};

    let root = i32::try_from(root_pid).map_err(|_| "invalid shell pid".to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut system = System::new();
    loop {
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let mut pids = system
            .processes()
            .values()
            .filter(|process| unsafe { libc::getsid(process.pid().as_u32() as i32) } == root)
            .filter(|process| process.status() != ProcessStatus::Zombie && process.status() != ProcessStatus::Dead)
            .map(|process| process.pid().as_u32() as i32)
            .collect::<Vec<_>>();
        // The root may already be a zombie: it is still a valid process-group target even when process enumeration
        // has stopped reporting it. Signal that group first, then reap descendants in their other job-control groups.
        pids.push(-root);
        if pids.len() == 1 {
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
