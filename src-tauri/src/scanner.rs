use regex::Regex;
use std::fs::{self, DirEntry};
use std::path::Path;
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;

pub const DEFAULT_SCAN_DEPTH: usize = 3;

const STRONG_MARKERS: [&str; 12] = [
    ".git",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "CMakeLists.txt",
    ".idea",
    ".vscode",
];

static SOURCE_FILE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\.(html?|jsx?|tsx?|vue|py|java|go|rs|c|cc|cpp|h|cs|sln|csproj|php|rb|sh|ps1)$").unwrap()
});

pub const SKIPPED_DIRS: [&str; 8] = ["node_modules", "dist", "out", "build", "target", "vendor", "venv", "__pycache__"];

struct Entry {
    name: String,
    is_file: bool,
    is_dir: bool,
    is_symlink: bool,
}

/// 不跟随符号链接和目录联接：它们的 file_type 是 symlink，既不是文件也不是目录
fn read_entries(dir: &Path) -> std::io::Result<Vec<Entry>> {
    Ok(fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|e: DirEntry| {
            let kind = e.file_type().ok();
            Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_file: kind.is_some_and(|k| k.is_file()),
                is_dir: kind.is_some_and(|k| k.is_dir()),
                is_symlink: kind.is_some_and(|k| k.is_symlink()),
            }
        })
        .collect())
}

/// 在 root 下查找项目目录，找到后不再深入。
/// 根目录本身只认强标记：一个放了零散脚本的工作目录不应把所有子项目吞掉。
pub fn scan_root(root: &str, max_depth: usize) -> Result<Vec<String>, String> {
    fn walk(dir: &Path, depth: usize, max_depth: usize, found: &mut Vec<String>) -> Result<(), String> {
        let entries = match read_entries(dir) {
            Ok(entries) => entries,
            Err(error) if depth == 0 => return Err(error.to_string()),
            Err(_) => return Ok(()),
        };
        let strong = entries.iter().any(|e| STRONG_MARKERS.contains(&e.name.as_str()));
        let source = depth > 0 && entries.iter().any(|e| e.is_file && SOURCE_FILE.is_match(&e.name));
        if strong || source {
            found.push(dir.to_string_lossy().into_owned());
            return Ok(());
        }
        if depth >= max_depth {
            return Ok(());
        }
        for entry in entries {
            if !entry.is_dir || entry.name.starts_with('.') || SKIPPED_DIRS.contains(&entry.name.as_str()) {
                continue;
            }
            walk(&dir.join(&entry.name), depth + 1, max_depth, found)?;
        }
        Ok(())
    }
    let mut found = Vec::new();
    walk(Path::new(root), 0, max_depth, &mut found)?;
    Ok(found)
}

const ACTIVITY_MAX_ENTRIES: i32 = 500;

fn activity_ignored(name: &str) -> bool {
    matches!(name, ".git" | ".idea" | ".vscode") || SKIPPED_DIRS.contains(&name)
}

/// 目录内文件的最新修改时间（毫秒），只看两层并限制数量，避免大目录拖慢刷新
pub fn latest_modified(dir: &str) -> Option<i64> {
    fn walk(current: &Path, depth: usize, budget: &mut i32, latest: &mut Option<i64>) {
        let Ok(entries) = read_entries(current) else { return };
        for entry in entries {
            *budget -= 1;
            if *budget < 0 {
                return;
            }
            if activity_ignored(&entry.name) || entry.is_symlink {
                continue;
            }
            let full = current.join(&entry.name);
            if entry.is_dir {
                if depth < 2 {
                    walk(&full, depth + 1, budget, latest);
                }
                continue;
            }
            // 文件在遍历途中被删除时忽略
            let modified = fs::metadata(&full).and_then(|m| m.modified()).ok();
            if let Some(ms) = modified.and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64) {
                if latest.is_none_or(|l| ms > l) {
                    *latest = Some(ms);
                }
            }
        }
    }
    let mut latest = None;
    let mut budget = ACTIVITY_MAX_ENTRIES;
    walk(Path::new(dir), 1, &mut budget, &mut latest);
    latest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "x").unwrap();
    }

    fn names(found: &[String]) -> Vec<String> {
        let mut names: Vec<String> = found.iter().map(|p| crate::paths::base_name(p)).collect();
        names.sort();
        names
    }

    #[test]
    fn finds_projects_skips_dependencies_and_assets() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        touch(&r.join("web/package.json"));
        touch(&r.join("web/src/deep/package.json"));
        touch(&r.join("scripts/tool.py"));
        touch(&r.join("assets/logo.png"));
        touch(&r.join("node_modules/lib/package.json"));
        touch(&r.join("group/inner/go.mod"));
        touch(&r.join(".hidden/package.json"));
        let found = scan_root(&r.to_string_lossy(), DEFAULT_SCAN_DEPTH).unwrap();
        assert_eq!(names(&found), ["inner", "scripts", "web"]);
    }

    #[test]
    fn loose_scripts_in_root_do_not_swallow_children() {
        let root = tempfile::tempdir().unwrap();
        touch(&root.path().join("run.sh"));
        touch(&root.path().join("app/Cargo.toml"));
        let found = scan_root(&root.path().to_string_lossy(), DEFAULT_SCAN_DEPTH).unwrap();
        assert_eq!(names(&found), ["app"]);
        touch(&root.path().join(".git/HEAD"));
        let found = scan_root(&root.path().to_string_lossy(), DEFAULT_SCAN_DEPTH).unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn missing_root_is_an_error() {
        assert!(scan_root("Z:\\definitely\\missing\\dir", 3).is_err());
    }

    #[test]
    fn latest_modified_ignores_dependencies() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(latest_modified(&root.path().to_string_lossy()), None);
        touch(&root.path().join("src/a.ts"));
        assert!(latest_modified(&root.path().to_string_lossy()).is_some());
    }
}
