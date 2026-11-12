use crate::git::run_git;
use chrono::{Local, TimeZone};
use std::collections::BTreeMap;

/// 输入是每行一个秒级时间戳，按本地日期计数
pub fn count_by_day(output: &str) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for line in output.lines() {
        let Ok(seconds) = line.trim().parse::<i64>() else { continue };
        let Some(time) = Local.timestamp_opt(seconds, 0).single() else { continue };
        *counts.entry(time.format("%Y-%m-%d").to_string()).or_insert(0) += 1;
    }
    counts
}

/// 最近一年的提交；只看自己时按仓库配置的 user.email 过滤，没配置就没有结果
pub async fn read_activity(cwd: &str, mine_only: bool) -> Result<BTreeMap<String, u32>, String> {
    let mut args = vec!["log", "--all", "--since=1 year ago", "--format=%at"];
    let author;
    if mine_only {
        // 没配置邮箱时 git config 以非零退出，和配置为空一样处理
        let email = run_git(cwd, &["config", "user.email"]).await.unwrap_or_default();
        let email = email.trim();
        if email.is_empty() {
            return Ok(BTreeMap::new());
        }
        author = format!("--author={email}");
        args.extend(["--fixed-strings", author.as_str()]);
    }
    Ok(count_by_day(&run_git(cwd, &args).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_by_local_day() {
        let t1 = Local.with_ymd_and_hms(2026, 3, 1, 9, 0, 0).unwrap().timestamp();
        let t2 = Local.with_ymd_and_hms(2026, 3, 1, 23, 59, 0).unwrap().timestamp();
        let t3 = Local.with_ymd_and_hms(2026, 3, 2, 0, 1, 0).unwrap().timestamp();
        let counts = count_by_day(&format!("{t1}\n{t2}\n\n{t3}\nbad\n"));
        assert_eq!(counts.get("2026-03-01"), Some(&2));
        assert_eq!(counts.get("2026-03-02"), Some(&1));
        assert_eq!(counts.len(), 2);
    }
}
