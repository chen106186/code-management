use crate::paths::path_key;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

/// 同一仓库的 Fetch 和切换分支依次执行，避免互相撞上；不同仓库互不影响
#[derive(Default)]
pub struct RepoQueue {
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl RepoQueue {
    pub async fn run<T, F: Future<Output = T>>(&self, repo: &str, task: F) -> T {
        let lock = self.locks.lock().unwrap().entry(path_key(repo)).or_default().clone();
        let _guard = lock.lock().await;
        task.await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn same_repo_runs_in_order_different_repos_in_parallel() {
        let queue = Arc::new(RepoQueue::default());
        let log = Arc::new(Mutex::new(Vec::new()));
        let task = |name: &'static str, repo: &'static str, delay: u64| {
            let queue = queue.clone();
            let log = log.clone();
            tokio::spawn(async move {
                queue
                    .run(repo, async {
                        log.lock().unwrap().push(format!("{name} start"));
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        log.lock().unwrap().push(format!("{name} end"));
                    })
                    .await
            })
        };
        let a = task("a", "E:\\r1", 80);
        tokio::time::sleep(Duration::from_millis(10)).await;
        let b = task("b", "e:\\R1", 10);
        let c = task("c", "E:\\r2", 10);
        let _ = tokio::join!(a, b, c);
        let log = log.lock().unwrap();
        let pos = |s: &str| log.iter().position(|l| l == s).unwrap();
        assert!(pos("a end") < pos("b start"));
        assert!(pos("c end") < pos("a end"));
    }
}
