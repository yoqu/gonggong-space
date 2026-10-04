//! Three-way merge of one conflicting file (F7) with `git merge-file`.
use super::Replica;
use crate::t;
use tokio::process::Command;

/// Bytes git reads to tell binary from text.
const SNIFF: usize = 8000;

#[derive(Debug, PartialEq, Eq)]
pub enum Merge {
    Clean(Vec<u8>),
    /// Merged with conflict markers, for the bot to resolve (交给 Bot 合并).
    Conflict(Vec<u8>),
    Binary,
}

impl Replica {
    /// `base` None: both sides added the file.
    pub async fn merge(&self, mine: &[u8], base: Option<&[u8]>, theirs: &[u8]) -> Result<Merge, String> {
        let base = base.unwrap_or_default();
        if [mine, base, theirs].iter().any(|b| b[..b.len().min(SNIFF)].contains(&0)) {
            return Ok(Merge::Binary);
        }
        let dir = self.state.join("merge").join(uuid::Uuid::new_v4().to_string());
        let out = async {
            let err = |e: std::io::Error| t!("合并失败：{e}", e = e);
            std::fs::create_dir_all(&dir).map_err(err)?;
            for (name, bytes) in [("mine", mine), ("base", base), ("theirs", theirs)] {
                std::fs::write(dir.join(name), bytes).map_err(err)?;
            }
            // Labels are read by the agent resolving the markers.
            let args = ["merge-file", "-p", "-L", "mine", "-L", "base", "-L", "theirs", "mine", "base", "theirs"];
            Command::new("git").args(args).current_dir(&dir).output().await.map_err(err)
        }
        .await;
        let _ = std::fs::remove_dir_all(&dir);
        let out = out?;
        match out.status.code() {
            Some(0) => Ok(Merge::Clean(out.stdout)),
            Some(1..=127) => Ok(Merge::Conflict(out.stdout)),
            _ if String::from_utf8_lossy(&out.stderr).contains("binary") => Ok(Merge::Binary),
            _ => Err(t!("合并失败：{e}", e = String::from_utf8_lossy(&out.stderr).trim())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::Fixture;
    use super::*;

    #[tokio::test]
    async fn edits_to_different_lines_merge_cleanly() {
        let r = Fixture::new().replica();
        let base = b"a\nb\nc\nd\ne\n";
        let mine = b"A\nb\nc\nd\ne\n";
        let theirs = b"a\nb\nc\nd\nE\n";
        assert_eq!(r.merge(mine, Some(base), theirs).await.unwrap(), Merge::Clean(b"A\nb\nc\nd\nE\n".to_vec()));
    }

    #[tokio::test]
    async fn edits_to_the_same_line_conflict_with_markers() {
        let fx = Fixture::new();
        let r = fx.replica();
        let Merge::Conflict(out) = r.merge(b"mine\n", Some(b"base\n"), b"theirs\n").await.unwrap() else {
            panic!("expected a conflict")
        };
        let out = String::from_utf8(out).unwrap();
        assert!(out.contains("<<<<<<< mine\nmine\n=======\ntheirs\n>>>>>>> theirs\n"), "{out}");
        let Merge::Conflict(_) = r.merge(b"x\n", None, b"y\n").await.unwrap() else { panic!("both added") };
        assert!(!fx.home().join("sync/g1/b1/merge").read_dir().unwrap().any(|_| true));
    }

    #[tokio::test]
    async fn binary_files_are_not_merged() {
        let r = Fixture::new().replica();
        assert_eq!(r.merge(b"a\0b", Some(b"a"), b"c").await.unwrap(), Merge::Binary);
        assert_eq!(r.merge(b"a", None, b"\0").await.unwrap(), Merge::Binary);
    }
}
