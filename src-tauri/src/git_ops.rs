use crate::git::{run_git, run_git_bytes, run_git_with, GitError, RunOptions};
use crate::git_parse::{parse_branches, parse_log, parse_name_status, BRANCH_FORMAT, COMMIT_DETAIL_FORMAT, LOG_FORMAT};
use crate::paths::{is_rooted, is_within};
use crate::types::{Branch, BranchKind, CommitDetail, CommitSummary, DiffContent, DiffTarget};
use regex::Regex;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// 路径必须是仓库内的相对路径，且不能指向 .git
pub fn assert_repo_path(cwd: &str, path: &str) -> Result<String, String> {
    let invalid = || "文件路径无效".to_string();
    if path.is_empty() || is_rooted(path) {
        return Err(invalid());
    }
    let segments: Vec<&str> = path.split(['\\', '/']).collect();
    if segments.contains(&"..") || segments[0].eq_ignore_ascii_case(".git") {
        return Err(invalid());
    }
    let full = Path::new(cwd).join(path);
    if !is_within(&full.to_string_lossy(), cwd) {
        return Err(invalid());
    }
    Ok(path.to_string())
}

static HASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{7,64}$").unwrap());

pub fn assert_hash(hash: &str) -> Result<String, String> {
    if HASH.is_match(hash) {
        Ok(hash.to_string())
    } else {
        Err("提交号无效".into())
    }
}

/// 校验页面传来的 diff 目标：路径必须在仓库内，提交号必须合法
pub fn validate_diff_target(repo: &str, target: DiffTarget) -> Result<DiffTarget, String> {
    let paths = |path: &str, orig: Option<String>| -> Result<(String, Option<String>), String> {
        let orig = orig.map(|p| assert_repo_path(repo, &p)).transpose()?;
        Ok((assert_repo_path(repo, path)?, orig))
    };
    Ok(match target {
        DiffTarget::Staged { path, orig_path } => {
            let (path, orig_path) = paths(&path, orig_path)?;
            DiffTarget::Staged { path, orig_path }
        }
        DiffTarget::Unstaged { path, orig_path } => {
            let (path, orig_path) = paths(&path, orig_path)?;
            DiffTarget::Unstaged { path, orig_path }
        }
        DiffTarget::Commit { hash, parent, path, orig_path } => {
            let (path, orig_path) = paths(&path, orig_path)?;
            let parent = parent.map(|p| assert_hash(&p)).transpose()?;
            DiffTarget::Commit { hash: assert_hash(&hash)?, parent, path, orig_path }
        }
    })
}

enum FileBytes {
    Missing,
    TooLarge,
    Bytes(Vec<u8>),
}

static MISSING_REVISION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)does not exist|exists on disk|invalid object name|bad object|not a valid object|ambiguous argument").unwrap()
});

/// 文件在该版本中不存在时返回 Missing，其他失败照常返回错误
async fn read_revision(cwd: &str, spec: &str) -> Result<FileBytes, GitError> {
    let options = RunOptions { max_buffer: MAX_DIFF_BYTES, ..Default::default() };
    match run_git_bytes(cwd, &["show", spec], options).await {
        Ok(bytes) => Ok(FileBytes::Bytes(bytes)),
        Err(error) if error.too_large => Ok(FileBytes::TooLarge),
        // 文件名含中文且不在该版本时，git 报的是 ambiguous argument 而不是 exists on disk
        Err(error) if MISSING_REVISION.is_match(&error.message) => Ok(FileBytes::Missing),
        Err(error) => Err(error),
    }
}

fn read_working_file(cwd: &str, path: &str) -> Result<FileBytes, String> {
    let full = Path::new(cwd).join(path);
    let info = match std::fs::symlink_metadata(&full) {
        Ok(info) => info,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FileBytes::Missing),
        Err(e) => return Err(e.to_string()),
    };
    // 符号链接显示其目标，和 git 记录的内容一致；不跟随到仓库外
    if info.is_symlink() {
        let target = std::fs::read_link(&full).map_err(|e| e.to_string())?;
        return Ok(FileBytes::Bytes(target.to_string_lossy().into_owned().into_bytes()));
    }
    if !info.is_file() {
        return Ok(FileBytes::Missing);
    }
    if info.len() as usize > MAX_DIFF_BYTES {
        return Ok(FileBytes::TooLarge);
    }
    std::fs::read(&full).map(FileBytes::Bytes).map_err(|e| e.to_string())
}

