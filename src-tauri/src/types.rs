//! 和页面共用的数据结构，字段名与 src/shared/types.ts、src/shared/repo.ts 保持一致

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LastCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    /// 毫秒时间戳
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    /// 已去掉其中的账号和令牌
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub conflicted: u32,
    pub stash_count: u32,
    pub last_commit: Option<LastCommit>,
    pub remotes: Vec<RemoteInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageLines {
    pub name: String,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub size: u64,
    pub generated_size: u64,
    pub lines: u64,
    pub languages: Vec<LanguageLines>,
    pub truncated: bool,
    pub computed_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub path: String,
    pub name: String,
    pub missing: bool,
    pub is_git: bool,
    pub git: Option<GitStatus>,
    pub git_error: Option<String>,
    pub tech: Vec<String>,
    pub last_activity: Option<i64>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub category_id: Option<String>,
    pub remark: Option<String>,
    pub stats: Option<ProjectStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub filter: String,
    pub scope: String,
    pub active_tag: Option<String>,
    pub query: String,
    pub sort: String,
    pub sort_reverse: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub roots: Vec<String>,
    pub manual: Vec<String>,
    pub hidden: Vec<String>,
    pub excluded: Vec<String>,
    pub categories: Vec<Category>,
    pub theme: String,
    pub auto_fetch_minutes: u32,
    pub close_to_tray: bool,
    pub saved_views: Vec<SavedView>,
}

pub const AUTO_FETCH_OPTIONS: [u32; 5] = [0, 15, 30, 60, 120];
pub const DEFAULT_AUTO_FETCH_MINUTES: u32 = 30;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FailedFetch {
    pub name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoFetchStatus {
    pub last_run: Option<i64>,
    pub succeeded: u32,
    pub failed: Vec<FailedFetch>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Readme {
    pub name: String,
    pub content: String,
    pub markdown: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenProject {
    pub path: String,
    pub name: String,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetaValues {
    pub favorite: bool,
    pub tags: Vec<String>,
    pub category_id: Option<String>,
    pub remark: Option<String>,
}

/// 区分“没给这个字段”和“给了 null”
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// 批量修改：只改给出的字段
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<String>>,
    pub favorite: Option<bool>,
    pub add_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMove {
    pub from: String,
    pub to: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub hidden_projects: Vec<HiddenProject>,
    pub config: Config,
    pub scan_errors: Vec<ScanError>,
    pub moves: Vec<ProjectMove>,
}

// ---- 仓库详情 ----

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileState {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Typechange,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub state: FileState,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChanges {
    pub staged: Vec<ChangedFile>,
    pub unstaged: Vec<ChangedFile>,
    pub conflicted: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanges {
    pub status: GitStatus,
    #[serde(flatten)]
    pub changes: FileChanges,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffTarget {
    #[serde(rename_all = "camelCase")]
    Staged { path: String, orig_path: Option<String> },
    #[serde(rename_all = "camelCase")]
    Unstaged { path: String, orig_path: Option<String> },
    #[serde(rename_all = "camelCase")]
    Commit {
        hash: String,
        parent: Option<String>,
        path: String,
        orig_path: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffContent {
    pub original: String,
    pub modified: String,
    pub binary: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BranchKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub kind: BranchKind,
    pub current: bool,
    pub hash: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub gone: bool,
    pub time: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub message: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResult {
    pub ok: bool,
    pub cancelled: bool,
    pub message: String,
}

impl RemoteResult {
    pub fn ok() -> Self {
        Self { ok: true, cancelled: false, message: String::new() }
    }
    pub fn failed(message: impl Into<String>) -> Self {
        Self { ok: false, cancelled: false, message: message.into() }
    }
    pub fn cancelled() -> Self {
        Self { ok: false, cancelled: true, message: "已取消".into() }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FetchAllItem {
    pub path: String,
    pub name: String,
    #[serde(flatten)]
    pub result: RemoteResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProgress {
    pub op_id: String,
    pub line: String,
}

/// 刷新进度；total 为 None 表示还在扫描目录，不知道有多少项目
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: Option<usize>,
    /// 刚读取完的项目名
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsUpdate {
    pub path: String,
    pub stats: ProjectStats,
}
