// KnowledgeEditor Tauri 桌面壳（Phase 7 M1：Sidecar 管理）
// 窗口加载 frontend/dist（release）或 vite dev server（dev）；
// setup 中启动 Sidecar Manager（拉起 backend 侧车 → health 握手 → 写 runtime.json）；
// 窗口关闭/菜单退出均先走 flush 握手（`begin_close_handshake`），前端 flush 后二次 close 才真正清理退出（有界强杀，见 sidecar.rs）。

mod menu;
mod settings;
mod sidecar;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// P1-14 关窗 flush 握手标记：第一次 CloseRequested 已 emit `ke:close-requested`
/// （通知前端先 flush 未保存内容），第二次（前端已 flush 或用户再次点关闭）立即退出。
/// 用静态标记避免重复 emit / 重复 prevent_close。
static CLOSE_REQUESTED: AtomicBool = AtomicBool::new(false);

/// R-2（独立验证发现）：退出握手的**代数**。1.5s 兜底线程捕获当时的代数，只有代数未变才真正退出
/// —— 这样「窗口在兜底窗口内被重新激活（单实例 show）」即可取消待定退出，不会丢掉刚回来的输入。
static CLOSE_GENERATION: AtomicU32 = AtomicU32::new(0);

/// R-4（独立验证发现）：**重新加载幂等守卫**。否则「前端 flush 完后回调重载」与
/// 「1.5s 无守卫兜底」会各重载一次（双重重载），而第 2 次重载会直接销毁重载#1 之后
/// 用户已输入的未落盘内容 —— 正是 R-1 想堵的丢内容族。
static RELOAD_DONE: AtomicBool = AtomicBool::new(false);

/// B2（发布前全面审查修复）：**统一的退出握手**。
///
/// 首次调用：隐藏主窗口 → 通知前端 flush 未决保存（`ke:close-requested`）→ 启动 1.5s 兜底强退，
/// 并返回 `true`（调用方若是关窗路径需自行 `api.prevent_close()`）。
/// 二次调用（前端 flush 完再 close，或用户再次触发退出）：返回 `false`，调用方直接走
/// `menu::request_exit` 真正退出。
///
/// ⚠️ **关窗（X / Alt+F4）与菜单「退出」/ Ctrl+Q 必须共用本函数**。
/// 历史上菜单退出直接 `app.exit(0)`，跳过了 flush 握手 —— 由于保存是尾部防抖（连续输入会
/// 不断推迟落盘），连续输入后按 Ctrl+Q 会**静默丢失**自上次自动保存以来的全部内容。
pub fn begin_close_handshake(app: &AppHandle) -> bool {
    if CLOSE_REQUESTED.swap(true, Ordering::SeqCst) {
        return false;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let _ = app.emit("ke:close-requested", ());
    let generation = CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        if CLOSE_GENERATION.load(Ordering::SeqCst) == generation {
            menu::request_exit(&app_handle);
        }
    });
    true
}

/// R-2：**取消待定退出**。窗口被重新显示（单实例激活 show/unminimize/set_focus）时调用。
pub fn cancel_pending_exit() {
    CLOSE_REQUESTED.store(false, Ordering::SeqCst);
    CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// R-1：重新加载握手 —— 先通知前端 flush 未决保存，由前端回调 `reload_main_window`；
/// 1.5s 兜底（不依赖前端）保证刷新不会卡住。
pub fn begin_reload_handshake(app: &AppHandle) {
    RELOAD_DONE.store(false, Ordering::SeqCst);
    let _ = app.emit("ke:reload-requested", ());
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        // R-4：只有「前端还没重载过」时才兜底重载（swap 兼作互斥）。
        if !RELOAD_DONE.swap(true, Ordering::SeqCst) {
            reload_main_window_now(&app_handle);
        }
    });
}

/// R-4：真正执行重载（前端回调与兜底线程都走这里，先置位保证**只重载一次**）。
pub fn reload_main_window_now(app: &AppHandle) {
    RELOAD_DONE.store(true, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.reload();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // P1-12：多实例互斥（需在 setup 之前注册）。第二实例启动时回调聚焦已有主窗口后退出。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                // v1.1.6 加固：关窗后实例可能处于「隐藏但未退出」状态（退出链偶发挂起），
                // 二次启动必须 show()（仅 unminimize/focus 对隐藏窗口无效——本 bug 现象）
                // R-2：用户回到应用 → 取消可能的待定退出（1.5s 兜底窗口内）。
                cancel_pending_exit();
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::SidecarState::default())
        .setup(|app| {
            sidecar::start(app.handle().clone());
            // M5：构建原生菜单（文件/编辑/视图/帮助）
            let _ = menu::build(app.handle());
            // 窗口图标固定为 256×256 高分辨率源（任务栏/Alt-Tab 从大图高质下采样，
            // 避免默认 32×32 源在 24px 任务栏按钮上被低质缩放发糊）。
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                    let _ = w.set_icon(img);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // P1-14 关窗 flush 握手（B2 修复：抽为 begin_close_handshake，与菜单退出共用）。
                // 第一次 CloseRequested → prevent_close + 隐藏窗口 + 通知前端 flush
                // （`ke:close-requested`），并启动 1.5s 兜底定时器（后端已清理后强退）。
                // 第二次（前端已 flush 或用户再次点关闭）→ 立即走统一退出清理。
                if begin_close_handshake(window.app_handle()) {
                    api.prevent_close();
                } else {
                    menu::request_exit(window.app_handle());
                }
            }
        })
        .on_menu_event(|app, event| menu::handle_event(app, event))
        .invoke_handler(tauri::generate_handler![
            menu::reload_main_window,
            sidecar::get_runtime_info,
            settings::get_settings,
            settings::update_settings,
            settings::open_log_dir,
            settings::open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