async fn read_sides(cwd: &str, target: &DiffTarget) -> Result<(FileBytes, FileBytes), String> {
    Ok(match target {
        DiffTarget::Staged { path, orig_path } => {
            let before = orig_path.as_deref().unwrap_or(path);
            (read_revision(cwd, &format!("HEAD:{before}")).await?, read_revision(cwd, &format!(":{path}")).await?)
        }
        DiffTarget::Unstaged { path, orig_path } => {
            let before = orig_path.as_deref().unwrap_or(path);
            (read_revision(cwd, &format!(":{before}")).await?, read_working_file(cwd, path)?)
        }
        DiffTarget::Commit { hash, parent, path, orig_path } => {
            let before = orig_path.as_deref().unwrap_or(path);
            let original = match parent {
                Some(parent) => read_revision(cwd, &format!("{parent}:{before}")).await?,
                None => FileBytes::Missing,
            };
            (original, read_revision(cwd, &format!("{hash}:{path}")).await?)
        }
    })
}

fn is_binary(bytes: &FileBytes) -> bool {
    matches!(bytes, FileBytes::Bytes(b) if b[..b.len().min(8192)].contains(&0))
}

fn text(bytes: FileBytes) -> String {
    match bytes {
        FileBytes::Bytes(b) => String::from_utf8_lossy(&b).into_owned(),
        _ => String::new(),
    }
}

pub async fn read_diff(cwd: &str, target: &DiffTarget) -> Result<DiffContent, String> {
    let (original, modified) = read_sides(cwd, target).await?;
    let empty = |binary, too_large| DiffContent { original: String::new(), modified: String::new(), binary, too_large };
    if matches!(original, FileBytes::TooLarge) || matches!(modified, FileBytes::TooLarge) {
        return Ok(empty(false, true));
    }
    if is_binary(&original) || is_binary(&modified) {
        return Ok(empty(true, false));
    }
    Ok(DiffContent { original: text(original), modified: text(modified), binary: false, too_large: false })
}

static NO_COMMITS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)does not have any commits|bad default revision").unwrap());

pub async fn read_log(cwd: &str, skip: u32, limit: u32) -> Result<Vec<CommitSummary>, String> {
    let skip = format!("--skip={skip}");
    let limit = format!("-n{limit}");
    let format = format!("--format={LOG_FORMAT}");
    match run_git(cwd, &["log", &skip, &limit, &format]).await {
        Ok(output) => Ok(parse_log(&output)),
        Err(error) if NO_COMMITS.is_match(&error.message) => Ok(vec![]),
        Err(error) => Err(error.message),
    }
}

pub async fn read_commit(cwd: &str, hash: &str) -> Result<CommitDetail, String> {
    let format = format!("--format={COMMIT_DETAIL_FORMAT}");
    let output = run_git(cwd, &["show", "-s", &format, hash]).await?;
    let fields: Vec<&str> = output.splitn(6, '\0').collect();
    let field = |i: usize| fields.get(i).copied().unwrap_or("");
    let parents: Vec<String> = field(1).split(' ').filter(|p| !p.is_empty()).map(String::from).collect();
    // 合并提交和第一父提交比较；根提交和空树比较
    let names = match parents.first() {
        Some(first) => run_git(cwd, &["diff", "--name-status", "-M", "-z", first, hash]).await?,
        None => run_git(cwd, &["diff-tree", "--root", "-r", "-M", "--name-status", "-z", "--no-commit-id", hash]).await?,
    };
    Ok(CommitDetail {
        hash: field(0).into(),
        parents,
        author: field(2).into(),
        email: field(3).into(),
        time: field(4).trim().parse::<i64>().unwrap_or(0) * 1000,
        message: field(5).trim_end().into(),
        files: parse_name_status(&names),
    })
}

pub async fn list_branches(cwd: &str) -> Result<Vec<Branch>, String> {
    let format = format!("--format={BRANCH_FORMAT}");
    let output = run_git(cwd, &["for-each-ref", "--sort=-committerdate", &format, "refs/heads", "refs/remotes"]).await?;
    Ok(parse_branches(&output))
}

const SWITCH_TIMEOUT: Duration = Duration::from_secs(5 * 60);

