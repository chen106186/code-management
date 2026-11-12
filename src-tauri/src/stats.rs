//! 后台统计磁盘占用和代码行数，缓存在 stats.json（格式与 Electron 版本相同）

use crate::git::run_git;
use crate::paths::path_key;
use crate::types::{LanguageLines, ProjectStats};
use futures::future::BoxFuture;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const WORKERS: usize = 2;
const MAX_ENTRIES: i64 = 300_000;
const MAX_SOURCE_FILES: usize = 20_000;
/// 更大的源文件基本是生成的，不计入行数
const MAX_SOURCE_BYTES: u64 = 1024 * 1024;
const STALE_MS: i64 = 24 * 3_600_000;

/// 可以删掉重新生成的目录，占用单独统计，也不计入代码行数
const GENERATED_DIRS: [&str; 12] =
    ["node_modules", "dist", "out", "build", "target", "vendor", "venv", ".venv", "__pycache__", ".next", ".nuxt", ".gradle"];

const LANGUAGES: [(&str, &str); 37] = [
    ("ts", "TypeScript"),
    ("tsx", "TypeScript"),
    ("js", "JavaScript"),
    ("jsx", "JavaScript"),
    ("mjs", "JavaScript"),
    ("cjs", "JavaScript"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("py", "Python"),
    ("java", "Java"),
    ("kt", "Kotlin"),
    ("kts", "Kotlin"),
    ("swift", "Swift"),
    ("go", "Go"),
    ("rs", "Rust"),
    ("c", "C"),
    ("h", "C"),
    ("cc", "C++"),
    ("cpp", "C++"),
    ("cxx", "C++"),
    ("hpp", "C++"),
    ("cs", "C#"),
    ("php", "PHP"),
    ("rb", "Ruby"),
    ("dart", "Dart"),
    ("lua", "Lua"),
    ("sh", "Shell"),
    ("bash", "Shell"),
    ("ps1", "PowerShell"),
    ("html", "HTML"),
    ("htm", "HTML"),
    ("css", "CSS"),
    ("scss", "Sass"),
    ("sass", "Sass"),
    ("less", "Less"),
    ("sql", "SQL"),
    ("scala", "Scala"),
];

pub fn language_of(file_name: &str) -> Option<&'static str> {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".min.js") || lower.ends_with(".min.css") {
        return None;
    }
    let name = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
    // 和 Node 的 extname 一致：.bashrc 这样以点开头的文件没有扩展名
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() {
        return None;
    }
    LANGUAGES.iter().find(|(e, _)| *e == ext).map(|(_, l)| *l)
}

pub fn count_lines(content: &[u8]) -> u64 {
    if content.is_empty() {
        return 0;
    }
    let newlines = content.iter().filter(|b| **b == b'\n').count() as u64;
    if content.last() == Some(&b'\n') {
        newlines
    } else {
        newlines + 1
    }
}

#[derive(Default)]
struct WalkResult {
    size: u64,
    generated_size: u64,
    /// 不在生成目录和隐藏目录里的文件，相对路径
    files: Vec<String>,
    truncated: bool,
}

fn walk(root: &Path) -> WalkResult {
    let mut result = WalkResult::default();
    let mut stack = vec![(root.to_path_buf(), String::new(), false, false)];
    let mut budget = MAX_ENTRIES;
    while let Some((dir, relative, generated, hidden)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.filter_map(Result::ok) {
            budget -= 1;
            if budget < 0 {
                result.truncated = true;
                return result;
            }
            let Ok(kind) = entry.file_type() else { continue };
            // 不跟随符号链接和目录联接，避免循环，也不把别处的文件算进来
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let child_relative = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
            if kind.is_dir() {
                stack.push((
                    entry.path(),
                    child_relative,
                    generated || GENERATED_DIRS.contains(&name.as_str()),
                    hidden || name.starts_with('.'),
                ));
            } else if kind.is_file() {
                // 文件在遍历途中被删除时忽略
                let Ok(meta) = entry.metadata() else { continue };
                result.size += meta.len();
                if generated {
                    result.generated_size += meta.len();
                } else if !hidden {
                    result.files.push(child_relative);
                }
            }
        }
    }
    result
}

/// Git 仓库只算受跟踪的文件。必须是项目自己的 .git：放在别的仓库子目录里时，git 查到的是外层仓库
async fn source_files(root: &str, walked: Vec<String>) -> Vec<String> {
    if !Path::new(root).join(".git").exists() {
        return walked;
    }
    match run_git(root, &["ls-files", "-z"]).await {
        Ok(tracked) => tracked.split('\0').filter(|f| !f.is_empty()).map(String::from).collect(),
        Err(_) => walked,
    }
}

