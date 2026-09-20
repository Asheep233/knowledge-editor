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
const MID_NEW_WS: &str = "ke-menu:new-workspace";
const MID_CLOSE_WS: &str = "ke-menu:close-workspace";
const MID_RECOVERY: &str = "ke-menu:recovery-check";
const MID_SETTINGS: &str = "ke-menu:settings";
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
            &MenuItem::with_id(app, MID_NEW_WS, "新建工作区…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MID_CLOSE_WS, "关闭工作区", true, None::<&str>)?,
            &MenuItem::with_id(app, MID_RECOVERY, "恢复检查…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MID_SETTINGS, "设置…", true, Some("Ctrl+,"))?,
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
            "关于 AstraNota",
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
        MID_NEW_WS => {
            let _ = app.emit(MID_NEW_WS, ());
        }
        MID_CLOSE_WS => {
            let _ = app.emit(MID_CLOSE_WS, ());
        }
        MID_RECOVERY => {
            let _ = app.emit(MID_RECOVERY, ());
        }
        MID_SETTINGS => {
            let _ = app.emit(MID_SETTINGS, ());
        }
        // P3-21：最近列表由前端维护，菜单只通知前端刷新并展示。
        MID_RECENT => {
            let _ = app.emit(MID_RECENT, ());
        }
        // B2（发布前全面审查修复）：菜单退出 / Ctrl+Q **必须**与关窗走同一 flush 握手。
        // 首次 → 隐藏窗口 + 通知前端 flush（`ke:close-requested`）+ 1.5s 兜底；
        // 前端 flush 完二次 close（或兜底到时）才真正退出。
        // 直接 request_exit 会 app.exit(0) 立即销毁 WebView，跳过 flush → 静默丢内容。
        MID_EXIT => {
            if !crate::begin_close_handshake(app) {
                request_exit(app);
            }
        }
        // R-1（独立验证发现）：重新加载会立即销毁 WebView 前端上下文，而 `beforeunload` 里的
        // `void flushPendingAll()` **不 await** —— 尾部防抖尚未落盘的内容存在丢失窗口。
        // 故改为握手：先 emit `ke:reload-requested` 让前端 await 完 flush，再由前端调用
        // `reload_main_window`；1.5s 兜底保证不会因前端异常而卡住。
        MID_RELOAD => crate::begin_reload_handshake(app),
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

/// R-1：重新加载主窗口（`#[tauri::command]`，供前端 flush 完成后调用）。
///
/// 放在 menu 模块（而非 crate 根）是为了与其它命令一样以 `menu::` 路径注册 ——
/// 同模块内 `#[tauri::command]` + `generate_handler!` 会触发 `__cmd__*` 宏重名（E0255）。
#[tauri::command]
pub fn reload_main_window(app: AppHandle) {
    // R-4：委托给 lib 侧（内置幂等守卫，避免与前端的回调各重载一次）。
    crate::reload_main_window_now(&app);
}

/// **退出第二阶段**：隐藏主窗口 → 后台清理 sidecar → 退出。
///
/// 这是「已确认可以退出」后的最终动作：正常路径由 `begin_close_handshake` 通知前端 flush，
/// 前端二次 close 或 1.5s 兜底定时器到达后调用本函数。**不要**在首次退出请求时直接调用
/// （那会跳过 flush 握手，见 B2）。
pub fn request_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    // v1.1.7：清理**同步**执行但严格有界（force/tree 杀 + 1.2s 预算）——
    // 保证侧车随主进程消亡（否则孤儿侧车占 8000，二次启动与陈旧后端交互）；
    // 同时不再复现 v1.1.6 的 5s 阻塞假死（预算内必定返回）。
    let _ = cleanup_on_exit(app);
    app.exit(0);
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
        "AstraNota\n\n版本：{version}\n工作区：{workspace}\n\n桌面壳：{shell_version}"
    );
    let _ = app
        .dialog()
        .message(text)
        .title("关于 AstraNota")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}
