use crate::types::{Project, Snapshot};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const ICON: &[u8] = include_bytes!("../icons/32x32.png");
const DOT_RADIUS: i64 = 7;

pub const MENU_SHOW: &str = "show";
pub const MENU_FETCH: &str = "fetch";
pub const MENU_QUIT: &str = "quit";

fn is_changed(project: &Project) -> bool {
    project.git.as_ref().is_some_and(|g| g.staged + g.unstaged + g.untracked + g.conflicted > 0)
}

/// 在图标右下角画一个琥珀色圆点，表示有项目落后远程
fn with_dot(base: &Image<'_>) -> Image<'static> {
    let (width, height) = (base.width() as i64, base.height() as i64);
    let mut rgba = base.rgba().to_vec();
    let radius = DOT_RADIUS * width / 32;
    let center = (width - radius - 1, height - radius - 1);
    for y in 0..height {
        for x in 0..width {
            if (x - center.0).pow(2) + (y - center.1).pow(2) > radius.pow(2) {
                continue;
            }
            let index = ((y * width + x) * 4) as usize;
            rgba[index..index + 4].copy_from_slice(&[0xf5, 0x9e, 0x0b, 0xff]);
        }
    }
    Image::new_owned(rgba, width as u32, height as u32)
}

pub struct AppTray {
    app: AppHandle,
    tray: TrayIcon,
    icon: Image<'static>,
    icon_with_dot: Image<'static>,
    /// 上次落后远程的项目；None 表示还没刷新过，第一次不发通知
    behind: Mutex<Option<HashSet<String>>>,
}

impl AppTray {
    /// 菜单点击和图标单击由调用方处理，这里只负责显示
    pub fn new(
        app: &AppHandle,
        on_menu: impl Fn(&AppHandle, &str) + Send + Sync + 'static,
        on_click: impl Fn(&AppHandle) + Send + Sync + 'static,
    ) -> tauri::Result<Self> {
        let icon = Image::from_bytes(ICON)?;
        let icon_with_dot = with_dot(&icon);
        let tray = TrayIconBuilder::with_id("main")
            .icon(icon.clone())
            .show_menu_on_left_click(false)
            .on_menu_event(move |app, event| on_menu(app, event.id().as_ref()))
            .on_tray_icon_event(move |tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    on_click(tray.app_handle());
                }
            })
            .build(app)?;
        let this = Self { app: app.clone(), tray, icon, icon_with_dot, behind: Mutex::new(None) };
        this.render(0, 0, 0)?;
        Ok(this)
    }

    fn render(&self, changed: usize, unpushed: usize, behind: usize) -> tauri::Result<()> {
        let app = &self.app;
        let info = |id: &str, text: String| MenuItem::with_id(app, id, text, false, None::<&str>);
        let menu = Menu::with_items(
            app,
            &[
                &MenuItem::with_id(app, MENU_SHOW, "显示看板", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &info("changed", format!("有改动 {changed} 个"))?,
                &info("unpushed", format!("未推送 {unpushed} 个"))?,
                &info("behind", format!("落后远程 {behind} 个"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, MENU_FETCH, "立即 Fetch 全部", true, None::<&str>)?,
                &MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?,
            ],
        )?;
        self.tray.set_menu(Some(menu))?;
        self.tray.set_tooltip(Some(format!(
            "Code Management Tool\n有改动 {changed} · 未推送 {unpushed} · 落后远程 {behind}"
        )))?;
        self.tray.set_icon(Some(if behind > 0 { self.icon_with_dot.clone() } else { self.icon.clone() }))
    }

    /// 每次刷新后调用；有项目新变成落后远程、且用户不在看窗口时发一条通知
    pub fn update(&self, snapshot: &Snapshot) {
        let projects = &snapshot.projects;
        let behind: Vec<&Project> = projects.iter().filter(|p| p.git.as_ref().is_some_and(|g| g.behind > 0)).collect();
        let _ = self.render(
            projects.iter().filter(|p| is_changed(p)).count(),
            projects.iter().filter(|p| p.git.as_ref().is_some_and(|g| g.ahead > 0)).count(),
            behind.len(),
        );

        let fresh: Vec<&Project> = {
            let mut previous = self.behind.lock().unwrap();
            let fresh = match previous.as_ref() {
                Some(set) => behind.iter().filter(|p| !set.contains(&p.path)).copied().collect(),
                None => vec![],
            };
            *previous = Some(behind.iter().map(|p| p.path.clone()).collect());
            fresh
        };
        let focused = self.app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
        if fresh.is_empty() || focused {
            return;
        }
        let names: Vec<&str> = fresh.iter().take(3).map(|p| p.remark.as_deref().unwrap_or(&p.name)).collect();
        let body = if fresh.len() > 3 { format!("{} 等", names.join("、")) } else { names.join("、") };
        let _ = self.app.notification().builder().title(format!("{} 个项目落后远程", fresh.len())).body(body).show();
    }
}
