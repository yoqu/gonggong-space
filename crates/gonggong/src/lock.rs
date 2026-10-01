//! One daemon per machine home: `gg run` and the desktop app both take `<home>/daemon.lock` (an OS file lock, so
//! a crashed daemon never leaves it stuck) and record their pid in it for the refusal message.
use std::fs::{File, OpenOptions, TryLockError};
use std::io::Write;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("{}", held(*.pid))]
    Held { pid: Option<u32> },
    #[error("{}", crate::t!("无法创建 daemon 锁文件：{e}", e = .0))]
    Io(#[from] std::io::Error),
}

fn held(pid: Option<u32>) -> String {
    match pid {
        Some(pid) => {
            crate::t!("本机已有共工空间 daemon 在运行（pid {pid}，gg run 或桌面端），同一台机器只能运行一个", pid = pid)
        }
        None => crate::t!("本机已有共工空间 daemon 在运行（gg run 或桌面端），同一台机器只能运行一个").into(),
    }
}

/// Held for as long as the daemon runs; dropping it releases the lock.
pub struct Lock {
    _file: File,
}

impl Lock {
    pub fn acquire(home: &Path) -> Result<Lock, LockError> {
        std::fs::create_dir_all(home)?;
        let path = home.join("daemon.lock");
        let mut file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&path)?;
        match file.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => {
                let pid = std::fs::read_to_string(&path).ok().and_then(|s| s.trim().parse().ok());
                return Err(LockError::Held { pid });
            }
            Err(TryLockError::Error(e)) => return Err(e.into()),
        }
        file.set_len(0)?;
        file.write_all(std::process::id().to_string().as_bytes())?;
        Ok(Lock { _file: file })
    }
}