async fn assert_branch_name(cwd: &str, name: &str) -> Result<String, String> {
    if name.trim().is_empty() || name.starts_with('-') {
        return Err("分支名无效".into());
    }
    run_git(cwd, &["check-ref-format", "--branch", name])
        .await
        .map_err(|_| format!("分支名无效：{name}"))?;
    Ok(name.to_string())
}

/// 不加 --force 或 --discard-changes：会覆盖工作区改动时由 git 拒绝，改动保留
pub async fn switch_branch(cwd: &str, name: &str, kind: BranchKind) -> Result<(), String> {
    let branch = assert_branch_name(cwd, name).await?;
    let args = match kind {
        BranchKind::Remote => ["switch", "--track", branch.as_str()],
        BranchKind::Local => ["switch", "--no-guess", branch.as_str()],
    };
    let options = RunOptions { timeout: SWITCH_TIMEOUT, ..Default::default() };
    match run_git_with(cwd, &args, options).await {
        Ok(_) => Ok(()),
        Err(error) if error.message.contains("would be overwritten") => Err(format!(
            "工作区的改动会被覆盖，没有切换到 {branch}，改动都还在。请先提交或暂存后再切换"
        )),
        Err(error) => Err(error.message),
    }
}

pub async fn list_remotes(cwd: &str) -> Result<Vec<String>, GitError> {
    Ok(run_git(cwd, &["remote"]).await?.lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::read_changes;
    use crate::git::test_repo::*;

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn repo_path_validation() {
        let repo = if cfg!(windows) { "E:\\repo" } else { "/repo" };
        assert!(assert_repo_path(repo, "src/a.ts").is_ok());
        assert!(assert_repo_path(repo, "中文 名.ts").is_ok());
        for bad in ["", "../x", "a/../../x", ".git/config", ".GIT\\HEAD", "/etc/passwd", "\\x"] {
            assert!(assert_repo_path(repo, bad).is_err(), "{bad}");
        }
        #[cfg(windows)]
        assert!(assert_repo_path(repo, "C:\\x").is_err());
    }

    #[test]
    fn hash_validation() {
        assert!(assert_hash("abc1234").is_ok());
        assert!(assert_hash(&"a".repeat(40)).is_ok());
        for bad in ["abc", "--all", "HEAD", "abc123z"] {
            assert!(assert_hash(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn diff_sides_for_unstaged_staged_added_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        commit_file(dir.path(), "a.txt", "one\n", "init");
        commit_file(dir.path(), "gone.txt", "bye\n", "two");
        std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        git(dir.path(), &["add", "a.txt"]);
        std::fs::write(dir.path().join("a.txt"), "three\n").unwrap();
        std::fs::write(dir.path().join("新.txt"), "new\n").unwrap();
        std::fs::remove_file(dir.path().join("gone.txt")).unwrap();

        let target = |kind: &str, path: &str| -> DiffTarget {
            serde_json::from_value(serde_json::json!({ "kind": kind, "path": path, "origPath": null })).unwrap()
        };
        let staged = read_diff(&repo, &target("staged", "a.txt")).await.unwrap();
        assert_eq!((staged.original.as_str(), staged.modified.as_str()), ("one\n", "two\n"));
        let unstaged = read_diff(&repo, &target("unstaged", "a.txt")).await.unwrap();
        assert_eq!((unstaged.original.as_str(), unstaged.modified.as_str()), ("two\n", "three\n"));
        let added = read_diff(&repo, &target("unstaged", "新.txt")).await.unwrap();
        assert_eq!((added.original.as_str(), added.modified.as_str()), ("", "new\n"));
        let deleted = read_diff(&repo, &target("unstaged", "gone.txt")).await.unwrap();
        assert_eq!((deleted.original.as_str(), deleted.modified.as_str()), ("bye\n", ""));
    }

    #[tokio::test]
    async fn staged_file_without_commits() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        git(dir.path(), &["add", "a.txt"]);
        let target = DiffTarget::Staged { path: "a.txt".into(), orig_path: None };
        let diff = read_diff(&s(dir.path()), &target).await.unwrap();
        assert_eq!((diff.original.as_str(), diff.modified.as_str()), ("", "x"));
    }

    #[tokio::test]
    async fn commit_diff_root_and_rename() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        commit_file(dir.path(), "old.txt", "same content here\n", "root");
        git(dir.path(), &["mv", "old.txt", "new.txt"]);
        git(dir.path(), &["-c", "user.name=a", "-c", "user.email=a@b", "commit", "-q", "-m", "rename"]);
        let log = read_log(&repo, 0, 10).await.unwrap();
        assert_eq!(log.len(), 2);
        let root = read_commit(&repo, &log[1].hash).await.unwrap();
        assert_eq!(root.files[0].path, "old.txt");
        let renamed = read_commit(&repo, &log[0].hash).await.unwrap();
        assert_eq!(renamed.files[0].orig_path.as_deref(), Some("old.txt"));
        let target = DiffTarget::Commit {
            hash: log[0].hash.clone(),
            parent: Some(log[1].hash.clone()),
            path: "new.txt".into(),
            orig_path: Some("old.txt".into()),
        };
        let diff = read_diff(&repo, &target).await.unwrap();
        assert_eq!(diff.original, diff.modified);
        let root_target = DiffTarget::Commit { hash: log[1].hash.clone(), parent: None, path: "old.txt".into(), orig_path: None };
        assert_eq!(read_diff(&repo, &root_target).await.unwrap().original, "");
    }

    #[tokio::test]
    async fn binary_and_large_files_are_not_returned() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        commit_file(dir.path(), "a.txt", "x", "init");
        std::fs::write(dir.path().join("bin.dat"), [1u8, 0, 2]).unwrap();
        std::fs::write(dir.path().join("big.txt"), "x".repeat(MAX_DIFF_BYTES + 1)).unwrap();
        let bin = read_diff(&repo, &DiffTarget::Unstaged { path: "bin.dat".into(), orig_path: None }).await.unwrap();
        assert!(bin.binary);
        let big = read_diff(&repo, &DiffTarget::Unstaged { path: "big.txt".into(), orig_path: None }).await.unwrap();
        assert!(big.too_large);
    }

    #[tokio::test]
    async fn log_paging_empty_and_multiline() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        assert!(read_log(&repo, 0, 10).await.unwrap().is_empty());
        for i in 0..3 {
            commit_file(dir.path(), "a.txt", &i.to_string(), &format!("第 {i} 次\n\n详细说明"));
        }
        let page = read_log(&repo, 1, 1).await.unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].subject, "第 1 次");
        let detail = read_commit(&repo, &page[0].hash).await.unwrap();
        assert_eq!(detail.message, "第 1 次\n\n详细说明");
    }

    #[tokio::test]
    async fn read_operations_do_not_touch_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        commit_file(dir.path(), "a.txt", "x", "init");
        std::fs::write(dir.path().join("a.txt"), "y").unwrap();
        let index = dir.path().join(".git").join("index");
        let before = std::fs::read(&index).unwrap();
        let modified = std::fs::metadata(&index).unwrap().modified().unwrap();
        read_changes(&repo).await.unwrap();
        read_log(&repo, 0, 10).await.unwrap();
        list_branches(&repo).await.unwrap();
        read_diff(&repo, &DiffTarget::Unstaged { path: "a.txt".into(), orig_path: None }).await.unwrap();
        assert_eq!(std::fs::read(&index).unwrap(), before);
        assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), modified);
    }

    #[tokio::test]
    async fn switching_branches() {
        let dir = tempfile::tempdir().unwrap();
        let repo = s(dir.path());
        init(dir.path());
        commit_file(dir.path(), "a.txt", "main", "init");
        git(dir.path(), &["branch", "功能"]);
        // 不相关的未提交改动跟着走
        std::fs::write(dir.path().join("other.txt"), "wip").unwrap();
        switch_branch(&repo, "功能", BranchKind::Local).await.unwrap();
        let branches = list_branches(&repo).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "功能" && b.current));
        assert!(dir.path().join("other.txt").exists());

        commit_file(dir.path(), "a.txt", "feature", "change");
        switch_branch(&repo, "main", BranchKind::Local).await.unwrap();
        std::fs::write(dir.path().join("a.txt"), "dirty").unwrap();
        let error = switch_branch(&repo, "功能", BranchKind::Local).await.unwrap_err();
        assert!(error.contains("改动都还在"), "{error}");
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "dirty");

        for bad in ["-f", "a..b", "nope"] {
            assert!(switch_branch(&repo, bad, BranchKind::Local).await.is_err(), "{bad}");
        }
        let head = git(dir.path(), &["rev-parse", "HEAD"]);
        assert!(switch_branch(&repo, head.trim(), BranchKind::Local).await.is_err());
    }
}
