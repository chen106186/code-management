//! 页面调用的全部能力；方法名和参数顺序与 src/shared/ipc.ts 的 Api 一一对应

use crate::activity::read_activity;
use crate::auto_fetch::AutoFetcher;
use crate::categories::subtree_ids;
use crate::git::{read_changes, read_remotes};
use crate::git_ops::{
    assert_hash, list_branches, list_remotes, read_commit, read_diff, read_log, switch_branch, validate_diff_target,
};
use crate::openers::{open_in_terminal, vscode_url};
use crate::projects::{map_limit, ProjectService};
use crate::readme::{read_readme, read_readme_image};
use crate::remote_ops::{run_fetch, RemoteOptions};
use crate::remotes::remote_web_url;
use crate::repo_queue::RepoQueue;
use crate::store::{is_auto_fetch_minutes, is_theme_setting, parse_export, Store};
use crate::types::{BranchKind, DiffTarget, FetchAllItem, ProjectPatch, RemoteProgress, RemoteResult};
use crate::watcher::RepoWatcher;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Theme};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tokio_util::sync::CancellationToken;

pub const EVENT_REMOTE_PROGRESS: &str = "event:remoteProgress";
pub const EVENT_REPO_CHANGED: &str = "event:repoChanged";
pub const EVENT_AUTO_FETCHED: &str = "event:autoFetched";
pub const EVENT_STATS_UPDATED: &str = "event:statsUpdated";

const ACTIVITY_CONCURRENCY: usize = 8;
const FETCH_ALL_CONCURRENCY: usize = 4;
const FETCH_ALL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_LOG_PAGE: u32 = 500;

pub struct AppState {
    pub store: Arc<Mutex<Store>>,
    pub projects: Arc<ProjectService>,
    pub queue: Arc<RepoQueue>,
    pub operations: Mutex<HashMap<String, CancellationToken>>,
    pub watcher: RepoWatcher,
    pub auto_fetch: Arc<AutoFetcher>,
    /// 真正退出时才放行关闭，否则关窗口只是收到托盘
    pub quitting: AtomicBool,
    /// 托盘没建起来时不能隐藏窗口，否则再也找不回来
    pub has_tray: AtomicBool,
}

/// 批量 Fetch 全部仓库；没有配置远程的仓库不算失败，也不计入结果
pub async fn fetch_all_repos(
    projects: Arc<ProjectService>,
    queue: Arc<RepoQueue>,
    cancel: CancellationToken,
    on_progress: Arc<dyn Fn(String) + Send + Sync>,
) -> Result<Vec<FetchAllItem>, String> {
    let snapshot = projects.snapshot().await?;
    let repos: Vec<(String, String)> =
        snapshot.projects.into_iter().filter(|p| p.git.is_some()).map(|p| (p.path, p.name)).collect();
    let total = repos.len();
    let done = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let results = map_limit(repos, FETCH_ALL_CONCURRENCY, |(path, name)| {
        let queue = queue.clone();
        let cancel = cancel.clone();
        let done = done.clone();
        let on_progress = on_progress.clone();
        async move {
            let result = queue
                .run(&path, async {
                    match list_remotes(&path).await {
                        Ok(remotes) if remotes.is_empty() => None,
                        Ok(_) => {
                            let options = RemoteOptions {
                                cancel,
                                non_interactive: true,
                                timeout: FETCH_ALL_TIMEOUT,
                                ..Default::default()
                            };
                            Some(run_fetch(&path, options).await)
                        }
                        Err(error) => Some(RemoteResult::failed(error.message)),
                    }
                })
                .await;
            let finished = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            on_progress(format!("{finished} / {total}"));
            result.map(|result| FetchAllItem { path, name, result })
        }
    })
    .await;
    Ok(results.into_iter().flatten().collect())
}

pub fn apply_theme(app: &AppHandle, theme: &str) {
    // 页面样式和 Monaco 都跟随 prefers-color-scheme，切换后会一起变
    app.set_theme(match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    });
}

struct Args<'a>(&'a [Value]);

impl Args<'_> {
    fn value(&self, index: usize) -> Value {
        self.0.get(index).cloned().unwrap_or(Value::Null)
    }

    fn get<T: DeserializeOwned>(&self, index: usize, error: &str) -> Result<T, String> {
        serde_json::from_value(self.value(index)).map_err(|_| error.to_string())
    }

    fn string(&self, index: usize, error: &str) -> Result<String, String> {
        self.get(index, error)
    }

    /// null 或字符串；用于可空的分类 id
    fn nullable(&self, index: usize, error: &str) -> Result<Option<String>, String> {
        self.get(index, error)
    }
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

