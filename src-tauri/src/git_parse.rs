//! 解析 git 命令的输出；都是纯函数，便于测试

use crate::remotes::sanitize_remote_url;
use crate::types::{Branch, BranchKind, ChangedFile, CommitSummary, FileChanges, FileState, GitStatus, LastCommit, RemoteInfo};
use regex::Regex;
use std::sync::LazyLock;

static REMOTE_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\S+)\s+(.+?)\s+\(fetch\)$").unwrap());
static AHEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"ahead (\d+)").unwrap());
static BEHIND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"behind (\d+)").unwrap());

fn parse_int(text: &str) -> i64 {
    let digits: String = text.trim().trim_start_matches(['+', '-']).chars().take_while(char::is_ascii_digit).collect();
    digits.parse().unwrap_or(0)
}

/// 解析 `git remote -v`，同一远程只取 fetch 地址，origin 排最前
pub fn parse_remotes(output: &str) -> Vec<RemoteInfo> {
    let mut remotes: Vec<RemoteInfo> = output
        .split('\n')
        .filter_map(|line| REMOTE_LINE.captures(line.trim_end()))
        .map(|c| RemoteInfo { name: c[1].into(), url: sanitize_remote_url(&c[2]) })
        .collect();
    remotes.sort_by_key(|r| r.name != "origin");
    remotes
}

/// 解析 `git status --porcelain=v2 --branch -z`；lastCommit、remotes、stashCount 另外读取
pub fn parse_status(output: &str) -> GitStatus {
    let mut status = GitStatus::default();
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        i += 1;
        if token.is_empty() {
            continue;
        }
        if let Some(header) = token.strip_prefix("# ") {
            parse_header(header, &mut status);
            continue;
        }
        match token.as_bytes()[0] {
            b'1' => count_change(token, &mut status),
            b'2' => {
                count_change(token, &mut status);
                // 重命名条目的下一个 token 是原路径，不是独立条目
                i += 1;
            }
            b'u' => status.conflicted += 1,
            b'?' => status.untracked += 1,
            _ => {}
        }
    }
    status
}

fn parse_header(line: &str, status: &mut GitStatus) {
    let mut parts = line.splitn(2, ' ');
    let key = parts.next().unwrap_or("");
    let value = parts.next().unwrap_or("");
    match key {
        "branch.oid" => status.head = (value != "(initial)").then(|| value.to_string()),
        "branch.head" => status.branch = (value != "(detached)").then(|| value.to_string()),
        "branch.upstream" => status.upstream = Some(value.to_string()),
        "branch.ab" => {
            let mut values = value.split(' ');
            status.ahead = parse_int(values.next().unwrap_or("")) as u32;
            status.behind = parse_int(values.next().unwrap_or("")) as u32;
        }
        _ => {}
    }
}

fn xy(token: &str) -> (u8, u8) {
    let bytes = token.as_bytes();
    (bytes.get(2).copied().unwrap_or(b'.'), bytes.get(3).copied().unwrap_or(b'.'))
}

fn count_change(token: &str, status: &mut GitStatus) {
    let (x, y) = xy(token);
    if x != b'.' {
        status.staged += 1;
    }
    if y != b'.' {
        status.unstaged += 1;
    }
}

fn state_of(letter: u8) -> FileState {
    match letter {
        b'A' => FileState::Added,
        b'D' => FileState::Deleted,
        b'R' => FileState::Renamed,
        b'C' => FileState::Copied,
        b'T' => FileState::Typechange,
        _ => FileState::Modified,
    }
}

/// 跳过前 count 个空格分隔的字段，路径可能含空格，所以不能直接 split
fn after_fields(token: &str, count: usize) -> &str {
    token.splitn(count + 1, ' ').nth(count).unwrap_or("")
}

/// 从与 parse_status 相同的输出中取出文件列表
pub fn parse_changes(output: &str) -> FileChanges {
    let mut changes = FileChanges::default();
    let mut add = |(x, y): (u8, u8), path: &str, orig: Option<&str>| {
        let entry = |letter: u8| ChangedFile {
            path: path.to_string(),
            orig_path: if letter == b'R' || letter == b'C' { orig.map(String::from) } else { None },
            state: state_of(letter),
        };
        if x != b'.' {
            changes.staged.push(entry(x));
        }
        if y != b'.' {
            changes.unstaged.push(entry(y));
        }
    };

    let tokens: Vec<&str> = output.split('\0').collect();
    let mut conflicted = Vec::new();
    let mut untracked = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        i += 1;
        if token.is_empty() {
            continue;
        }
        match token.as_bytes()[0] {
            b'1' => add(xy(token), after_fields(token, 8), None),
            b'2' => {
                let orig = tokens.get(i).copied();
                i += 1;
                add(xy(token), after_fields(token, 9), orig);
            }
            b'u' => conflicted.push(ChangedFile {
                path: after_fields(token, 10).to_string(),
                orig_path: None,
                state: FileState::Conflicted,
            }),
            b'?' => untracked.push(ChangedFile { path: token[2..].to_string(), orig_path: None, state: FileState::Untracked }),
            _ => {}
        }
    }
    changes.conflicted = conflicted;
    // 与原实现一致：未跟踪文件按出现顺序和其他未暂存条目混排；git 总是先输出已跟踪条目
    changes.unstaged.extend(untracked);
    changes
}

