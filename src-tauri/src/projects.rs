use crate::git::read_status;
use crate::paths::{base_name, is_within, path_key};
use crate::remotes::remote_identity;
use crate::scanner::{latest_modified, scan_root, DEFAULT_SCAN_DEPTH};
use crate::stats::StatsService;
use crate::store::Store;
use crate::tech::detect_tech;
use crate::types::{GitStatus, HiddenProject, Project, ProjectMove, ScanError, Snapshot};
use futures::stream::{self, StreamExt};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// 同时检查的项目数；主要耗时在 git 子进程
const CONCURRENCY: usize = 8;

/// 按顺序返回结果，同时最多运行 limit 个
pub async fn map_limit<T, R, F, Fut>(items: Vec<T>, limit: usize, f: F) -> Vec<R>
where
    F: Fn(T) -> Fut,
    Fut: Future<Output = R>,
{
    stream::iter(items).map(f).buffered(limit.max(1)).collect().await
}

/// 项目本身的信息，不含用户添加的信息和统计
pub struct Inspected {
    pub path: String,
    pub name: String,
    pub missing: bool,
    pub is_git: bool,
    pub git: Option<GitStatus>,
    pub git_error: Option<String>,
    pub tech: Vec<String>,
    pub last_activity: Option<i64>,
}

fn describe_git_error(message: String) -> String {
    if message.contains("not a git repository") {
        ".git 无效（可能为空或已损坏），git 无法识别这个仓库".into()
    } else {
        message
    }
}

pub async fn inspect_project(path: String) -> Inspected {
    let name = base_name(&path);
    let names: Option<Vec<String>> = std::fs::read_dir(&path)
        .ok()
        .map(|entries| entries.filter_map(Result::ok).map(|e| e.file_name().to_string_lossy().into_owned()).collect());
    let Some(names) = names else {
        return Inspected { path, name, missing: true, is_git: false, git: None, git_error: None, tech: vec![], last_activity: None };
    };

    let is_git = names.iter().any(|n| n == ".git");
    let (git, git_error) = if is_git {
        match read_status(&path).await {
            Ok(status) => (Some(status), None),
            Err(error) => (None, Some(describe_git_error(error.message))),
        }
    } else {
        (None, None)
    };
    let pkg: Option<Value> = names
        .iter()
        .any(|n| n == "package.json")
        .then(|| std::fs::read_to_string(Path::new(&path).join("package.json")).ok())
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(Value::is_object);
    let modified = {
        let path = path.clone();
        tokio::task::spawn_blocking(move || latest_modified(&path)).await.ok().flatten()
    };
    let commit_time = git.as_ref().and_then(|g| g.last_commit.as_ref()).map(|c| c.time);
    Inspected {
        tech: detect_tech(&names, pkg.as_ref()),
        last_activity: [commit_time, modified].into_iter().flatten().max(),
        path,
        name,
        missing: false,
        is_git,
        git,
        git_error,
    }
}

fn primary_remote(git: Option<&GitStatus>) -> Option<String> {
    let remotes = &git?.remotes;
    let remote = remotes.iter().find(|r| r.name == "origin").or(remotes.first())?;
    remote_identity(&remote.url)
}

/// 同一个地址有多个旧路径或多个新项目时无法判断对应关系，宁可不提示
pub fn pair_moves(sources: &[(String, String)], targets: &[(String, String)]) -> Vec<(String, String)> {
    sources
        .iter()
        .filter_map(|(from, remote)| {
            let same_source = sources.iter().filter(|(_, r)| r == remote).count();
            let same_target: Vec<&(String, String)> = targets.iter().filter(|(_, r)| r == remote).collect();
            (same_source == 1 && same_target.len() == 1).then(|| (from.clone(), same_target[0].0.clone()))
        })
        .collect()
}

pub type SnapshotFn = Arc<dyn Fn(&Snapshot) + Send + Sync>;

