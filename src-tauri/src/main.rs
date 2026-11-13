// 发布版不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod api;
mod auto_fetch;
mod categories;
mod git;
mod git_ops;
mod git_parse;
mod openers;
mod paths;
mod projects;
mod readme;
mod remote_ops;
mod remotes;
mod repo_queue;
mod scanner;
mod stats;
mod store;
mod tech;
mod tray;
mod types;
mod watcher;

use api::{apply_theme, fetch_all_repos, AppState, EVENT_AUTO_FETCHED, EVENT_REPO_CHANGED, EVENT_STATS_UPDATED};
use auto_fetch::AutoFetcher;
use projects::ProjectService;
use repo_queue::RepoQueue;
use stats::StatsService;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use store::Store;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tokio_util::sync::CancellationToken;
use types::StatsUpdate;
use watcher::RepoWatcher;

/// 和 Electron 版本相同的数据目录，升级后配置和统计缓存直接沿用
const DATA_DIR: &str = "E:\\1024-code\\CodeManagement";

/// 目录建不了（比如这台电脑没有 E 盘）时退回系统默认位置，保证程序能启动
fn data_dir(app: &AppHandle) -> PathBuf {
    let preferred = std::env::var("CODE_MANAGEMENT_DATA_DIR").unwrap_or_else(|_| DATA_DIR.into());
    if std::fs::create_dir_all(&preferred).is_ok() {
        return preferred.into();
    }
    eprintln!("无法使用数据目录 {preferred}，改用系统默认位置");
    let fallback = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit(app: &AppHandle) {
    app.state::<Arc<AppState>>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 页面内不跳转、不开新窗口；http(s) 链接交给系统浏览器
fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(5173))
}

fn open_external(app: &AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// 页面左上角已经有图标和名称，标题栏里不再画一遍；窗口标题保留，任务栏和 Alt+Tab 仍显示名称
#[cfg(windows)]
fn hide_caption(window: &tauri::WebviewWindow) {
    #[repr(C)]
    struct WtaOptions {
        flags: u32,
        mask: u32,
    }
    #[link(name = "uxtheme")]
    extern "system" {
        fn SetWindowThemeAttribute(hwnd: *mut std::ffi::c_void, attribute: i32, value: *const WtaOptions, size: u32) -> i32;
    }
    const WTA_NONCLIENT: i32 = 1;
    const WTNCA_NODRAWCAPTION: u32 = 0x1;
    const WTNCA_NODRAWICON: u32 = 0x2;
    let Ok(hwnd) = window.hwnd() else { return };
    let options = WtaOptions { flags: WTNCA_NODRAWCAPTION | WTNCA_NODRAWICON, mask: WTNCA_NODRAWCAPTION | WTNCA_NODRAWICON };
    // 失败时只是标题栏照常显示，不影响使用
    unsafe {
        SetWindowThemeAttribute(hwnd.0, WTA_NONCLIENT, &options, std::mem::size_of::<WtaOptions>() as u32);
    }
}

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Code Management Tool")
        .inner_size(1240.0, 820.0)
        .min_inner_size(760.0, 520.0)
        // 页面加载完再显示，避免先闪一下空白
        .visible(false)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
            }
        })
        .on_navigation(move |url| {
            if is_app_url(url) {
                return true;
            }
            open_external(&navigation_app, url);
            false
        })
        .on_new_window(move |url, _features| {
            open_external(&popup_app, &url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    #[cfg(windows)]
    hide_caption(&window);
    // 页面加载出错时也要让窗口出来，否则进程留在后台，用户什么也看不到
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let _ = window.show();
    });
    Ok(())
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let dir = data_dir(&handle);
    let store = Arc::new(Mutex::new(Store::open(dir.join("store.json"))));
    let stats = StatsService::new(dir.join("stats.json"));
    let stats_app = handle.clone();
    stats.set_on_update(Arc::new(move |path, stats| {
        let _ = stats_app.emit(EVENT_STATS_UPDATED, StatsUpdate { path, stats });
    }));
    let projects = Arc::new(ProjectService::new(store.clone(), stats.clone()));
    let queue = Arc::new(RepoQueue::default());

    // 结果由页面收到事件后刷新；窗口隐藏时页面也在运行，托盘状态会跟着更新
    let fetch_projects = projects.clone();
    let fetch_queue = queue.clone();
    let done_app = handle.clone();
    let auto_fetch = AutoFetcher::new(
        Arc::new(move || {
            let (projects, queue) = (fetch_projects.clone(), fetch_queue.clone());
            Box::pin(fetch_all_repos(projects, queue, CancellationToken::new(), Arc::new(|_| {})))
        }),
        Arc::new(move |status| {
            let _ = done_app.emit(EVENT_AUTO_FETCHED, status);
        }),
    );

    let watch_app = handle.clone();
    let (theme, minutes) = {
        let store = store.lock().unwrap();
        (store.theme().to_string(), store.auto_fetch_minutes())
    };
    let state = Arc::new(AppState {
        store,
        projects: projects.clone(),
        queue,
        operations: Mutex::default(),
        watcher: RepoWatcher::new(move |path| {
            let _ = watch_app.emit(EVENT_REPO_CHANGED, path);
        }),
        auto_fetch: auto_fetch.clone(),
        quitting: false.into(),
        has_tray: false.into(),
    });
    app.manage(state.clone());

    apply_theme(&handle, &theme);
    // 计时任务要在 Tauri 的运行时里创建
    tauri::async_runtime::spawn(async move { auto_fetch.set_interval_minutes(minutes) });
    create_window(&handle)?;

    // 托盘只是附加功能，出问题不能挡住窗口
    let tray = tray::AppTray::new(
        &handle,
        |app, id| match id {
            tray::MENU_SHOW => show_window(app),
            tray::MENU_FETCH => {
                let fetcher = app.state::<Arc<AppState>>().auto_fetch.clone();
                tauri::async_runtime::spawn(fetcher.run_now());
            }
            tray::MENU_QUIT => quit(app),
            _ => {}
        },
        show_window,
    );
    match tray {
        // 托盘由刷新回调持有，和应用同生命周期
        Ok(tray) => {
            projects.set_on_snapshot(Arc::new(move |snapshot| tray.update(snapshot)));
            state.has_tray.store(true, Ordering::SeqCst);
        }
        Err(error) => eprintln!("无法创建托盘，关闭窗口时将直接退出：{error}"),
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 必须最先注册：第二次启动时把已有窗口调出来
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![api::api])
        .setup(setup)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<AppState>>();
                let close_to_tray = state.store.lock().unwrap().close_to_tray();
                if !state.quitting.load(Ordering::SeqCst) && state.has_tray.load(Ordering::SeqCst) && close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Code Management Tool 启动失败");
}