pub const LOG_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%ct%x00%s%x00%D%x1e";

pub fn parse_log(output: &str) -> Vec<CommitSummary> {
    output
        .split('\x1e')
        .map(str::trim_start)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let fields: Vec<&str> = record.split('\0').collect();
            let field = |i: usize| fields.get(i).copied().unwrap_or("");
            CommitSummary {
                hash: field(0).into(),
                parents: split_nonempty(field(1), " "),
                author: field(2).into(),
                email: field(3).into(),
                time: parse_int(field(4)) * 1000,
                subject: field(5).into(),
                refs: split_nonempty(field(6), ", "),
            }
        })
        .collect()
}

fn split_nonempty(text: &str, separator: &str) -> Vec<String> {
    if text.is_empty() {
        vec![]
    } else {
        text.split(separator).map(String::from).collect()
    }
}

pub const COMMIT_DETAIL_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%ct%x00%B";

/// 解析 `--name-status -z` 的输出；重命名和复制占三个 token
pub fn parse_name_status(output: &str) -> Vec<ChangedFile> {
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let code = tokens[i];
        i += 1;
        if code.is_empty() {
            continue;
        }
        let letter = code.as_bytes()[0];
        let mut next = || {
            let token = tokens.get(i).copied().unwrap_or("").to_string();
            i += 1;
            token
        };
        if letter == b'R' || letter == b'C' {
            let orig = next();
            files.push(ChangedFile { path: next(), orig_path: Some(orig), state: state_of(letter) });
        } else {
            files.push(ChangedFile { path: next(), orig_path: None, state: state_of(letter) });
        }
    }
    files
}

pub const BRANCH_FORMAT: &str = "%(refname)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(HEAD)%00%(contents:subject)";

pub fn parse_branches(output: &str) -> Vec<Branch> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            let field = |i: usize| fields.get(i).copied().unwrap_or("");
            let reference = field(0);
            let is_remote = reference.starts_with("refs/remotes/");
            // origin/HEAD 只是指向默认分支的别名
            if is_remote && reference.ends_with("/HEAD") {
                return None;
            }
            let name = reference
                .strip_prefix("refs/heads/")
                .or_else(|| reference.strip_prefix("refs/remotes/"))
                .unwrap_or(reference);
            let track = field(3);
            let count = |re: &Regex| re.captures(track).map(|c| parse_int(&c[1]) as u32).unwrap_or(0);
            Some(Branch {
                name: name.into(),
                kind: if is_remote { BranchKind::Remote } else { BranchKind::Local },
                current: field(5) == "*",
                hash: field(1).into(),
                upstream: Some(field(2)).filter(|u| !u.is_empty()).map(String::from),
                ahead: count(&AHEAD),
                behind: count(&BEHIND),
                gone: track == "gone",
                time: parse_int(field(4)) * 1000,
                subject: field(6).into(),
            })
        })
        .collect()
}

pub const LAST_COMMIT_FORMAT: &str = "%H%x00%s%x00%an%x00%ct";