pub struct ProjectService {
    store: Arc<Mutex<Store>>,
    stats: Arc<StatsService>,
    /// 最近一次快照包含的路径，页面只能操作这些路径
    known: Mutex<HashSet<String>>,
    /// 最近一次快照给出的迁移建议，确认时只接受这些
    moves: Mutex<Vec<ProjectMove>>,
    stats_paths: Mutex<Vec<String>>,
    on_snapshot: Mutex<Option<SnapshotFn>>,
}

impl ProjectService {
    pub fn new(store: Arc<Mutex<Store>>, stats: Arc<StatsService>) -> Self {
        Self {
            store,
            stats,
            known: Mutex::default(),
            moves: Mutex::default(),
            stats_paths: Mutex::default(),
            on_snapshot: Mutex::default(),
        }
    }

    pub fn set_on_snapshot(&self, callback: SnapshotFn) {
        *self.on_snapshot.lock().unwrap() = Some(callback);
    }

    pub fn recompute_stats(&self) {
        let paths = self.stats_paths.lock().unwrap().clone();
        self.stats.schedule(&paths, true, chrono::Utc::now().timestamp_millis());
    }

    pub fn is_known(&self, path: &str) -> bool {
        self.known.lock().unwrap().contains(&path_key(path))
    }

    pub fn suggested_moves(&self, from: &[String]) -> Vec<ProjectMove> {
        let keys: HashSet<String> = from.iter().map(|p| path_key(p)).collect();
        self.moves.lock().unwrap().iter().filter(|m| keys.contains(&path_key(&m.from))).cloned().collect()
    }

    /// 旧路径还在的是两份副本，不算移动；已有信息的项目不覆盖
    fn find_moves(&self, projects: &[Project]) -> Vec<ProjectMove> {
        let store = self.store.lock().unwrap();
        let targets: Vec<(String, String)> = projects
            .iter()
            .filter(|p| !p.favorite && p.tags.is_empty() && p.category_id.is_none() && p.remark.is_none())
            .filter_map(|p| Some((p.path.clone(), primary_remote(p.git.as_ref())?)))
            .collect();
        let remotes: HashSet<&String> = targets.iter().map(|(_, r)| r).collect();
        let sources: Vec<(String, String)> = store
            .move_sources()
            .into_iter()
            .filter(|(from, remote)| remotes.contains(remote) && !Path::new(from).exists())
            .collect();
        pair_moves(&sources, &targets)
            .into_iter()
            .map(|(from, to)| ProjectMove { name: store.meta_of(&from).remark.unwrap_or_else(|| base_name(&from)), from, to })
            .collect()
    }

