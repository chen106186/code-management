use crate::git_ops::assert_repo_path;
use crate::types::Readme;
use base64::Engine;
use std::fs;
use std::path::Path;

const MAX_README_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

const IMAGE_TYPES: [(&str, &str); 6] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
];

fn rank(name: &str) -> Option<u8> {
    let lower = name.to_lowercase();
    match lower.as_str() {
        "readme.md" => Some(0),
        "readme.markdown" => Some(1),
        "readme" | "readme.txt" | "readme.rst" => Some(2),
        _ => None,
    }
}

/// README.md 优先，其次其他写法
pub fn pick_readme(names: &[String]) -> Option<String> {
    names.iter().filter_map(|n| rank(n).map(|r| (r, n))).min_by_key(|(r, _)| *r).map(|(_, n)| n.clone())
}

/// 不接受符号链接，避免读到仓库外的文件
pub fn read_readme(dir: &str) -> Result<Option<Readme>, String> {
    let names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    let Some(name) = pick_readme(&names) else { return Ok(None) };
    let bytes = fs::read(Path::new(dir).join(&name)).map_err(|e| e.to_string())?;
    let lower = name.to_lowercase();
    Ok(Some(Readme {
        content: String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_README_BYTES)]).into_owned(),
        markdown: lower.ends_with(".md") || lower.ends_with(".markdown"),
        truncated: bytes.len() > MAX_README_BYTES,
        name,
    }))
}

/// 只读仓库内的常规图片文件；不符合要求的一律返回 None，界面显示替代文字
pub fn read_readme_image(dir: &str, relative: &str) -> Option<String> {
    let path = assert_repo_path(dir, relative).ok()?;
    let ext = Path::new(&path).extension()?.to_string_lossy().to_lowercase();
    let mime = IMAGE_TYPES.iter().find(|(e, _)| *e == ext)?.1;
    let full = Path::new(dir).join(&path);
    let info = fs::symlink_metadata(&full).ok()?;
    if !info.is_file() || info.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let bytes = fs::read(&full).ok()?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prefers_readme_md() {
        assert_eq!(pick_readme(&names(&["readme.txt", "README.md", "README.markdown"])).as_deref(), Some("README.md"));
        assert_eq!(pick_readme(&names(&["README", "x.md"])).as_deref(), Some("README"));
        assert_eq!(pick_readme(&names(&["README.md.bak", "readme-old.md"])), None);
    }

    #[test]
    fn reads_content_or_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        assert_eq!(read_readme(&path).unwrap(), None);
        fs::write(dir.path().join("README.md"), "# 标题").unwrap();
        let readme = read_readme(&path).unwrap().unwrap();
        assert_eq!(readme.content, "# 标题");
        assert!(readme.markdown);
        assert!(!readme.truncated);
    }

    #[test]
    fn images_only_inside_repo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs/a.png"), [1, 2, 3]).unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        assert_eq!(read_readme_image(&path, "docs/a.png").as_deref(), Some("data:image/png;base64,AQID"));
        assert_eq!(read_readme_image(&path, "notes.txt"), None);
        assert_eq!(read_readme_image(&path, "../a.png"), None);
        assert_eq!(read_readme_image(&path, "missing.png"), None);
    }
}
