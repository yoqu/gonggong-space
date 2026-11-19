//! Downloads 帮我审批 trusts: plain HTTP(S) GETs with curl or wget that save inside the roots.
use super::{Place, expands, sensitive};

/// A plain HTTP(S) GET: no request body, upload, config file or other scheme; whatever it saves goes inside the roots.
pub(super) fn curl(args: &[&str], place: &Place) -> bool {
    // What the shell fills in may carry the workspace's files out (`?d=$(cat src/a.ts)`).
    if args.iter().any(|a| expands(a)) {
        return false;
    }
    let mut i = 0;
    let mut urls = 0;
    while let Some(a) = args.get(i) {
        let next = || args.get(i + 1).copied();
        match *a {
            "-X" | "--request" => {
                if !next().is_some_and(|m| matches!(m, "GET" | "HEAD")) {
                    return false;
                }
                i += 1;
            }
            "-o" | "--output" | "-D" | "--dump-header" | "-c" | "--cookie-jar" | "--output-dir" => {
                if !next().is_some_and(|p| p == "-" || place.writable(p)) {
                    return false;
                }
                i += 1;
            }
            "-H" | "--header" | "-m" | "--max-time" | "--connect-timeout" | "-A" | "--user-agent" | "-e"
            | "--referer" | "-u" | "--user" | "-x" | "--proxy" | "-w" | "--write-out" | "--retry" | "-b"
            | "--cookie" | "-r" | "--range" | "--resolve" | "--noproxy" => {
                if next().is_some_and(|v| v.starts_with('@') || sensitive(v)) {
                    return false;
                }
                i += 1;
            }
            "-O" | "--remote-name" | "-J" => {
                if place.sh.away {
                    return false;
                }
            }
            a if a.starts_with("http://") || a.starts_with("https://") => urls += 1,
            a if a.starts_with("--") => {
                const FLAGS: &[&str] = &[
                    "--silent",
                    "--show-error",
                    "--fail",
                    "--location",
                    "--insecure",
                    "--include",
                    "--head",
                    "--compressed",
                    "--verbose",
                    "--globoff",
                    "--fail-with-body",
                    "--no-progress-meter",
                    "--http1.1",
                    "--http2",
                    "--ipv4",
                    "--max-time",
                    "--retry-all-errors",
                    "--get",
                ];
                if !FLAGS.contains(&a.split('=').next().unwrap_or(a)) {
                    return false;
                }
            }
            a if a.starts_with('-') => {
                if !a[1..].chars().all(|c| "sSfLkiIvgNG4#".contains(c)) {
                    return false;
                }
            }
            _ => return false,
        }
        i += 1;
    }
    urls > 0
}

pub(super) fn wget(args: &[&str], place: &Place) -> bool {
    let mut i = 0;
    let mut urls = 0;
    while let Some(a) = args.get(i) {
        match *a {
            "-O" | "--output-document" | "-P" | "--directory-prefix" | "-o" | "--output-file" => {
                if !args.get(i + 1).is_some_and(|p| *p == "-" || place.writable(p)) {
                    return false;
                }
                i += 1;
            }
            "-T" | "--timeout" | "-t" | "--tries" | "--header" | "-U" | "--user-agent" => i += 1,
            "-q" | "--quiet" | "-nv" | "-c" | "--continue" | "--no-check-certificate" | "-S" | "--server-response" => {}
            a if a.starts_with("http://") || a.starts_with("https://") => urls += 1,
            _ => return false,
        }
        i += 1;
    }
    urls > 0 && !place.sh.away
}