    pub async fn snapshot(&self) -> Result<Snapshot, String> {
        let config = self.store.lock().unwrap().config();
        let mut scan_errors = Vec::new();
        // 保持发现的顺序，按不区分大小写的路径去重
        let mut paths: Vec<String> = Vec::new();
        let mut seen: HashMap<String, ()> = HashMap::new();
        let mut collect = |path: String| {
            if seen.insert(path_key(&path), ()).is_none() {
                paths.push(path);
            }
        };

        let roots = config.roots.clone();
        let scanned = tokio::task::spawn_blocking(move || {
            roots.into_iter().map(|root| (root.clone(), scan_root(&root, DEFAULT_SCAN_DEPTH))).collect::<Vec<_>>()
        })
        .await
        .map_err(|e| e.to_string())?;
        for (root, result) in scanned {
            match result {
                Ok(found) => found
                    .into_iter()
                    .filter(|p| !config.excluded.iter().any(|dir| is_within(p, dir)))
                    .for_each(&mut collect),
                Err(message) => scan_errors.push(ScanError { path: root, message }),
            }
        }
        config.manual.iter().cloned().for_each(&mut collect);

        let hidden: HashSet<String> = config.hidden.iter().map(|p| path_key(p)).collect();
        let visible: Vec<String> = paths.iter().filter(|p| !hidden.contains(&path_key(p))).cloned().collect();

        let inspected = map_limit(visible, CONCURRENCY, inspect_project).await;
        let projects: Vec<Project> = {
            let store = self.store.lock().unwrap();
            inspected
                .into_iter()
                .map(|p| {
                    let meta = store.meta_of(&p.path);
                    Project {
                        stats: self.stats.get(&p.path),
                        favorite: meta.favorite,
                        tags: meta.tags,
                        category_id: meta.category_id,
                        remark: meta.remark,
                        path: p.path,
                        name: p.name,
                        missing: p.missing,
                        is_git: p.is_git,
                        git: p.git,
                        git_error: p.git_error,
                        tech: p.tech,
                        last_activity: p.last_activity,
                    }
                })
                .collect()
        };

        let tracked: Vec<(String, Option<String>)> =
            projects.iter().filter(|p| !p.missing).map(|p| (p.path.clone(), primary_remote(p.git.as_ref()))).collect();
        self.store.lock().unwrap().track_projects(&tracked)?;
        let moves = self.find_moves(&projects);
        *self.moves.lock().unwrap() = moves.clone();

        *self.known.lock().unwrap() =
            paths.iter().map(|p| path_key(p)).chain(config.hidden.iter().map(|p| path_key(p))).collect();
        // 隐藏的项目只列名称，不跑 git，不拖慢刷新
        let hidden_projects: Vec<HiddenProject> = {
            let store = self.store.lock().unwrap();
            config
                .hidden
                .iter()
                .map(|path| HiddenProject { path: path.clone(), name: base_name(path), remark: store.meta_of(path).remark })
                .collect()
        };
        let stats_paths: Vec<String> = projects.iter().filter(|p| !p.missing).map(|p| p.path.clone()).collect();
        self.stats.schedule(&stats_paths, false, chrono::Utc::now().timestamp_millis());
        *self.stats_paths.lock().unwrap() = stats_paths;

        let snapshot = Snapshot { projects, hidden_projects, config, scan_errors, moves };
        let callback = self.on_snapshot.lock().unwrap().clone();
        if let Some(callback) = callback {
            callback(&snapshot);
        }
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::*;
    use crate::types::ProjectStats;
    use std::fs;

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn pair(a: &str, b: &str) -> (String, String) {
        (a.into(), b.into())
    }

    fn service(dir: &Path) -> (Arc<Mutex<Store>>, ProjectService) {
        let store = Arc::new(Mutex::new(Store::open(dir.join("store.json"))));
        let stats = StatsService::with_compute(
            dir.join("stats.json"),
            Arc::new(|_| {
                Box::pin(async {
                    Ok(ProjectStats { size: 0, generated_size: 0, lines: 0, languages: vec![], truncated: false, computed_at: 0 })
                })
            }),
        );
        (store.clone(), ProjectService::new(store, stats))
    }

    #[test]
    fn pairs_only_unambiguous_moves() {
        assert_eq!(pair_moves(&[pair("old", "r")], &[pair("new", "r")]), [pair("old", "new")]);
        assert!(pair_moves(&[pair("old", "r")], &[pair("new", "x")]).is_empty());
        assert!(pair_moves(&[pair("a", "r"), pair("b", "r")], &[pair("new", "r")]).is_empty());
        assert!(pair_moves(&[pair("old", "r")], &[pair("n1", "r"), pair("n2", "r")]).is_empty());
    }

    #[tokio::test]
    async fn combines_scan_and_manual_and_hides() {
        let data = tempfile::tempdir().unwrap();
        let code = tempfile::tempdir().unwrap();
        fs::create_dir_all(code.path().join("a")).unwrap();
        fs::write(code.path().join("a/package.json"), r#"{"dependencies":{"vue":"3"}}"#).unwrap();
        fs::create_dir_all(code.path().join("b")).unwrap();
        fs::write(code.path().join("b/main.py"), "").unwrap();
        let manual = tempfile::tempdir().unwrap();
        let (store, projects) = service(data.path());
        store.lock().unwrap().add_root(&s(code.path())).unwrap();
        store.lock().unwrap().add_manual(&s(manual.path())).unwrap();
        store.lock().unwrap().add_manual(&s(&code.path().join("A"))).unwrap();

        let snapshot = projects.snapshot().await.unwrap();
        assert_eq!(snapshot.projects.len(), 3);
        let a = snapshot.projects.iter().find(|p| p.name == "a").unwrap();
        assert_eq!(a.tech, ["Vue"]);
        assert!(a.last_activity.is_some());

        let b = s(&code.path().join("b"));
        store.lock().unwrap().hide_many(&[b.clone()]).unwrap();
        let snapshot = projects.snapshot().await.unwrap();
        assert_eq!(snapshot.projects.len(), 2);
        assert_eq!(snapshot.hidden_projects[0].name, "b");
        assert!(projects.is_known(&b));
        assert!(!projects.is_known("E:\\unknown"));
    }

    #[tokio::test]
    async fn excluded_dirs_skip_scan_but_not_manual() {
        let data = tempfile::tempdir().unwrap();
        let code = tempfile::tempdir().unwrap();
        for name in ["keep", "skip/inner"] {
            fs::create_dir_all(code.path().join(name)).unwrap();
            fs::write(code.path().join(name).join("go.mod"), "").unwrap();
        }
        let (store, projects) = service(data.path());
        let skip = s(&code.path().join("skip"));
        {
            let mut store = store.lock().unwrap();
            store.add_root(&s(code.path())).unwrap();
            store.add_excluded(&skip).unwrap();
        }
        assert_eq!(projects.snapshot().await.unwrap().projects.len(), 1);
        store.lock().unwrap().add_manual(&s(&code.path().join("skip/inner"))).unwrap();
        assert_eq!(projects.snapshot().await.unwrap().projects.len(), 2);
        store.lock().unwrap().remove_excluded(&skip).unwrap();
        assert_eq!(projects.snapshot().await.unwrap().projects.len(), 2);
    }

    #[tokio::test]
    async fn broken_root_is_reported() {
        let data = tempfile::tempdir().unwrap();
        let (store, projects) = service(data.path());
        store.lock().unwrap().add_root("Z:\\missing\\root").unwrap();
        let snapshot = projects.snapshot().await.unwrap();
        assert_eq!(snapshot.scan_errors.len(), 1);
    }

    #[tokio::test]
    async fn inspect_missing_and_broken_git() {
        let missing = inspect_project("Z:\\missing\\project".into()).await;
        assert!(missing.missing);
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        let broken = inspect_project(s(dir.path())).await;
        assert!(broken.is_git);
        assert!(broken.git.is_none());
        assert!(broken.git_error.is_some());
    }

    #[tokio::test]
    async fn renamed_project_suggests_move() {
        let data = tempfile::tempdir().unwrap();
        let code = tempfile::tempdir().unwrap();
        let old = code.path().join("old");
        fs::create_dir(&old).unwrap();
        init(&old);
        git(&old, &["remote", "add", "origin", "https://github.com/me/app.git"]);
        let (store, projects) = service(data.path());
        store.lock().unwrap().add_root(&s(code.path())).unwrap();
        projects.snapshot().await.unwrap();
        store.lock().unwrap().set_remark(&s(&old), "我的应用").unwrap();
        projects.snapshot().await.unwrap();

        // 旧路径还在时不提示
        let copy = code.path().join("copy");
        fs::create_dir(&copy).unwrap();
        init(&copy);
        git(&copy, &["remote", "add", "origin", "git@github.com:me/app.git"]);
        assert!(projects.snapshot().await.unwrap().moves.is_empty());

        fs::remove_dir_all(&old).unwrap();
        let snapshot = projects.snapshot().await.unwrap();
        assert_eq!(snapshot.moves.len(), 1);
        assert_eq!(snapshot.moves[0].name, "我的应用");
        let moves: Vec<(String, String)> =
            projects.suggested_moves(&[s(&old)]).into_iter().map(|m| (m.from, m.to)).collect();
        store.lock().unwrap().migrate_projects(&moves).unwrap();
        let snapshot = projects.snapshot().await.unwrap();
        assert!(snapshot.moves.is_empty());
        assert_eq!(snapshot.projects[0].remark.as_deref(), Some("我的应用"));
    }
}
