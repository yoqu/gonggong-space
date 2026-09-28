//! First-screen PNGs of previews for their chat cards, rendered by the machine's own Chrome-family browser.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(200);

#[cfg(target_os = "macos")]
const INSTALLED: &[&str] = &[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];
#[cfg(windows)]
const INSTALLED: &[&str] = &[
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
];
#[cfg(not(any(target_os = "macos", windows)))]
const INSTALLED: &[&str] = &[];
const ON_PATH: &[&str] = &["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];

/// `GONGGONG_BROWSER`, else a Chrome-family browser at its usual place or on PATH.
fn browser() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("GONGGONG_BROWSER") {
        return Some(PathBuf::from(p)).filter(|p| p.is_file());
    }
    INSTALLED.iter().map(PathBuf::from).find(|p| p.is_file()).or_else(|| {
        let path = std::env::var_os("PATH")?;
        std::env::split_paths(&path).flat_map(|d| ON_PATH.iter().map(move |n| d.join(n))).find(|p| p.is_file())
    })
}

/// The page at `http://localhost:{port}{path}` as a 1280×800 PNG; None when the machine has no such browser.
pub async fn capture(port: u16, path: &str) -> anyhow::Result<Option<Vec<u8>>> {
    let Some(bin) = browser() else { return Ok(None) };
    let dir = std::env::temp_dir().join(format!("gg-snapshot-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&dir).await?;
    // Own profile: a running browser would otherwise take the command over.
    let mut child = tokio::process::Command::new(&bin)
        .current_dir(&dir)
        .args(["--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check"])
        .args(["--virtual-time-budget=5000", "--window-size=1280,800", "--screenshot"])
        .arg(format!("--user-data-dir={}", dir.join("profile").display()))
        .arg(format!("http://localhost:{port}{path}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let result = shot(&mut child, &dir.join("screenshot.png")).await;
    let _ = child.kill().await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result
}

/// Chrome on macOS may keep running after writing the file: done once it exists with a settled size.
async fn shot(child: &mut tokio::process::Child, file: &Path) -> anyhow::Result<Option<Vec<u8>>> {
    let mut last = 0;
    for _ in 0..TIMEOUT.as_millis() / POLL.as_millis() {
        tokio::time::sleep(POLL).await;
        let size = tokio::fs::metadata(file).await.map(|m| m.len()).unwrap_or(0);
        if size > 0 && size == last {
            return Ok(Some(tokio::fs::read(file).await?));
        }
        last = size;
        if let Some(status) = child.try_wait()?
            && size == 0
        {
            anyhow::bail!("浏览器没有产出截图：{status}");
        }
    }
    anyhow::bail!("截图超时")
}