async fn pick_directory(app: &AppHandle, title: &str, default: Option<String>) -> Option<String> {
    let (app, title) = (app.clone(), title.to_string());
    tokio::task::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(title);
        if let Some(window) = main_window(&app) {
            dialog = dialog.set_parent(&window);
        }
        if let Some(dir) = default {
            dialog = dialog.set_directory(dir);
        }
        dialog.blocking_pick_folder()?.into_path().ok().map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

/// 弹出确认框，点确定返回 true
async fn confirm(app: &AppHandle, kind: MessageDialogKind, title: &str, message: String, detail: String, ok: &str) -> bool {
    let (app, title, ok) = (app.clone(), title.to_string(), ok.to_string());
    tokio::task::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .message(format!("{message}\n\n{detail}"))
            .title(title)
            .kind(kind)
            .buttons(MessageDialogButtons::OkCancelCustom(ok, "取消".into()));
        if let Some(window) = main_window(&app) {
            dialog = dialog.parent(&window);
        }
        dialog.blocking_show()
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn api(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let state = state.inner().clone();
    dispatch(&app, &state, &method, Args(&args)).await
}

async fn dispatch(app: &AppHandle, state: &Arc<AppState>, method: &str, args: Args<'_>) -> Result<Value, String> {
    let store = &state.store;
    let projects = &state.projects;
    let snapshot = || async { json(projects.snapshot().await?) };

    // 页面传来的路径必须是已登记的项目或目录，否则拒绝
    let known = |index: usize| -> Result<String, String> {
        let path: String = args.get(index, "未登记的项目路径")?;
        if projects.is_known(&path) {
            Ok(path)
        } else {
            Err("未登记的项目路径".into())
        }
    };
    let known_list = |index: usize| -> Result<Vec<String>, String> {
        let paths: Vec<String> = args.get(index, "项目列表无效")?;
        if paths.iter().all(|p| projects.is_known(p)) {
            Ok(paths)
        } else {
            Err("未登记的项目路径".into())
        }
    };
    match method {
        "refresh" => snapshot().await,

        "addRoot" => match pick_directory(app, "选择要扫描的根目录", None).await {
            Some(path) => {
                store.lock().unwrap().add_root(&path)?;
                snapshot().await
            }
            None => Ok(Value::Null),
        },

        "addProject" => match pick_directory(app, "选择项目文件夹", None).await {
            Some(path) => {
                store.lock().unwrap().add_manual(&path)?;
                snapshot().await
            }
            None => Ok(Value::Null),
        },

        "addExcluded" => {
            let first_root = store.lock().unwrap().config().roots.first().cloned();
            match pick_directory(app, "选择要排除的目录", first_root).await {
                Some(path) => {
                    store.lock().unwrap().add_excluded(&path)?;
                    snapshot().await
                }
                None => Ok(Value::Null),
            }
        }

        "removeRoot" => {
            store.lock().unwrap().remove_root(&args.string(0, "路径无效")?)?;
            snapshot().await
        }

        "removeExcluded" => {
            store.lock().unwrap().remove_excluded(&args.string(0, "路径无效")?)?;
            snapshot().await
        }

        "hideProject" => {
            store.lock().unwrap().hide_many(&[known(0)?])?;
            snapshot().await
        }

        "restoreProject" => {
            store.lock().unwrap().restore(&known(0)?)?;
            snapshot().await
        }

        "setFavorite" => {
            let favorite = args.value(1) == Value::Bool(true);
            store.lock().unwrap().set_favorite(&known(0)?, favorite)?;
            Ok(Value::Null)
        }

        "setTags" => {
            let tags: Vec<String> = args.get(1, "标签无效")?;
            json(store.lock().unwrap().set_tags(&known(0)?, &tags)?)
        }

        "setRemark" => {
            let remark = args.string(1, "备注无效")?;
            json(store.lock().unwrap().set_remark(&known(0)?, &remark)?)
        }

        "createCategory" => {
            let name = args.string(0, "分类名称不能为空")?;
            let parent = args.nullable(1, "分类无效")?;
            let mut store = store.lock().unwrap();
            store.create_category(&name, parent)?;
            json(store.categories())
        }

        "renameCategory" => {
            let (id, name) = (args.string(0, "分类不存在")?, args.string(1, "分类名称不能为空")?);
            let mut store = store.lock().unwrap();
            store.rename_category(&id, &name)?;
            json(store.categories())
        }

        "moveCategory" => {
            let id = args.string(0, "分类不存在")?;
            let (parent, before) = (args.nullable(1, "分类无效")?, args.nullable(2, "分类无效")?);
            let mut store = store.lock().unwrap();
            store.move_category(&id, parent, before)?;
            json(store.categories())
        }

        "deleteCategory" => {
            let id = args.string(0, "分类不存在")?;
            let categories = store.lock().unwrap().categories();
            let category = categories.iter().find(|c| c.id == id).ok_or("分类不存在")?;
            let children = subtree_ids(&categories, &category.id).len() - 1;
            let detail = format!(
                "{}只删除分类，其中的项目会变成未分类，文件不受影响。",
                if children > 0 { format!("其下 {children} 个子分类也会一起删除。") } else { String::new() }
            );
            let message = format!("删除分类“{}”？", category.name);
            if !confirm(app, MessageDialogKind::Warning, "删除分类", message, detail, "删除").await {
                return Ok(Value::Null);
            }
            let mut store = store.lock().unwrap();
            store.delete_category(&id)?;
            json(store.categories())
        }

        "setProjectCategory" => {
            let category = args.nullable(1, "分类无效")?;
            store.lock().unwrap().set_category(&known(0)?, category)?;
            Ok(Value::Null)
        }

        "updateProjects" => {
            let paths = known_list(0)?;
            let patch: ProjectPatch = args.get(1, "修改内容无效")?;
            let mut store = store.lock().unwrap();
            store.update_projects(&paths, &patch)?;
            let result: Map<String, Value> =
                paths.iter().map(|p| Ok((p.clone(), json(store.meta_of(p))?))).collect::<Result<_, String>>()?;
            Ok(Value::Object(result))
        }

        "hideProjects" => {
            store.lock().unwrap().hide_many(&known_list(0)?)?;
            snapshot().await
        }

        "applyMoves" => {
            let from: Vec<String> = args.get(0, "路径无效")?;
            let moves: Vec<(String, String)> =
                projects.suggested_moves(&from).into_iter().map(|m| (m.from, m.to)).collect();
            store.lock().unwrap().migrate_projects(&moves)?;
            snapshot().await
        }

        "dismissMoves" => {
            let from: Vec<String> = args.get(0, "路径无效")?;
            let paths: Vec<String> = projects.suggested_moves(&from).into_iter().map(|m| m.from).collect();
            store.lock().unwrap().ignore_moves(&paths)?;
            snapshot().await
        }

        "exportConfig" => {
            let (directory, data) = {
                let store = store.lock().unwrap();
                (store.directory(), store.export_data())
            };
            let date = chrono::Utc::now().format("%Y-%m-%d");
            let handle = app.clone();
            let target = tokio::task::spawn_blocking(move || {
                let mut dialog = handle
                    .dialog()
                    .file()
                    .set_title("导出配置")
                    .set_directory(directory)
                    .set_file_name(format!("code-management-tool-config-{date}.json"))
                    .add_filter("JSON", &["json"]);
                if let Some(window) = main_window(&handle) {
                    dialog = dialog.set_parent(&window);
                }
                dialog.blocking_save_file()?.into_path().ok()
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(target) = target else { return Ok(Value::Null) };
            let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
            std::fs::write(&target, text).map_err(|e| format!("写入失败：{e}"))?;
            json(target.to_string_lossy())
        }

        "importConfig" => {
            let directory = store.lock().unwrap().directory();
            let handle = app.clone();
            let source = tokio::task::spawn_blocking(move || {
                let mut dialog =
                    handle.dialog().file().set_title("导入配置").set_directory(directory).add_filter("JSON", &["json"]);
                if let Some(window) = main_window(&handle) {
                    dialog = dialog.set_parent(&window);
                }
                dialog.blocking_pick_file()?.into_path().ok()
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(source) = source else { return Ok(Value::Null) };
            let text = std::fs::read_to_string(&source).map_err(|e| format!("读取失败：{e}"))?;
            let data = parse_export(&text)?;
            let detail = format!(
                "文件包含 {} 个根目录、{} 个分类、{} 个项目的信息。当前配置会先备份到数据目录，项目文件不受影响。",
                data.roots.len(),
                data.categories.len(),
                data.meta.len()
            );
            let message = "用这个文件替换当前全部配置？".to_string();
            if !confirm(app, MessageDialogKind::Warning, "导入配置", message, detail, "替换").await {
                return Ok(Value::Null);
            }
            let (theme, minutes) = {
                let mut store = store.lock().unwrap();
                store.replace_data(data)?;
                (store.theme().to_string(), store.auto_fetch_minutes())
            };
            apply_theme(app, &theme);
            state.auto_fetch.set_interval_minutes(minutes);
            snapshot().await
        }

        "setTheme" => {
            let theme = args.string(0, "主题无效")?;
            if !is_theme_setting(&theme) {
                return Err("主题无效".into());
            }
            store.lock().unwrap().set_theme(&theme)?;
            apply_theme(app, &theme);
            Ok(Value::Null)
        }

        "setAutoFetchMinutes" => {
            let minutes: u32 = args.get(0, "Fetch 间隔无效")?;
            if !is_auto_fetch_minutes(minutes) {
                return Err("Fetch 间隔无效".into());
            }
            store.lock().unwrap().set_auto_fetch_minutes(minutes)?;
            state.auto_fetch.set_interval_minutes(minutes);
            Ok(Value::Null)
        }

        "getAutoFetchStatus" => json(state.auto_fetch.status()),

        "setCloseToTray" => {
            store.lock().unwrap().set_close_to_tray(args.value(0) == Value::Bool(true))?;
            Ok(Value::Null)
        }

        "saveView" => {
            let mut store = store.lock().unwrap();
            store.save_view(&args.value(0))?;
            json(store.saved_views())
        }

        "deleteView" => {
            let mut store = store.lock().unwrap();
            store.delete_view(&args.string(0, "视图无效")?)?;
            json(store.saved_views())
        }

        "renameTag" => {
            let (from, to) = (args.string(0, "标签无效")?, args.string(1, "标签无效")?);
            let name = to.trim().to_string();
            if name == from {
                return snapshot().await;
            }
            let (usage_to, usage_from) = {
                let store = store.lock().unwrap();
                (store.tag_usage(&name), store.tag_usage(&from))
            };
            if usage_to > 0 {
                let message = format!("把“{from}”合并到已有的“{name}”？");
                let detail = format!("{usage_from} 个项目的标签会改成“{name}”，合并后不能自动拆分。");
                if !confirm(app, MessageDialogKind::Info, "合并标签", message, detail, "合并").await {
                    return Ok(Value::Null);
                }
            }
            store.lock().unwrap().rename_tag(&from, &name)?;
            snapshot().await
        }

        "deleteTag" => {
            let tag = args.string(0, "标签无效")?;
            let usage = store.lock().unwrap().tag_usage(&tag);
            let message = format!("删除标签“{tag}”？");
            let detail = format!("会从 {usage} 个项目上移除，项目文件不受影响。");
            if !confirm(app, MessageDialogKind::Warning, "删除标签", message, detail, "删除").await {
                return Ok(Value::Null);
            }
            store.lock().unwrap().delete_tag(&tag)?;
            snapshot().await
        }

        "recomputeStats" => {
            projects.recompute_stats();
            Ok(Value::Null)
        }

        "getActivity" => {
            let mine_only = args.value(0) == Value::Bool(true);
            let list = projects.snapshot().await?.projects;
            let repos: Vec<String> = list
                .into_iter()
                .filter(|p| p.git.as_ref().is_some_and(|g| g.head.is_some()))
                .map(|p| p.path)
                .collect();
            let entries = map_limit(repos, ACTIVITY_CONCURRENCY, |path| async move {
                // 单个仓库读不了不影响其他仓库
                let days = read_activity(&path, mine_only).await.unwrap_or_default();
                (path, days)
            })
            .await;
            let result: Map<String, Value> =
                entries.into_iter().map(|(path, days)| Ok((path, json(days)?))).collect::<Result<_, String>>()?;
            Ok(Value::Object(result))
        }

        "getReadme" => {
            let path = known(0)?;
            json(tokio::task::spawn_blocking(move || read_readme(&path)).await.map_err(|e| e.to_string())??)
        }

        "getReadmeImage" => {
            let path = known(0)?;
            let Ok(relative) = args.string(1, "") else { return Ok(Value::Null) };
            json(tokio::task::spawn_blocking(move || read_readme_image(&path, &relative)).await.map_err(|e| e.to_string())?)
        }

        "openInEditor" => {
            app.opener().open_url(vscode_url(&known(0)?), None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "openInTerminal" => {
            open_in_terminal(&known(0)?)?;
            Ok(Value::Null)
        }

        "openInExplorer" => {
            app.opener().open_path(known(0)?, None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        // 在浏览器打开远程仓库页面；地址由这里读取，不信任页面传来的网址
        "openRemote" => {
            let path = known(0)?;
            let name = args.string(1, "远程无效")?;
            let remotes = read_remotes(&path).await?;
            let url = remotes
                .iter()
                .find(|r| r.name == name)
                .and_then(|r| remote_web_url(&r.url))
                .ok_or("这个地址不能在浏览器打开")?;
            app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "copyText" => {
            let text = args.string(0, "内容无效")?;
            app.clipboard().write_text(text).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        "getChanges" => json(read_changes(&known(0)?).await?),

        "getDiff" => {
            let repo = known(0)?;
            let target: DiffTarget = args.get(1, "Diff 类型无效")?;
            let target = validate_diff_target(&repo, target)?;
            json(read_diff(&repo, &target).await?)
        }

        "getLog" => {
            let repo = known(0)?;
            let skip: u32 = args.get(1, "").unwrap_or(0);
            let limit = args.get::<u32>(2, "").ok().filter(|l| *l > 0).map(|l| l.min(MAX_LOG_PAGE)).unwrap_or(100);
            json(read_log(&repo, skip, limit).await?)
        }

        "getCommit" => {
            let repo = known(0)?;
            let hash = assert_hash(&args.string(1, "提交号无效")?)?;
            json(read_commit(&repo, &hash).await?)
        }

        "getBranches" => json(list_branches(&known(0)?).await?),

        // 唯一会改动工作区的操作；会覆盖未提交改动时 git 拒绝并报错
        "switchBranch" => {
            let repo = known(0)?;
            let name = args.string(1, "分支名无效")?;
            let kind = if args.value(2) == Value::String("remote".into()) { BranchKind::Remote } else { BranchKind::Local };
            state.queue.run(&repo, switch_branch(&repo, &name, kind)).await?;
            Ok(Value::Null)
        }

        "fetchRepo" => {
            let repo = known(0)?;
            let op_id = args.string(1, "操作标识无效")?;
            if op_id.is_empty() {
                return Err("操作标识无效".into());
            }
            let cancel = CancellationToken::new();
            state.operations.lock().unwrap().insert(op_id.clone(), cancel.clone());
            let handle = app.clone();
            let progress_id = op_id.clone();
            let options = RemoteOptions {
                cancel,
                on_progress: Some(Arc::new(move |line| {
                    let _ = handle.emit(EVENT_REMOTE_PROGRESS, RemoteProgress { op_id: progress_id.clone(), line });
                })),
                ..Default::default()
            };
            let result = state.queue.run(&repo, run_fetch(&repo, options)).await;
            state.operations.lock().unwrap().remove(&op_id);
            json(result)
        }

        "fetchAll" => {
            let op_id = args.string(0, "操作标识无效")?;
            if op_id.is_empty() {
                return Err("操作标识无效".into());
            }
            let cancel = CancellationToken::new();
            state.operations.lock().unwrap().insert(op_id.clone(), cancel.clone());
            let handle = app.clone();
            let progress_id = op_id.clone();
            let result = fetch_all_repos(
                projects.clone(),
                state.queue.clone(),
                cancel,
                Arc::new(move |line| {
                    let _ = handle.emit(EVENT_REMOTE_PROGRESS, RemoteProgress { op_id: progress_id.clone(), line });
                }),
            )
            .await;
            state.operations.lock().unwrap().remove(&op_id);
            json(result?)
        }

        "cancelRemote" => {
            if let Ok(op_id) = args.string(0, "") {
                if let Some(token) = state.operations.lock().unwrap().get(&op_id) {
                    token.cancel();
                }
            }
            Ok(Value::Null)
        }

        "watchRepo" => {
            let path = if args.value(0).is_null() { None } else { Some(known(0)?) };
            state.watcher.watch(path);
            Ok(Value::Null)
        }

        _ => Err(format!("未知的方法：{method}")),
    }
}
