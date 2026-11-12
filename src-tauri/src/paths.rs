use std::path::{Component, Path, MAIN_SEPARATOR};

/// 转成绝对路径并规范化（去掉 . 和 ..、统一分隔符、去掉末尾分隔符），和 Node 的 path.resolve 一致
pub fn normalize_path(path: &str) -> String {
    let absolute = std::path::absolute(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string());
    let trimmed = absolute.trim_end_matches(['\\', '/']);
    // 盘符根目录要保留分隔符：E:\ 而不是 E:
    if trimmed.len() < absolute.len() && (trimmed.is_empty() || trimmed.ends_with(':')) {
        return format!("{trimmed}{MAIN_SEPARATOR}");
    }
    trimmed.to_string()
}

/// Windows 路径不区分大小写，比较和做键时统一用这个
pub fn path_key(path: &str) -> String {
    let normalized = normalize_path(path);
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

/// path 是否等于 dir 或位于其下；按路径段比较，E:\code 不包含 E:\code-old
pub fn is_within(path: &str, dir: &str) -> bool {
    let p = path_key(path);
    let d = path_key(dir);
    if p == d {
        return true;
    }
    let prefix = if d.ends_with(MAIN_SEPARATOR) { d } else { format!("{d}{MAIN_SEPARATOR}") };
    p.starts_with(&prefix)
}

/// 路径最后一段；根目录等没有名称时返回路径本身
pub fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// 是否带盘符或根目录；这样的路径和仓库目录拼接时会替换掉仓库目录
pub fn is_rooted(path: &str) -> bool {
    path.starts_with(['/', '\\'])
        || Path::new(path)
            .components()
            .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn normalizes_like_node_resolve() {
        assert_eq!(normalize_path("E:\\code\\a\\..\\b\\"), "E:\\code\\b");
        assert_eq!(normalize_path("E:/code/b"), "E:\\code\\b");
        assert_eq!(normalize_path("E:\\"), "E:\\");
        assert_eq!(path_key("E:\\Code\\App"), "e:\\code\\app");
    }

    #[cfg(windows)]
    #[test]
    fn is_within_compares_segments_case_insensitively() {
        assert!(is_within("E:\\code\\app", "E:\\code"));
        assert!(is_within("e:\\CODE", "E:\\code\\"));
        assert!(!is_within("E:\\code-old\\app", "E:\\code"));
        assert!(is_within("E:\\x", "E:\\"));
    }

    #[test]
    fn base_name_falls_back_to_path() {
        assert_eq!(base_name("E:\\code\\app"), "app");
        assert_eq!(base_name("E:\\"), "E:\\");
    }

    #[test]
    fn rooted_paths() {
        assert!(is_rooted("/etc/passwd"));
        assert!(is_rooted("\\x"));
        assert!(!is_rooted("src/a.ts"));
        #[cfg(windows)]
        assert!(is_rooted("C:foo"));
    }
}
