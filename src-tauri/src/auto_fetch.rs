use crate::types::{AutoFetchStatus, FailedFetch, FetchAllItem};
use futures::future::BoxFuture;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;

pub type FetchAllFn = Arc<dyn Fn() -> BoxFuture<'static, Result<Vec<FetchAllItem>, String>> + Send + Sync>;
pub type DoneFn = Arc<dyn Fn(AutoFetchStatus) + Send + Sync>;

#[derive(Default)]
struct State {
    timer: Option<JoinHandle<()>>,
    interval: Duration,
    running: bool,
    status: AutoFetchStatus,
}

/// 定时跑一次全部 Fetch；上一次还没结束时不重复启动，失败不打断后续的定时
pub struct AutoFetcher {
    state: Mutex<State>,
    fetch_all: FetchAllFn,
    on_done: DoneFn,
}

impl AutoFetcher {
    pub fn new(fetch_all: FetchAllFn, on_done: DoneFn) -> Arc<Self> {
        Arc::new(Self { state: Mutex::new(State::default()), fetch_all, on_done })
    }

    pub fn status(&self) -> AutoFetchStatus {
        self.state.lock().unwrap().status.clone()
    }

    /// 0 表示关闭；改间隔后从现在开始重新计时
    pub fn set_interval_minutes(self: &Arc<Self>, minutes: u32) {
        self.set_interval(Duration::from_secs(u64::from(minutes) * 60));
    }

    pub fn set_interval(self: &Arc<Self>, interval: Duration) {
        self.state.lock().unwrap().interval = interval;
        self.schedule();
    }

    fn schedule(self: &Arc<Self>) {
        let mut state = self.state.lock().unwrap();
        if let Some(timer) = state.timer.take() {
            timer.abort();
        }
        if !state.interval.is_zero() {
            let interval = state.interval;
            let this = self.clone();
            state.timer = Some(tokio::spawn(async move {
                tokio::time::sleep(interval).await;
                // 不在计时任务里直接跑，否则重新计时时会把自己中止
                tokio::spawn(async move { this.run_now().await });
            }));
        }
    }

    pub async fn run_now(self: Arc<Self>) {
        {
            let mut state = self.state.lock().unwrap();
            if state.running {
                return;
            }
            state.running = true;
            if let Some(timer) = state.timer.take() {
                timer.abort();
            }
        }
        let now = chrono::Utc::now().timestamp_millis();
        let status = match (self.fetch_all)().await {
            Ok(results) => AutoFetchStatus {
                last_run: Some(now),
                succeeded: results.iter().filter(|r| r.result.ok).count() as u32,
                failed: results
                    .iter()
                    .filter(|r| !r.result.ok && !r.result.cancelled)
                    .map(|r| FailedFetch { name: r.name.clone(), message: r.result.message.clone() })
                    .collect(),
            },
            Err(message) => AutoFetchStatus {
                last_run: Some(now),
                succeeded: 0,
                failed: vec![FailedFetch { name: "全部项目".into(), message }],
            },
        };
        {
            let mut state = self.state.lock().unwrap();
            state.running = false;
            state.status = status.clone();
        }
        self.schedule();
        (self.on_done)(status);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RemoteResult;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn item(ok: bool) -> FetchAllItem {
        FetchAllItem {
            path: "p".into(),
            name: "n".into(),
            result: if ok { RemoteResult::ok() } else { RemoteResult::failed("坏了") },
        }
    }

    #[tokio::test(start_paused = true)]
    async fn repeats_on_interval_and_stops_when_disabled() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = runs.clone();
        let fetcher = AutoFetcher::new(
            Arc::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(vec![item(true), item(false)]) })
            }),
            Arc::new(|_| {}),
        );
        fetcher.set_interval(Duration::from_secs(60));
        tokio::time::sleep(Duration::from_secs(61)).await;
        tokio::task::yield_now().await;
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        assert_eq!(fetcher.status().succeeded, 1);
        assert_eq!(fetcher.status().failed[0].message, "坏了");
        tokio::time::sleep(Duration::from_secs(60)).await;
        tokio::task::yield_now().await;
        assert_eq!(runs.load(Ordering::SeqCst), 2);
        fetcher.set_interval(Duration::ZERO);
        tokio::time::sleep(Duration::from_secs(600)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn no_overlap_and_keeps_going_after_failure() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = runs.clone();
        let fetcher = AutoFetcher::new(
            Arc::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Box::pin(async {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    Err("网络断了".to_string())
                })
            }),
            Arc::new(|_| {}),
        );
        fetcher.set_interval(Duration::from_secs(60));
        let first = tokio::spawn(fetcher.clone().run_now());
        tokio::task::yield_now().await;
        fetcher.clone().run_now().await;
        first.await.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        assert_eq!(fetcher.status().failed[0].name, "全部项目");
        tokio::time::sleep(Duration::from_secs(70)).await;
        tokio::task::yield_now().await;
        assert!(runs.load(Ordering::SeqCst) >= 2);
    }
}