fn count_by_language(root: &Path, files: &[String]) -> Vec<LanguageLines> {
    let mut by_language: HashMap<&str, u64> = HashMap::new();
    for file in files {
        let full = root.join(file);
        // 受跟踪但已从工作区删除的文件，忽略
        let Ok(meta) = fs::metadata(&full) else { continue };
        if meta.len() > MAX_SOURCE_BYTES {
            continue;
        }
        let Ok(content) = fs::read(&full) else { continue };
        *by_language.entry(language_of(file).unwrap()).or_default() += count_lines(&content);
    }
    let mut languages: Vec<LanguageLines> = by_language
        .into_iter()
        .filter(|(_, lines)| *lines > 0)
        .map(|(name, lines)| LanguageLines { name: name.into(), lines })
        .collect();
    languages.sort_by(|a, b| b.lines.cmp(&a.lines).then_with(|| a.name.cmp(&b.name)));
    languages
}

pub async fn compute_stats(root: String, now: i64) -> Result<ProjectStats, String> {
    let walk_root = PathBuf::from(&root);
    let walked = tokio::task::spawn_blocking(move || walk(&walk_root)).await.map_err(|e| e.to_string())?;
    let files: Vec<String> =
        source_files(&root, walked.files).await.into_iter().filter(|f| language_of(f).is_some()).collect();
    let total = files.len();
    let counted: Vec<String> = files.into_iter().take(MAX_SOURCE_FILES).collect();
    let counted_len = counted.len();
    let count_root = PathBuf::from(&root);
    let languages =
        tokio::task::spawn_blocking(move || count_by_language(&count_root, &counted)).await.map_err(|e| e.to_string())?;
    Ok(ProjectStats {
        size: walked.size,
        generated_size: walked.generated_size,
        lines: languages.iter().map(|l| l.lines).sum(),
        languages,
        truncated: walked.truncated || total > counted_len,
        computed_at: now,
    })
}

pub type ComputeFn = Arc<dyn Fn(String) -> BoxFuture<'static, Result<ProjectStats, String>> + Send + Sync>;
pub type UpdateFn = Arc<dyn Fn(String, ProjectStats) + Send + Sync>;

#[derive(Default)]
struct Inner {
    cache: HashMap<String, ProjectStats>,
    queue: VecDeque<String>,
    queued: HashSet<String>,
    workers: usize,
}

