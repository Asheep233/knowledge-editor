// KnowledgeEditor Tauri 桌面壳（Phase 7 M1：Sidecar 管理）
// 窗口加载 frontend/dist（release）或 vite dev server（dev）；
// setup 中启动 Sidecar Manager（拉起 backend 侧车 → health 握手 → 写 runtime.json）；
// 窗口关闭/菜单退出均先走 flush 握手（`begin_close_handshake`），前端 flush 后二次 close 才真正清理退出（有界强杀，见 sidecar.rs）。

mod pack_store;
mod print_snapshot;
mod workshop_protocol;
mod print;
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

/// R-4b-2（独立验证发现）：**重新加载握手代数**。每次握手 +1，兜底线程捕获当时代数，
/// 醒来时若代数已变（用户在 1.5s 内又按了一次 Ctrl+R）就放弃 —— 否则旧线程会把新一轮
/// 握手重载一次，造成「第二次重载销毁窄窗内新输入」。
static RELOAD_GENERATION: AtomicU32 = AtomicU32::new(0);

/// 启动看门狗（2026-10-24 真机事故处置）。
///
/// 事故现场：Modern Standby 刚恢复后双击桌面图标，进程与 sidecar 均已启动（runtime.json/端口都在），
/// 但 **WebView2 初始化挂起、主窗口从未创建** —— 用户看到「双击没反应」，再次双击只会触发单实例
/// 回调（找不到主窗口 → 什么都不发生），只能在任务管理器结束进程。8 次干净重启均 0.5s 出窗口，
/// 属一次性环境异常（会话刚恢复），但**不能留下无窗口僵尸进程**。
///
/// 本看门狗在进程启动时拉起独立线程，用纯 Win32 轮询（不依赖可能被卡住的 Tauri 事件循环）：
///   - 30s 内检测到可见主窗口 → 正常，线程退出；
///   - 关窗握手中（`CLOSE_REQUESTED`）→ 让路退出；
///   - 超时仍有窗口但隐藏/最小化 → 尝试恢复（SW_RESTORE/SW_SHOW + 前置）并记录；
///   - 超时窗口根本不存在 → 写 `runtime/startup-watchdog.log` + 原生错误框 + 强制退出（用户可重试）。
#[cfg(target_os = "windows")]
mod startup_watchdog {
    use std::ffi::c_void;

    pub type HWND = *mut c_void;

    #[link(name = "user32")]
    extern "system" {
        pub fn FindWindowW(class: *const u16, title: *const u16) -> HWND;
        pub fn IsWindowVisible(hwnd: HWND) -> i32;
        pub fn IsIconic(hwnd: HWND) -> i32;
        pub fn ShowWindow(hwnd: HWND, cmd: i32) -> i32;
        pub fn SetForegroundWindow(hwnd: HWND) -> i32;
        pub fn MessageBoxW(hwnd: HWND, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }

    pub fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

/// 见 [`startup_watchdog`]；`std::process::exit` 兜底只在窗口 30s 未出现时触发。
#[cfg(target_os = "windows")]
fn spawn_startup_watchdog() {
    std::thread::spawn(|| {
        use std::sync::atomic::Ordering;
        use std::time::{Duration, Instant};
        let class = startup_watchdog::wide("Tauri Window");
        let title = startup_watchdog::wide("AstraNota");
        let find = || unsafe { startup_watchdog::FindWindowW(class.as_ptr(), title.as_ptr()) };
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            // 用户已经触发关窗（握手隐藏窗口）→ 这不是启动失败，让路
            if CLOSE_REQUESTED.load(Ordering::SeqCst) {
                return;
            }
            let hwnd = find();
            if !hwnd.is_null() && unsafe { startup_watchdog::IsWindowVisible(hwnd) } != 0 {
                return; // 正常启动（通常 <2s 就走到这里）
            }
            if Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }

        let hwnd = find();
        let mut detail = String::from("主窗口未创建（WebView2 初始化可能失败）");
        if !hwnd.is_null() {
            let iconic = unsafe { startup_watchdog::IsIconic(hwnd) } != 0;
            let cmd = if iconic { 9 /* SW_RESTORE */ } else { 5 /* SW_SHOW */ };
            unsafe {
                startup_watchdog::ShowWindow(hwnd, cmd);
                startup_watchdog::SetForegroundWindow(hwnd);
            }
            detail = format!("窗口存在但{}（已尝试恢复）", if iconic { "最小化" } else { "不可见" });
        }

        // 诊断日志（尽力写；失败不阻塞）
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let msg = format!("startup-watchdog: 启动 30s 后仍未出现可见主窗口 — {detail} @ unix_ms={ts}\n");
        let dir = crate::sidecar::data_dir().join("runtime");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("startup-watchdog.log"), msg.as_bytes());
        eprintln!("{msg}");

        if hwnd.is_null() {
            // 给用户可见反馈，而不是又留一个「双击没反应」的僵尸
            let text = startup_watchdog::wide(
                "AstraNota 启动超时：主窗口没有创建出来（WebView2 可能初始化失败）。\n\n应用将退出，请重新双击图标重试；若反复出现，请把\n%APPDATA%\\KnowledgeEditor\\runtime\\startup-watchdog.log\n反馈给开发者。",
            );
            let caption = startup_watchdog::wide("AstraNota 启动失败");
            unsafe {
                startup_watchdog::MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
            }
            std::process::exit(1);
        }
        // 窗口存在但恢复后仍不可见 → 退出让用户重试（不留僵尸）
        if unsafe { startup_watchdog::IsWindowVisible(hwnd) } == 0 {
            std::process::exit(1);
        }
    });
}

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
    let generation = RELOAD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    RELOAD_DONE.store(false, Ordering::SeqCst);
    let _ = app.emit("ke:reload-requested", ());
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        // R-4b-2：仅当「本次握手的代数仍是当前」时才兜底（旧的兜底线程放弃）。
        if RELOAD_GENERATION.load(Ordering::SeqCst) == generation {
            reload_main_window_now(&app_handle);
        }
    });
}

