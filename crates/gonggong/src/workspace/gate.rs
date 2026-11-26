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

pub(super) fn dir_question(dir: &Path, others: &[Holder]) -> Question {
    let names: Vec<_> = others.iter().map(|h| h.label.as_str()).collect();
    Question {
        id: "q1".into(),
        kind: QuestionType::Single,
        title: t!(
            "工作区 {dir} 正在被 {holders} 使用。改动范围不重叠时可以并行；改到同一文件会互相覆盖。现在就开始吗？",
            dir = dir.display(),
            holders = names.join(t!("、"))
        ),
        options: vec![t!("并行开始").into(), t!("排队等待").into()],
        recommended: Some(1),
        option_meta: vec![],
    }
}

/// The write confirmation of a guarded turn about to change `target` while `others` may change files too.
fn write_question(dir: &Path, others: &[String], target: &str) -> Question {
    Question {
        id: "q1".into(),
        kind: QuestionType::Single,
        title: t!(
            "{holders} 也在工作区 {dir} 运行，可能正在修改文件；本轮要{target}。改到同一文件会互相覆盖，现在就改吗？",
            holders = others.join(t!("、")),
            dir = dir.display(),
            target = target
        ),
        options: vec![t!("并行修改").into(), t!("等它结束再改").into()],
        recommended: Some(1),
        option_meta: vec![],
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
