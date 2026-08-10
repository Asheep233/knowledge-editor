// KnowledgeEditor Tauri 桌面壳（Phase 7 M1：Sidecar 管理）
// 窗口加载 frontend/dist（release）或 vite dev server（dev）；
// setup 中启动 Sidecar Manager（拉起 backend 侧车 → health 握手 → 写 runtime.json）；
// 窗口关闭时触发退出清理（先通知、再等 5s、超时按 PID 树强杀）。

mod menu;
mod settings;
mod sidecar;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                // M2 冒烟修复：cleanup_on_exit 内 taskkill 等待 + 最多 5s 轮询若在
                // CloseRequested 处理器中同步执行，会长时间阻塞主线程、破坏 tao 的
                // 窗口销毁流程（复现：sidecar 已清理完毕但主窗口残留不退出）。
                // 改为 prevent_close + 隐藏窗口 + 后台线程清理，清理完成后强制退出。
                api.prevent_close();
                menu::request_exit(window.app_handle());
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
