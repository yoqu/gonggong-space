//! Turns sharing a directory, and which of them may change files (docs/plan/工作区并行-写时确认.md).
use crate::protocol::{Answer, Question, QuestionType};
use crate::t;
use std::path::{Path, PathBuf};
use tokio::sync::watch;

#[derive(Clone)]
pub(crate) struct Holder {
    pub(super) run_id: String,
    pub(super) label: String,
    /// A manual git action: turns wait for it without offering to run beside it.
    pub(super) exclusive: bool,
    /// May change files without asking first: a turn not guarded by its [`WriteGate`], or one past it.
    pub(super) writer: bool,
}

/// Whether the answer to the shared-directory confirmation chose to run in parallel.
pub(crate) fn parallel(answers: &[Answer]) -> bool {
    answers.first().is_some_and(|a| a.choices == [0])
}

/// Short folder label for group chat prompts so the owner's local filesystem path is not exposed.
fn display_dir(dir: &Path) -> String {
    dir.file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| dir.display().to_string())
}

pub(super) fn dir_question(dir: &Path, others: &[Holder]) -> Question {
    let holders = others.iter().map(|h| h.label.as_str()).collect::<Vec<_>>().join(t!("、"));
    Question {
        id: "q1".into(),
        kind: QuestionType::Single,
        title: t!(
            "{holders} 也在工作区 {dir} 运行，可能正在修改文件。改到同一文件会互相覆盖，现在就开始吗？",
            holders = holders,
            dir = display_dir(dir)
        ),
        options: vec![t!("现在就开始").into(), t!("等运行结束再开始").into()],
        recommended: Some(1),
        option_meta: vec![],
        no_other: true,
    }
}

/// The write confirmation of a guarded turn about to change `target` while `others` may change files too.
fn write_question(dir: &Path, others: &[String], target: &str) -> Question {
    let holders = others.join(t!("、"));
    Question {
        id: "q1".into(),
        kind: QuestionType::Single,
        title: t!(
            "{holders} 也在工作区 {dir} 运行，可能正在修改文件；本轮要{target}。改到同一文件会互相覆盖，现在就改吗？",
            holders = holders,
            dir = display_dir(dir),
            target = target
        ),
        options: vec![t!("现在就改").into(), t!("等运行结束再改").into()],
        recommended: Some(1),
        option_meta: vec![],
        no_other: true,
    }
}

/// A guarded turn's way to become a writer of its directory: at once when no other turn may write, else once the
/// group confirms or the others ended.
#[derive(Clone)]
pub(crate) struct WriteGate {
    dir: watch::Sender<Vec<Holder>>,
    run_id: String,
    key: PathBuf,
}

impl WriteGate {
    pub(super) fn new(dir: watch::Sender<Vec<Holder>>, run_id: String, key: PathBuf) -> Self {
        WriteGate { dir, run_id, key }
    }

    /// Makes the turn a writer unless another one may write (their names), or `force`.
    pub(crate) fn take(&self, force: bool) -> Result<(), Vec<String>> {
        let mut others = vec![];
        self.dir.send_if_modified(|h| {
            others = h.iter().filter(|x| x.writer && x.run_id != self.run_id).map(|x| x.label.clone()).collect();
            if !others.is_empty() && !force {
                return false;
            }
            h.iter_mut().filter(|x| x.run_id == self.run_id).for_each(|x| x.writer = true);
            true
        });
        if others.is_empty() || force { Ok(()) } else { Err(others) }
    }

    /// No longer a writer: the change it was taken for was called off.
    pub(crate) fn yield_write(&self) {
        self.dir.send_modify(|h| h.iter_mut().filter(|x| x.run_id == self.run_id).for_each(|x| x.writer = false));
    }

    pub(crate) fn question(&self, others: &[String], target: &str) -> Question {
        write_question(&self.key, others, target)
    }

    /// Wakes when the turns in the directory change.
    pub(crate) fn subscribe(&self) -> watch::Receiver<Vec<Holder>> {
        self.dir.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_question_hides_full_path_and_uses_adopted_options() {
        let dir = Path::new("/Users/alice/secret-client/my-app");
        let q = write_question(dir, &["Bot A（群「支付」）".into()], "修改 README.md");
        assert!(!q.title.contains("/Users/alice"), "leaked owner path: {}", q.title);
        assert!(q.title.contains("my-app"), "missing folder name: {}", q.title);
        assert_eq!(q.options, ["现在就改", "等运行结束再改"]);
        assert!(q.no_other, "a write confirmation takes no 「其他」 text");
    }

    #[test]
    fn dir_question_hides_full_path() {
        let dir = Path::new("/Users/alice/secret-client/my-app");
        let holder = Holder { run_id: "r1".into(), label: "Bot A".into(), exclusive: false, writer: true };
        let q = dir_question(dir, &[holder]);
        assert!(!q.title.contains("/Users/alice"), "leaked owner path: {}", q.title);
        assert!(q.title.contains("my-app"), "missing folder name: {}", q.title);
        assert_eq!(q.options, ["现在就开始", "等运行结束再开始"]);
        assert!(q.no_other, "a directory confirmation takes no 「其他」 text");
    }
}