/// R-4 / R-4b-1：真正执行重载（前端回调与兜底线程都走这里）。
/// **严格 once-only**：`swap` 失败说明已经重载过（或正在重载）→ 直接返回，
/// 保证一次握手只重载一次，不给「第二次重载销毁窄窗内新输入」留口子。
pub fn reload_main_window_now(app: &AppHandle) {
    if RELOAD_DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.reload();
    }
}

/// SD-02（2026-10-17 审查）：退出握手进入「等待用户确认」时调用 —— 取消 1.5s
/// 兜底强退（**保留** `CLOSE_REQUESTED`，前端确认后二次 `close()` 仍能正常退出），
/// 把「用户还在读确认框」的窗口留出来。
#[tauri::command]
fn app_hold_exit() {
    CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// SD-02：用户在「有内容未保存成功，仍要退出？」里选择取消 → 撤销待定退出并恢复窗口。
#[tauri::command]
fn app_cancel_pending_exit(app: AppHandle) {
    cancel_pending_exit();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// SD-02：重新加载握手进入「等待用户确认」时调用 —— 取消兜底刷新，给确认留时间。
#[tauri::command]
fn app_cancel_pending_reload() {
    RELOAD_GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 2026-10-24 真机事故：WebView2 初始化偶发挂起会留下「无窗口僵尸进程」；启动即挂看门狗。
    #[cfg(target_os = "windows")]
    spawn_startup_watchdog();
    tauri::Builder::default()
        // P1-12：多实例互斥（需在 setup 之前注册）。第二实例启动时回调聚焦已有主窗口后退出。
        // A7：workshop 自定义协议（已安装包独立 origin；包文档自带 CSP）
        .register_uri_scheme_protocol("workshop", |ctx, request| {
            workshop_protocol::handle(ctx.app_handle(), request)
        })
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
        // T16：打印 renderer 就绪状态（命令 State 注入必需）
        .manage(print_snapshot::PrintRenderState::default())
        .setup(|app| {
            sidecar::start(app.handle().clone());
            // T16：env 门控的隐藏打印 renderer（默认不创建，不影响既有行为）
            if std::env::var("KE_WS_PRINT_RENDER").map(|v| v == "1").unwrap_or(false) {
                let result = print_snapshot::ensure_render_window(app.handle());
                // 可观测性：状态写入 app data（不依赖 stderr 控制台）
                if let Ok(dir) = app.path().app_data_dir() {
                    let _ = std::fs::create_dir_all(&dir);
                    let status = match &result {
                        Ok(()) => serde_json::json!({"ok": true}),
                        Err(e) => serde_json::json!({"ok": false, "error": e}),
                    };
                    let _ = std::fs::write(dir.join("print-render-status.json"), status.to_string());
                }
                if let Err(e) = result {
                    eprintln!("[ws] {e}");
                }
            }
            // UI 工坊 T20：启动时对已安装包执行 recover（清理半成品/损坏回退），
            // 结果写状态文件并广播（失败不阻断启动）。
            if let Ok(root) = pack_store::root_of(app.handle()) {
                let status = pack_store::recover_all(&root);
                let _ = pack_store::write_recover_status(&root, &status);
                let _ = app.handle().emit("workshop://recover-status", status);
            }
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
            pack_store::workshop_pack_scan,
            pack_store::workshop_pack_install,
            pack_store::workshop_pack_stage_zip,
            pack_store::workshop_pack_install_staged,
            pack_store::workshop_pack_abort_staged,
            pack_store::workshop_pack_list,
            pack_store::workshop_pack_read_asset,
            pack_store::workshop_pack_session_status,
            pack_store::workshop_pack_session_report,
            pack_store::workshop_pack_verify,
            pack_store::workshop_pack_activate,
            pack_store::workshop_pack_rollback,
            pack_store::workshop_pack_recover,
            pack_store::workshop_pack_recover_all,
            pack_store::workshop_pack_startup_status,
            pack_store::workshop_pack_uninstall,
            print_snapshot::print_snapshot_pdf,
            print_snapshot::print_snapshot_ready,
            print::export_pdf,
            print::preview_pdf,
            print::discard_preview_pdf,
            menu::reload_main_window,
            menu::app_request_exit,
            menu::app_request_reload,
            app_hold_exit,
            app_cancel_pending_exit,
            app_cancel_pending_reload,
            sidecar::get_runtime_info,
            settings::get_settings,
            settings::update_settings,
            settings::open_log_dir,
            settings::open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
