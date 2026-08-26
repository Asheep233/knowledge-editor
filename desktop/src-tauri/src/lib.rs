// KnowledgeEditor Tauri 桌面壳（Phase 7 M1：Sidecar 管理）
// 窗口加载 frontend/dist（release）或 vite dev server（dev）；
// setup 中启动 Sidecar Manager（拉起 backend 侧车 → health 握手 → 写 runtime.json）；
// 窗口关闭时触发退出清理（先通知、再等 5s、超时按 PID 树强杀）。

mod menu;
mod settings;
mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager};

/// P1-14 关窗 flush 握手标记：第一次 CloseRequested 已 emit `ke:close-requested`
/// （通知前端先 flush 未保存内容），第二次（前端已 flush 或用户再次点关闭）立即退出。
/// 用静态标记避免重复 emit / 重复 prevent_close。
static CLOSE_REQUESTED: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // P1-12：多实例互斥（需在 setup 之前注册）。第二实例启动时回调聚焦已有主窗口后退出。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
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
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // P1-14 关窗 flush 握手：
                // 第一次 CloseRequested → prevent_close + 隐藏窗口 + 通知前端 flush
                // （`ke:close-requested`），并启动 1.5s 兜底定时器（后端已清理后强退）。
                // 第二次（前端已 flush 或用户再次点关闭）→ 立即走统一退出清理。
                if !CLOSE_REQUESTED.swap(true, Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.app_handle().emit("ke:close-requested", ());
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1500));
                        menu::request_exit(&app);
                    });
                } else {
                    menu::request_exit(window.app_handle());
                }
            }
        })
        .on_menu_event(|app, event| menu::handle_event(app, event))
        .invoke_handler(tauri::generate_handler![
            sidecar::get_runtime_info,
            settings::get_settings,
            settings::update_settings,
            settings::open_log_dir,
            settings::open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
