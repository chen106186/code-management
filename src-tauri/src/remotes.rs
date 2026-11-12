//! 与 src/shared/remotes.ts 相同的规则；页面也在用 TS 版本，两边要一起改

use regex::Regex;
use std::sync::LazyLock;

static CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(https?://)[^/]*@").unwrap());
static HTTP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https?://").unwrap());
static SSH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:ssh|git\+ssh)://(?:[^/@]+@)?([^/:]+)(?::\d+)?/(.+)$").unwrap()
});
static SCP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.-]+@([A-Za-z0-9_.-]+):(.+)$").unwrap());

/// 去掉 http(s) 地址里嵌的账号和令牌，它们不能出现在界面和剪贴板上
pub fn sanitize_remote_url(url: &str) -> String {
    CREDENTIALS.replace(url, "$1").into_owned()
}

fn trim_suffix(value: &str) -> String {
    let trimmed = value.trim_end_matches('/');
    match trimmed.len().checked_sub(4) {
        Some(i) if trimmed.is_char_boundary(i) && trimmed[i..].eq_ignore_ascii_case(".git") => trimmed[..i].to_string(),
        _ => trimmed.to_string(),
    }
}

/// 换算成可在浏览器打开的地址；本地路径等无法换算时返回 None
pub fn remote_web_url(url: &str) -> Option<String> {
    if HTTP.is_match(url) {
        return Some(trim_suffix(&sanitize_remote_url(url)));
    }
    if let Some(c) = SSH.captures(url) {
        return Some(format!("https://{}/{}", &c[1], trim_suffix(&c[2])));
    }
    // scp 写法：git@github.com:owner/repo.git
    if let Some(c) = SCP.captures(url) {
        let path = &c[2];
        if !path.starts_with("//") {
            return Some(format!("https://{}/{}", &c[1], trim_suffix(path.trim_start_matches('/'))));
        }
    }
    None
}

/// 窄列里显示的地址，去掉协议和 .git；本地路径等原样返回
pub fn remote_short_url(url: &str) -> String {
    match remote_web_url(url) {
        Some(web) => HTTP.replace(&web, "").into_owned(),
        None => url.to_string(),
    }
}

/// 同一个仓库的 https 和 ssh 地址换算成同一个值，用来认出移动过的项目；本地路径返回 None
pub fn remote_identity(url: &str) -> Option<String> {
    remote_web_url(url).map(|_| remote_short_url(url).to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_credentials() {
        assert_eq!(sanitize_remote_url("https://user:token@github.com/a/b.git"), "https://github.com/a/b.git");
        assert_eq!(sanitize_remote_url("git@github.com:a/b.git"), "git@github.com:a/b.git");
    }

    #[test]
    fn web_urls() {
        assert_eq!(remote_web_url("https://github.com/a/b.git/").as_deref(), Some("https://github.com/a/b"));
        assert_eq!(remote_web_url("git@github.com:a/b.git").as_deref(), Some("https://github.com/a/b"));
        assert_eq!(remote_web_url("ssh://git@host:22/a/b.git").as_deref(), Some("https://host/a/b"));
        assert_eq!(remote_web_url("E:\\repos\\b"), None);
        assert_eq!(remote_web_url("../b"), None);
    }

    #[test]
    fn identity_matches_https_and_ssh() {
        assert_eq!(remote_identity("git@GitHub.com:A/b.git"), remote_identity("https://github.com/a/b"));
        assert_eq!(remote_identity("E:\\repos\\b"), None);
        assert_eq!(remote_short_url("E:\\repos\\b"), "E:\\repos\\b");
    }
}
