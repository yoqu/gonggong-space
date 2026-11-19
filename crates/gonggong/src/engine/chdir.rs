//! Starting an agent CLI in the workspace when it runs shell commands in its own directory (`chdir`).
use std::path::{Path, PathBuf};

/// `node <this> <dir> <script> args…` runs the node script `script` with `args` in `dir`.
pub(super) fn node_script(home: &Path) -> anyhow::Result<PathBuf> {
    const SCRIPT: &str = "process.chdir(process.argv[2]);\nconst script = process.argv[3];\nprocess.argv.splice(1, 3, script);\nrequire(script);\n";
    let path = home.join("bin").join("chdir.cjs");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(SCRIPT) {
        std::fs::create_dir_all(path.parent().expect("has a parent"))?;
        std::fs::write(&path, SCRIPT)?;
    }
    Ok(path)
}

/// Runs a native program in a directory with its own arguments, stdio passed through, and ends with it.
pub(super) fn program(home: &Path) -> anyhow::Result<PathBuf> {
    const SCRIPT: &str = "const { spawn } = require('node:child_process');
const [cwd, cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { cwd, stdio: 'inherit', windowsHide: true });
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => child.kill(s));
child.on('error', (e) => { console.error(e.message); process.exit(127); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
";
    let path = home.join("bin").join("chdir-spawn.cjs");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(SCRIPT) {
        std::fs::create_dir_all(path.parent().expect("has a parent"))?;
        std::fs::write(&path, SCRIPT)?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chdir_script_runs_a_node_script_in_the_directory_with_its_own_arguments() {
        let (home, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let script = home.path().join("echo.js");
        std::fs::write(&script, "console.log(JSON.stringify([process.cwd(), process.argv.slice(2)]))").unwrap();
        let out = std::process::Command::new("node")
            .arg(node_script(home.path()).unwrap())
            .arg(dir.path())
            .arg(&script)
            .args(["--acp", "--append-system-prompt", "x"])
            .output()
            .unwrap();
        let (cwd, args): (String, Vec<String>) = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(PathBuf::from(cwd), dir.path().canonicalize().unwrap());
        assert_eq!(args, ["--acp", "--append-system-prompt", "x"]);
    }

    #[test]
    fn the_chdir_spawn_script_runs_a_program_in_the_directory_with_its_stdio_and_exit_code() {
        let (home, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let code = "console.log(JSON.stringify([process.cwd(), process.argv.slice(1)])); process.exitCode = 3";
        let out = std::process::Command::new("node")
            .arg(program(home.path()).unwrap())
            .arg(dir.path())
            .args(["node", "-e", code, "acp", "--disable-telemetry"])
            .output()
            .unwrap();
        let (cwd, args): (String, Vec<String>) = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(PathBuf::from(cwd), dir.path().canonicalize().unwrap());
        assert_eq!(args, ["acp", "--disable-telemetry"]);
        assert_eq!(out.status.code(), Some(3));
    }
}
