//! M5：桌面原生菜单（文件 / 编辑 / 视图 / 帮助）
//!
//! 菜单动作对前端经 Tauri 事件广播（`ke-menu:*`），前端 App.tsx 监听后
//! 复用既有 handler（新建文档 / 打开工作区 / 打开最近）。
//! 「最近」子菜单不固化为启动时的静态列表（P3-21：启动构建会过期），而是仅提供
//! 一个「最近工作区…」触发项，点击后 emit `ke-menu:refresh-recent`，由前端从后端
//! 拉取最新的 recent_workspaces 并展示/打开——最近列表的所有权在前端。
//! 「关于」对话框版本取自后端 runtime 上报（三同步常量）。

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::sidecar::{cleanup_on_exit, SidecarState};

/// 菜单项 ID（同时作为广播到前端的事件名）
const MID_NEW: &str = "ke-menu:new-document";
const MID_OPEN_WS: &str = "ke-menu:open-workspace";
const MID_EXIT: &str = "ke-menu:exit";
const MID_RELOAD: &str = "ke-menu:reload";
#[cfg(debug_assertions)]
const MID_DEVTOOLS: &str = "ke-menu:devtools";
const MID_ABOUT: &str = "ke-menu:about";
/// P3-21：「最近」触发项（点击后由前端拉取最近列表，避免启动时静态列表过期）。
const MID_RECENT: &str = "ke-menu:refresh-recent";

/// 构建并挂载主菜单
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let recent = build_recent_submenu(app)?;

    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &MenuItem::with_id(app, MID_NEW, "新建文档", true, Some("Ctrl+N"))?,
            &MenuItem::with_id(app, MID_OPEN_WS, "打开 Workspace…", true, Some("Ctrl+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MID_EXIT, "退出", true, Some("Ctrl+Q"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    #[cfg(debug_assertions)]
    let view = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &MenuItem::with_id(app, MID_RELOAD, "重新加载", true, Some("Ctrl+R"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MID_DEVTOOLS, "开发者工具", true, Some("F12"))?,
        ],
    )?;

    #[cfg(not(debug_assertions))]
    let view = Submenu::with_items(
        app,
        "视图",
        true,
        &[&MenuItem::with_id(app, MID_RELOAD, "重新加载", true, Some("Ctrl+R"))?],
    )?;

    let help = Submenu::with_items(
        app,
        "帮助",
        true,
        &[&MenuItem::with_id(
            app,
            MID_ABOUT,
            "关于 KnowledgeEditor",
            true,
            None::<&str>,
        )?],
    )?;

    app.set_menu(Menu::with_items(app, &[&file, &edit, &view, &help])?)?;
    Ok(())
}

/// 菜单点击事件分发
pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().0.as_str();
    match id {
        MID_NEW => {
            let _ = app.emit(MID_NEW, ());
        }
        MID_OPEN_WS => {
            let _ = app.emit(MID_OPEN_WS, ());
        }
        // P3-21：最近列表由前端维护，菜单只通知前端刷新并展示。
        MID_RECENT => {
            let _ = app.emit(MID_RECENT, ());
        }
        MID_EXIT => request_exit(app),
        MID_RELOAD => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.reload();
            }
        }
        #[cfg(debug_assertions)]
        MID_DEVTOOLS => {
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
        }
        MID_ABOUT => show_about(app),
        _ => {}
    }
}

/// 统一退出流程：隐藏主窗口 → 后台清理 sidecar → 退出。
/// 与窗口 CloseRequested 完全一致（M2 冒烟修复后约定）。
pub fn request_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        cleanup_on_exit(&app);
        app.exit(0);
    });
}

/// 构建「最近」子菜单：单一触发项，点击后 emit `ke-menu:refresh-recent`。
/// 最近工作区列表由前端从后端拉取（recent_workspaces），原生菜单不再捕获启动时的静态列表。
fn build_recent_submenu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    Submenu::with_items(
        app,
        "最近",
        true,
        &[&MenuItem::with_id(app, MID_RECENT, "最近工作区…", true, None::<&str>)?],
    )
}

/// 关于对话框：版本取自后端 runtime 上报（三同步常量），fallback 桌面壳版本
fn show_about(app: &AppHandle) {
    let shell_version = app.package_info().version.to_string();
    let mut version = shell_version.clone();
    let mut workspace = "（后端未就绪）".to_string();
    if let Some(info) = app.state::<SidecarState>().info.lock().unwrap().clone() {
        version = info.version;
        workspace = info.workspace;
    }
    let text = format!(
        "KnowledgeEditor\n\n版本：{version}\n工作区：{workspace}\n\n桌面壳：{shell_version}"
    );
    let _ = app
        .dialog()
        .message(text)
        .title("关于 KnowledgeEditor")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}
