//! 调用 git 命令行；只读展示的命令不抢占 index.lock，输出保持英文和原始 UTF-8

use crate::git_parse::{parse_changes, parse_last_commit, parse_remotes, parse_status, LAST_COMMIT_FORMAT};
use crate::types::{GitStatus, RemoteInfo, RepoChanges};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct GitError {
    pub message: String,
    pub too_large: bool,
}

impl GitError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), too_large: false }
    }
}

impl From<GitError> for String {
    fn from(error: GitError) -> Self {
        error.message
    }
}

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BUFFER: usize = 32 * 1024 * 1024;

/// 不抢占 index.lock，也不刷新 index；路径一律按字面匹配；文件名不转义
pub const GIT_BASE_ARGS: [&str; 4] = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.quotepath=false"];

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 准备好环境变量的 git 命令；不弹凭据输入，输出用英文便于解析
pub fn git_command(cwd: &str, extra_env: &[(&str, &str)]) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args(GIT_BASE_ARGS)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    for (key, value) in extra_env {
        command.env(key, value);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub struct RunOptions {
    pub timeout: Duration,
    pub max_buffer: usize,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self { timeout: TIMEOUT, max_buffer: MAX_BUFFER }
    }
}

/// hint 行是给命令行用户的建议，界面上不显示
fn clean_stderr(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .filter(|line| !line.starts_with("hint:"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub async fn run_git_bytes(cwd: &str, args: &[&str], options: RunOptions) -> Result<Vec<u8>, GitError> {
    let mut command = git_command(cwd, &[]);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::new("未找到 git，请确认已安装并加入 PATH")
        } else {
            GitError::new(e.to_string())
        }
    })?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let max = options.max_buffer;

    let work = async move {
        // 超出上限时提前放弃读取；关掉管道后 git 写不进去会自己退出
        let read_out = async move {
            let mut buffer = Vec::new();
            let mut chunk = vec![0u8; 64 * 1024];
            loop {
                let n = stdout.read(&mut chunk).await?;
                if n == 0 {
                    return Ok::<_, std::io::Error>(Some(buffer));
                }
                buffer.extend_from_slice(&chunk[..n]);
                if buffer.len() > max {
                    return Ok(None);
                }
            }
        };
        let read_err = async move {
            let mut buffer = Vec::new();
            stderr.read_to_end(&mut buffer).await.map(|_| buffer)
        };
        let (out, err) = tokio::join!(read_out, read_err);
        let status = child.wait().await;
        (out, err, status)
    };

    let (out, err, status) = tokio::time::timeout(options.timeout, work)
        .await
        .map_err(|_| GitError::new(format!("git {} 超时", args.first().unwrap_or(&""))))?;
    let out = out.map_err(|e| GitError::new(e.to_string()))?;
    let Some(out) = out else {
        return Err(GitError { message: "输出过大".into(), too_large: true });
    };
    let status = status.map_err(|e| GitError::new(e.to_string()))?;
    if status.success() {
        return Ok(out);
    }
    let message = clean_stderr(&err.unwrap_or_default());
    Err(GitError::new(if message.is_empty() {
        format!("git 退出码 {}", status.code().unwrap_or(-1))
    } else {
        message
    }))
}

pub async fn run_git_with(cwd: &str, args: &[&str], options: RunOptions) -> Result<String, GitError> {
    let bytes = run_git_bytes(cwd, args, options).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn run_git(cwd: &str, args: &[&str]) -> Result<String, GitError> {
    run_git_with(cwd, args, RunOptions::default()).await
}

const STATUS_ARGS: [&str; 5] = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];

pub async fn read_remotes(cwd: &str) -> Result<Vec<RemoteInfo>, GitError> {
    Ok(parse_remotes(&run_git(cwd, &["remote", "-v"]).await?))
}

async fn full_status(cwd: &str, output: &str) -> Result<GitStatus, GitError> {
    let mut status = parse_status(output);
    if status.head.is_some() {
        let format = format!("--format={LAST_COMMIT_FORMAT}");
        status.last_commit = parse_last_commit(&run_git(cwd, &["log", "-1", &format]).await?);
        let stashes = run_git(cwd, &["stash", "list", "--format=%h"]).await?;
        status.stash_count = stashes.lines().filter(|l| !l.is_empty()).count() as u32;
    }
    status.remotes = read_remotes(cwd).await?;
    Ok(status)
}

pub async fn read_status(cwd: &str) -> Result<GitStatus, GitError> {
    let output = run_git(cwd, &STATUS_ARGS).await?;
    full_status(cwd, &output).await
}

pub async fn read_changes(cwd: &str) -> Result<RepoChanges, GitError> {
    let output = run_git(cwd, &STATUS_ARGS).await?;
    Ok(RepoChanges { status: full_status(cwd, &output).await?, changes: parse_changes(&output) })
}

#[cfg(test)]
pub mod test_repo {
    //! 测试用的真实仓库
    use std::path::Path;
    use std::process::Command;

    pub fn git(cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(cwd)
            .args(["-c", "user.name=测试", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
            .args(args)
            .env("LC_ALL", "C")
            .output()
            .expect("git");
        assert!(output.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    pub fn init(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
    }

    pub fn commit_file(dir: &Path, name: &str, content: &str, message: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
        git(dir, &["add", "--", name]);
        git(dir, &["commit", "-q", "-m", message]);
    }
}

#[cfg(test)]
mod tests {
    use super::test_repo::*;
    use super::*;

    fn s(path: &std::path::Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn status_of_empty_repo() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        let status = read_status(&s(dir.path())).await.unwrap();
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.head, None);
        assert_eq!(status.last_commit, None);
    }

    #[tokio::test]
    async fn status_with_chinese_paths_renames_and_untracked() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        commit_file(dir.path(), "旧 名.txt", "a\n", "第一次提交");
        git(dir.path(), &["mv", "旧 名.txt", "新 名.txt"]);
        std::fs::write(dir.path().join("未跟踪.md"), "x").unwrap();
        let changes = read_changes(&s(dir.path())).await.unwrap();
        assert_eq!(changes.status.staged, 1);
        assert_eq!(changes.status.untracked, 1);
        assert_eq!(changes.status.last_commit.as_ref().unwrap().subject, "第一次提交");
        assert_eq!(changes.changes.staged[0].path, "新 名.txt");
        assert_eq!(changes.changes.staged[0].orig_path.as_deref(), Some("旧 名.txt"));
        assert_eq!(changes.changes.unstaged[0].path, "未跟踪.md");
    }

    #[tokio::test]
    async fn not_a_repo_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_status(&s(dir.path())).await.is_err());
    }
}