/// 解析 `git log -1 --format=LAST_COMMIT_FORMAT` 的输出
pub fn parse_last_commit(output: &str) -> Option<LastCommit> {
    let parts: Vec<&str> = output.trim_end().split('\0').collect();
    if parts.len() < 4 {
        return None;
    }
    Some(LastCommit {
        hash: parts[0].into(),
        subject: parts[1].into(),
        author: parts[2].into(),
        time: parse_int(parts[3]) * 1000,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_branch_upstream_ahead_behind() {
        let output = "# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\0";
        let status = parse_status(output);
        assert_eq!(status.head.as_deref(), Some("abc123"));
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 3));
    }

    #[test]
    fn status_initial_and_detached() {
        let status = parse_status("# branch.oid (initial)\0# branch.head main\0");
        assert_eq!(status.head, None);
        assert_eq!(status.branch.as_deref(), Some("main"));
        let detached = parse_status("# branch.oid abc\0# branch.head (detached)\0");
        assert_eq!(detached.branch, None);
    }

    #[test]
    fn status_counts_xy_renames_conflicts() {
        let output = [
            "1 M. N... 100644 100644 100644 a b src/a.ts",
            "1 .M N... 100644 100644 100644 a b src/b.ts",
            "1 MM N... 100644 100644 100644 a b src/c.ts",
            "2 R. N... 100644 100644 100644 a b R100 new name.ts",
            "old name.ts",
            "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
            "? untracked.ts",
            "! ignored.ts",
            "",
        ]
        .join("\0");
        let status = parse_status(&output);
        assert_eq!((status.staged, status.unstaged, status.conflicted, status.untracked), (3, 2, 1, 1));
    }

    #[test]
    fn empty_status_defaults() {
        assert_eq!(parse_status(""), GitStatus::default());
    }

    #[test]
    fn remotes_fetch_only_origin_first_sanitized() {
        let output = "upstream\thttps://github.com/u/r.git (fetch)\nupstream\thttps://github.com/u/r.git (push)\norigin\thttps://user:tok@github.com/me/r.git (fetch)\norigin\thttps://user:tok@github.com/me/r.git (push)\nlocal\tE:\\my repos\\r (fetch)\n";
        let remotes = parse_remotes(output);
        assert_eq!(remotes.len(), 3);
        assert_eq!(remotes[0], RemoteInfo { name: "origin".into(), url: "https://github.com/me/r.git".into() });
        assert_eq!(remotes[2].url, "E:\\my repos\\r");
        assert!(parse_remotes("").is_empty());
    }

    #[test]
    fn last_commit() {
        let commit = parse_last_commit("abc\0修复 bug\0张三\01700000000\n").unwrap();
        assert_eq!(commit.subject, "修复 bug");
        assert_eq!(commit.time, 1_700_000_000_000);
        assert_eq!(parse_last_commit("abc\0x"), None);
    }

    #[test]
    fn changes_with_spaces_renames_untracked() {
        let output = [
            "# branch.oid abc",
            "1 .M N... 100644 100644 100644 a b dir/with space.ts",
            "1 A. N... 000000 100644 100644 a b 新文件.ts",
            "2 R. N... 100644 100644 100644 a b R90 to file.ts",
            "from file.ts",
            "u UU N... 100644 100644 100644 100644 a b c 冲突 文件.ts",
            "? new dir/x.ts",
            "",
        ]
        .join("\0");
        let changes = parse_changes(&output);
        assert_eq!(changes.unstaged[0].path, "dir/with space.ts");
        assert_eq!(changes.unstaged[0].state, FileState::Modified);
        assert_eq!(changes.staged[0].state, FileState::Added);
        assert_eq!(changes.staged[1].path, "to file.ts");
        assert_eq!(changes.staged[1].orig_path.as_deref(), Some("from file.ts"));
        assert_eq!(changes.conflicted[0].path, "冲突 文件.ts");
        assert_eq!(changes.unstaged[1].state, FileState::Untracked);
        assert_eq!(changes.unstaged[1].path, "new dir/x.ts");
    }

    #[test]
    fn log_records_parents_refs() {
        let output = "h1\0p1 p2\0A\0a@x\01700000000\0合并\0HEAD -> main, origin/main\x1e\nh2\0\0B\0b@x\01600000000\0init\0\x1e\n";
        let log = parse_log(output);
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].parents, ["p1", "p2"]);
        assert_eq!(log[0].refs, ["HEAD -> main", "origin/main"]);
        assert!(log[1].parents.is_empty());
        assert!(log[1].refs.is_empty());
    }

    #[test]
    fn name_status_renames_take_three_tokens() {
        let files = parse_name_status("M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0");
        assert_eq!(files.len(), 3);
        assert_eq!(files[1].path, "new.ts");
        assert_eq!(files[1].orig_path.as_deref(), Some("old.ts"));
        assert_eq!(files[2].state, FileState::Deleted);
    }

    #[test]
    fn branches_track_gone_and_skip_head_alias() {
        let output = [
            "refs/heads/main\0abc\0origin/main\0ahead 1, behind 2\01700000000\0*\0最新",
            "refs/heads/old\0def\0origin/old\0gone\01600000000\0 \0旧",
            "refs/remotes/origin/HEAD\0abc\0\0\01700000000\0 \0x",
            "refs/remotes/origin/feature/x\0aaa\0\0\01700000000\0 \0f",
            "",
        ]
        .join("\n");
        let branches = parse_branches(&output);
        assert_eq!(branches.len(), 3);
        assert!(branches[0].current);
        assert_eq!((branches[0].ahead, branches[0].behind), (1, 2));
        assert!(branches[1].gone);
        assert_eq!(branches[2].name, "origin/feature/x");
        assert_eq!(branches[2].kind, BranchKind::Remote);
        assert_eq!(branches[2].upstream, None);
    }
}
