use crate::git::git_command;
use crate::git_ops::list_remotes;
use crate::types::RemoteResult;
use regex::Regex;
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const OUTPUT_TAIL: usize = 4000;
/// git 退出后等输出读完的上限；钩子留下的子进程可能一直占着管道
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

pub type ProgressFn = Arc<dyn Fn(String) + Send + Sync>;

pub struct RemoteOptions {
    pub on_progress: Option<ProgressFn>,
    pub cancel: CancellationToken,
    pub timeout: Duration,
    /// 批量操作时不弹出凭据窗口，否则多个仓库会连续弹窗
    pub non_interactive: bool,
}

impl Default for RemoteOptions {
    fn default() -> Self {
        Self { on_progress: None, cancel: CancellationToken::new(), timeout: DEFAULT_TIMEOUT, non_interactive: false }
    }
}

static NOISE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(hint|remote):").unwrap());
static AUTH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Authentication failed|could not read Username|terminal prompts disabled").unwrap());
static NETWORK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Could not resolve host|unable to access|Failed to connect|timed out").unwrap());

pub fn describe_remote_error(output: &str) -> String {
    let lines: Vec<&str> = output.split(['\r', '\n']).map(str::trim).filter(|l| !l.is_empty()).collect();
    let last = lines
        .iter()
        .rev()
        .find(|l| !NOISE.is_match(l))
        .or(lines.last())
        .copied()
        .unwrap_or("操作失败");
    let hint = if AUTH.is_match(output) {
        Some("认证失败，请检查凭据")
    } else if NETWORK.is_match(output) {
        Some("无法连接远程仓库")
    } else {
        None
    };
    match hint {
        Some(hint) => format!("{hint}（{last}）"),
        None => last.to_string(),
    }
}

/// Windows 上只杀 git.exe 会留下 git-remote-https 等子进程
fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        let mut command = std::process::Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        std::os::windows::process::CommandExt::creation_flags(&mut command, crate::git::CREATE_NO_WINDOW);
        let _ = command.spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").arg(pid.to_string()).spawn();
    }
}

fn keep_tail(tail: &mut String) {
    let count = tail.chars().count();
    if count > OUTPUT_TAIL {
        *tail = tail.chars().skip(count - OUTPUT_TAIL).collect();
    }
}

/// 只更新远程跟踪分支，不改动工作区和本地分支
pub async fn run_fetch(cwd: &str, options: RemoteOptions) -> RemoteResult {
    if options.cancel.is_cancelled() {
        return RemoteResult::cancelled();
    }
    match list_remotes(cwd).await {
        Ok(remotes) if remotes.is_empty() => return RemoteResult::failed("没有配置远程仓库"),
        Ok(_) => {}
        Err(error) => return RemoteResult::failed(error.message),
    }
    // 检查期间也可能被取消
    if options.cancel.is_cancelled() {
        return RemoteResult::cancelled();
    }

    let env: &[(&str, &str)] = if options.non_interactive { &[("GCM_INTERACTIVE", "never")] } else { &[] };
    let mut command = git_command(cwd, env);
    command.args(["fetch", "--progress"]).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return RemoteResult::failed("未找到 git"),
        Err(e) => return RemoteResult::failed(e.to_string()),
    };

    let tail = Arc::new(Mutex::new(String::new()));
    let readers: Vec<_> = [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|mut stream| {
        let tail = tail.clone();
        let on_progress = options.on_progress.clone();
        tokio::spawn(async move {
            let mut chunk = vec![0u8; 8192];
            while let Ok(n) = stream.read(&mut chunk).await {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&chunk[..n]).into_owned();
                {
                    let mut tail = tail.lock().unwrap();
                    tail.push_str(&text);
                    keep_tail(&mut tail);
                }
                // 进度行用 \r 覆盖刷新
                if let (Some(callback), Some(line)) =
                    (&on_progress, text.split(['\r', '\n']).filter(|l| !l.trim().is_empty()).last())
                {
                    callback(line.trim().to_string());
                }
            }
        })
    })
    .collect();

    let pid = child.id();
    tokio::select! {
        status = child.wait() => {
            // 正常退出时把剩下的输出读完再判断；读不完也不无限等
            let _ = tokio::time::timeout(DRAIN_TIMEOUT, futures::future::join_all(readers)).await;
            match status {
                Ok(status) if status.success() => RemoteResult::ok(),
                Ok(_) => RemoteResult::failed(describe_remote_error(&tail.lock().unwrap())),
                Err(e) => RemoteResult::failed(e.to_string()),
            }
        }
        _ = options.cancel.cancelled() => {
            kill_tree(pid);
            RemoteResult::cancelled()
        }
        _ = tokio::time::sleep(options.timeout) => {
            kill_tree(pid);
            RemoteResult::failed("操作超时")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::*;
    use crate::git_ops::list_branches;
    use std::path::Path;

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn describes_errors_in_chinese() {
        let auth = describe_remote_error("remote: nope\nfatal: Authentication failed for 'https://x'\n");
        assert_eq!(auth, "认证失败，请检查凭据（fatal: Authentication failed for 'https://x'）");
        let net = describe_remote_error("fatal: unable to access 'https://x/': Could not resolve host: x");
        assert!(net.starts_with("无法连接远程仓库"));
        assert_eq!(describe_remote_error("hint: a\nfatal: other"), "fatal: other");
        assert_eq!(describe_remote_error(""), "操作失败");
    }

    #[tokio::test]
    async fn fetch_updates_tracking_branches_only() {
        let root = tempfile::tempdir().unwrap();
        let upstream = root.path().join("upstream");
        std::fs::create_dir(&upstream).unwrap();
        init(&upstream);
        commit_file(&upstream, "a.txt", "1", "one");
        let clone = root.path().join("clone");
        git(root.path(), &["clone", "-q", &s(&upstream), &s(&clone)]);
        commit_file(&upstream, "a.txt", "2", "two");

        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let options = RemoteOptions { on_progress: Some(Arc::new(move |l| sink.lock().unwrap().push(l))), ..Default::default() };
        let result = run_fetch(&s(&clone), options).await;
        assert!(result.ok, "{}", result.message);
        let branches = list_branches(&s(&clone)).await.unwrap();
        let main = branches.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main.behind, 1);
        assert_eq!(std::fs::read_to_string(clone.join("a.txt")).unwrap(), "1");
    }

    #[tokio::test]
    async fn fetch_without_remote_and_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        let result = run_fetch(&s(dir.path()), RemoteOptions::default()).await;
        assert_eq!(result, RemoteResult::failed("没有配置远程仓库"));

        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = run_fetch(&s(dir.path()), RemoteOptions { cancel, ..Default::default() }).await;
        assert!(result.cancelled);
    }
}