/// 在后台逐个统计并缓存到文件；大项目可能要算很久，不能放进刷新流程
pub struct StatsService {
    file: PathBuf,
    inner: Mutex<Inner>,
    compute: ComputeFn,
    on_update: Mutex<UpdateFn>,
    idle: tokio::sync::Notify,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl StatsService {
    pub fn new(file: impl Into<PathBuf>) -> Arc<Self> {
        Self::with_compute(file, Arc::new(|path| Box::pin(compute_stats(path, now_ms()))))
    }

    pub fn with_compute(file: impl Into<PathBuf>, compute: ComputeFn) -> Arc<Self> {
        let file = file.into();
        // 缓存丢了重新算就行
        let cache = fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        Arc::new(Self {
            file,
            inner: Mutex::new(Inner { cache, ..Default::default() }),
            compute,
            on_update: Mutex::new(Arc::new(|_, _| {})),
            idle: tokio::sync::Notify::new(),
        })
    }

    pub fn set_on_update(&self, callback: UpdateFn) {
        *self.on_update.lock().unwrap() = callback;
    }

    pub fn get(&self, path: &str) -> Option<ProjectStats> {
        self.inner.lock().unwrap().cache.get(&path_key(path)).cloned()
    }

    /// 只排没算过或已过期的项目；force 时全部重算
    pub fn schedule(self: &Arc<Self>, paths: &[String], force: bool, now: i64) {
        let mut inner = self.inner.lock().unwrap();
        for path in paths {
            let key = path_key(path);
            let fresh = inner.cache.get(&key).is_some_and(|s| now - s.computed_at < STALE_MS);
            if (fresh && !force) || inner.queued.contains(&key) {
                continue;
            }
            inner.queued.insert(key);
            inner.queue.push_back(path.clone());
        }
        while inner.workers < WORKERS && !inner.queue.is_empty() {
            inner.workers += 1;
            tokio::spawn(self.clone().work());
        }
    }

    async fn work(self: Arc<Self>) {
        loop {
            let Some(path) = self.inner.lock().unwrap().queue.pop_front() else { break };
            // 目录读不了时下次再试
            if let Ok(stats) = (self.compute)(path.clone()).await {
                self.inner.lock().unwrap().cache.insert(path_key(&path), stats.clone());
                let callback = self.on_update.lock().unwrap().clone();
                callback(path.clone(), stats);
            }
            self.inner.lock().unwrap().queued.remove(&path_key(&path));
        }
        let last = {
            let mut inner = self.inner.lock().unwrap();
            inner.workers -= 1;
            inner.workers == 0
        };
        if last {
            self.persist();
            self.idle.notify_waiters();
        }
    }

    fn persist(&self) {
        let text = serde_json::to_string(&self.inner.lock().unwrap().cache);
        // 只是缓存，写不了下次重算
        if let (Ok(text), Some(dir)) = (text, self.file.parent()) {
            let _ = fs::create_dir_all(dir).and_then(|_| fs::write(&self.file, text));
        }
    }

    #[cfg(test)]
    pub async fn when_idle(&self) {
        let notified = self.idle.notified();
        if self.inner.lock().unwrap().workers == 0 {
            return;
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn languages_and_lines() {
        assert_eq!(language_of("src/a.TS"), Some("TypeScript"));
        assert_eq!(language_of("lib/jquery.min.js"), None);
        assert_eq!(language_of("README.md"), None);
        assert_eq!(language_of(".bashrc"), None);
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"a"), 1);
        assert_eq!(count_lines(b"a\nb\n"), 2);
        assert_eq!(count_lines(b"a\nb"), 2);
    }

    #[tokio::test]
    async fn plain_folder_counts_dependencies_separately() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.js"), "1\n2\n").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        fs::write(dir.path().join("node_modules/x/index.js"), "1\n2\n3\n").unwrap();
        fs::create_dir_all(dir.path().join(".cache")).unwrap();
        fs::write(dir.path().join(".cache/b.js"), "1\n").unwrap();
        let stats = compute_stats(s(dir.path()), 1).await.unwrap();
        assert_eq!(stats.lines, 2);
        assert_eq!(stats.generated_size, 6);
        assert_eq!(stats.size, 4 + 6 + 2);
        assert_eq!(stats.languages, [LanguageLines { name: "JavaScript".into(), lines: 2 }]);
    }

    #[tokio::test]
    async fn git_repo_counts_tracked_files_only() {
        let dir = tempfile::tempdir().unwrap();
        init(dir.path());
        commit_file(dir.path(), "a.py", "x\ny\n", "init");
        fs::write(dir.path().join("untracked.py"), "1\n2\n3\n").unwrap();
        let stats = compute_stats(s(dir.path()), 1).await.unwrap();
        assert_eq!(stats.lines, 2);
        assert!(stats.size > 5, "包含 .git");
    }

    fn fake(counter: Arc<AtomicUsize>) -> ComputeFn {
        Arc::new(move |_path| {
            counter.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ProjectStats { size: 1, generated_size: 0, lines: 1, languages: vec![], truncated: false, computed_at: 1000 })
            })
        })
    }

    #[tokio::test]
    async fn cached_results_are_reused_until_stale_or_forced() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("stats.json");
        let counter = Arc::new(AtomicUsize::new(0));
        let service = StatsService::with_compute(&file, fake(counter.clone()));
        let updates = Arc::new(AtomicUsize::new(0));
        let seen = updates.clone();
        service.set_on_update(Arc::new(move |_, _| {
            seen.fetch_add(1, Ordering::SeqCst);
        }));
        let paths = vec!["E:\\a".to_string(), "E:\\b".to_string()];
        service.schedule(&paths, false, 1000);
        service.when_idle().await;
        assert_eq!(counter.load(Ordering::SeqCst), 2);
        assert_eq!(updates.load(Ordering::SeqCst), 2);
        assert!(service.get("e:\\A").is_some());
        assert!(fs::read_to_string(&file).unwrap().contains("e:\\\\a"));

        service.schedule(&paths, false, 2000);
        service.when_idle().await;
        assert_eq!(counter.load(Ordering::SeqCst), 2);
        service.schedule(&paths, true, 2000);
        service.when_idle().await;
        assert_eq!(counter.load(Ordering::SeqCst), 4);

        let reloaded = StatsService::with_compute(&file, fake(counter.clone()));
        reloaded.schedule(&paths, false, 1000 + STALE_MS + 1);
        reloaded.when_idle().await;
        assert_eq!(counter.load(Ordering::SeqCst), 6);
    }
}
