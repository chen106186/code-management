use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const DEBOUNCE: Duration = Duration::from_millis(300);
const IGNORED_DIRS: [&str; 2] = ["node_modules", "__pycache__"];
const GIT_FILES: [&str; 5] = ["HEAD", "index", "packed-refs", "FETCH_HEAD", "MERGE_HEAD"];

/// 判断变更是否值得刷新；.git 里只关心影响状态的文件，忽略对象库和锁文件
pub fn is_relevant_change(file: Option<&str>) -> bool {
    let Some(file) = file else { return true };
    let segments: Vec<&str> = file.split(['\\', '/']).collect();
    if segments.last().is_some_and(|s| s.ends_with(".lock")) {
        return false;
    }
    if segments[0] == ".git" {
        return segments.get(1).is_some_and(|s| *s == "refs" || GIT_FILES.contains(s));
    }
    !segments.iter().any(|s| IGNORED_DIRS.contains(s))
}

/// 只监听当前打开的一个仓库
pub struct RepoWatcher {
    current: Mutex<Option<RecommendedWatcher>>,
    /// 每次有变更加一；防抖结束时没再变才通知
    generation: Arc<AtomicU64>,
    on_change: Arc<dyn Fn(String) + Send + Sync>,
}

impl RepoWatcher {
    pub fn new(on_change: impl Fn(String) + Send + Sync + 'static) -> Self {
        Self { current: Mutex::new(None), generation: Arc::new(AtomicU64::new(0)), on_change: Arc::new(on_change) }
    }

    pub fn watch(&self, path: Option<String>) {
        let mut current = self.current.lock().unwrap();
        // 换仓库后，之前排着的通知作废
        self.generation.fetch_add(1, Ordering::SeqCst);
        *current = None;
        let Some(path) = path else { return };

        let generation = self.generation.clone();
        let on_change = self.on_change.clone();
        let root = path.clone();
        let handler = move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            let relevant = event.paths.is_empty()
                || event.paths.iter().any(|p| {
                    let relative = p.strip_prefix(&root).ok().map(|r| r.to_string_lossy().into_owned());
                    is_relevant_change(relative.as_deref().filter(|r| !r.is_empty()))
                });
            if !relevant {
                return;
            }
            let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let generation = generation.clone();
            let on_change = on_change.clone();
            let root = root.clone();
            std::thread::spawn(move || {
                std::thread::sleep(DEBOUNCE);
                if generation.load(Ordering::SeqCst) == mine {
                    on_change(root);
                }
            });
        };
        // 目录被删除等情况：放弃监听，页面仍可手动刷新
        if let Ok(mut watcher) = notify::recommended_watcher(handler) {
            if watcher.watch(Path::new(&path), RecursiveMode::Recursive).is_ok() {
                *current = Some(watcher);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_dependencies_objects_and_locks() {
        assert!(is_relevant_change(None));
        assert!(is_relevant_change(Some("src\\a.ts")));
        assert!(!is_relevant_change(Some("node_modules\\x\\a.js")));
        assert!(!is_relevant_change(Some("web/__pycache__/a.pyc")));
        assert!(is_relevant_change(Some(".git\\HEAD")));
        assert!(is_relevant_change(Some(".git/refs/heads/main")));
        assert!(!is_relevant_change(Some(".git\\objects\\ab\\cd")));
        assert!(!is_relevant_change(Some(".git\\index.lock")));
        assert!(!is_relevant_change(Some(".git")));
    }

    #[test]
    fn debounced_notification() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let watcher = RepoWatcher::new(move |path| tx.send(path).unwrap());
        watcher.watch(Some(dir.path().to_string_lossy().into_owned()));
        std::thread::sleep(Duration::from_millis(100));
        for i in 0..3 {
            std::fs::write(dir.path().join(format!("{i}.txt")), "x").unwrap();
        }
        assert!(rx.recv_timeout(Duration::from_secs(3)).is_ok());
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
        watcher.watch(None);
    }
}
