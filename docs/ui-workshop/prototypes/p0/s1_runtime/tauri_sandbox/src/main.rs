//! P0-S1 原型宿主：独立来源 sandbox iframe + MessagePort + 精确命令面 + Rust 启动恢复。
//!
//! 说明：这是**实验原型**，不是产品代码。用于在真实 Windows/WebView2 上验证：
//! 1) guest（sandbox allow-scripts 的独立来源 iframe）无法访问宿主 DOM/宿主 Tauri IPC；
//! 2) guest 对宿主后端 loopback 的读写请求受 CORS/来源校验约束（实测，不靠文本宣称）；
//! 3) 宿主持有唯一命令面（本原型只暴露 5 个命令），guest 不能调用；
//! 4) Rust 持有启动恢复：bootPending 计数 → 连续失败进入 safe mode（官方兜底），
//!    用户/宿主可从 safe mode 显式恢复；恢复动作不依赖 guest JS。
use std::env;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

mod pack_store_proto;
mod print_proto;

use tauri::{Manager, State};

#[derive(Clone)]
struct ProbeState {
    dir: PathBuf,
    backend_base: String,
    host_origin: String,
    bad_start: bool,
}

fn probe_dir() -> PathBuf {
    env::var("S1_PROBE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir().join("uiws-s1-probe"))
}

fn write_json(path: &PathBuf, v: &serde_json::Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(v).unwrap_or_default())
}

fn read_json(path: &PathBuf) -> Option<serde_json::Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn append_event(dir: &PathBuf, line: &str) {
    let path = dir.join("events.log");
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", line);
    }
}

#[tauri::command]
fn boot_state(state: State<ProbeState>) -> serde_json::Value {
    let boot_file = state.dir.join("bootPending.json");
    let fails_file = state.dir.join("boot-fails.json");
    let mut fails = read_json(&fails_file)
        .and_then(|v| v.get("fails").and_then(|x| x.as_u64()))
        .unwrap_or(0) as u32;
    let mut safe_mode = false;
    if boot_file.exists() {
        fails += 1;
        let _ = write_json(&fails_file, &serde_json::json!({ "fails": fails }));
        append_event(&state.dir, &format!("startup-with-bootPending fails={}", fails));
        if fails >= 2 {
            safe_mode = true;
            let _ = write_json(
                &state.dir.join("safe-mode.json"),
                &serde_json::json!({ "safeMode": true, "fails": fails, "at": "startup", "by": "rust" }),
            );
            append_event(&state.dir, "safe-mode-entered (rust controlled)");
        }
    } else {
        append_event(&state.dir, "startup-clean");
    }
    serde_json::json!({
        "safe_mode": safe_mode,
        "fails": fails,
        "backend_base": state.backend_base,
        "host_origin": state.host_origin,
        "bad_start": state.bad_start,
        "probe_dir": state.dir.display().to_string(),
        "scenario": env::var("S1_SCENARIO").unwrap_or_default(),
        "print_target": env::var("S1_PRINT_TARGET").unwrap_or_default(),
        "pack_root": env::var("S1_PACK_ROOT").unwrap_or_default(),
        "guest_iso_url": env::var("S1_GUEST_ISO_URL").unwrap_or_default(),
    })
}

#[tauri::command]
fn report_results(state: State<ProbeState>, results: String) -> Result<String, String> {
    let path = state.dir.join("results.json");
    let tmp = state.dir.join("results.json.tmp");
    fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
    fs::write(&tmp, &results).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn mark_healthy(state: State<ProbeState>) -> Result<(), String> {
    let _ = fs::remove_file(state.dir.join("bootPending.json"));
    let _ = fs::remove_file(state.dir.join("boot-fails.json"));
    append_event(&state.dir, "healthy (bootPending cleared)");
    Ok(())
}

#[tauri::command]
fn crash_now(state: State<ProbeState>) -> Result<(), String> {
    write_json(
        &state.dir.join("bootPending.json"),
        &serde_json::json!({ "reason": "bad-start-simulated", "at": "before-healthy" }),
    )
    .map_err(|e| e.to_string())?;
    append_event(&state.dir, "crash-now (bootPending written, exit 99)");
    std::process::exit(99);
}

#[tauri::command]
fn recover_to_official(state: State<ProbeState>) -> Result<String, String> {
    let _ = fs::remove_file(state.dir.join("bootPending.json"));
    let _ = fs::remove_file(state.dir.join("boot-fails.json"));
    write_json(
        &state.dir.join("recovered.json"),
        &serde_json::json!({ "by": "rust-safe-mode", "to": "official", "at": "user-request" }),
    )
    .map_err(|e| e.to_string())?;
    append_event(&state.dir, "recovered-to-official");
    Ok("recovered".to_string())
}

#[tauri::command]
fn guest_write_probe(state: State<ProbeState>, payload: String) -> Result<String, String> {
    // 仅写入本次探针的临时目录；用于验证 guest 是否能真正调用宿主命令面。
    let path = state.dir.join("guest-call.json");
    fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
    fs::write(&path, payload).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}


/// 返回当前调用方 webview 的 label（证明 app 命令对任意 webview 可见）。
#[tauri::command]
fn whoami(webview: tauri::Webview) -> String {
    webview.label().to_string()
}

/// **故意不加守卫**的写命令：用于证明 Tauri app 命令默认对所有 webview 可见。
#[tauri::command]
fn unguarded_guest_write(state: State<ProbeState>, payload: String) -> Result<String, String> {
    let path = state.dir.join("guest-unguarded-write.json");
    fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
    fs::write(&path, payload).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// 受守卫命令原型：只允许主窗口调用，其余 webview 明确拒绝（按 webview label 绑定）。
#[tauri::command]
fn sensitive_probe(webview: tauri::Webview) -> Result<String, String> {
    if webview.label() != "main" {
        return Err(format!("E_FORBIDDEN_WEBVIEW:{}", webview.label()));
    }
    Ok("sensitive-ok".to_string())
}

/// 记录 guest 自报告（same-origin guest 可调；custom-origin guest 因 IPC 被拒而无法调用）。
#[tauri::command]
fn report_guest_result(state: State<ProbeState>, payload: String) -> Result<String, String> {
    let path = state.dir.join("guest-report-same.json");
    fs::create_dir_all(&state.dir).map_err(|e| e.to_string())?;
    fs::write(&path, payload).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// 打开两个 guest WebviewWindow 做对照实验：
/// - guest-same-origin：同 custom protocol 来源（http://tauri.localhost）→ 应能调用 app 命令/访问后端
/// - guest-custom-origin：独立 custom protocol 来源（uiwsguest://）→ IPC/后端应被拒
#[tauri::command]
fn debug_log(state: State<ProbeState>, marker: String) -> Result<(), String> {
    append_event(&state.dir, &format!("host-js: {}", marker));
    Ok(())
}

#[tauri::command]
fn exit_probe(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let dir = probe_dir();
    let _ = fs::create_dir_all(&dir);
    let state = ProbeState {
        dir: dir.clone(),
        backend_base: env::var("S1_BACKEND_BASE").unwrap_or_default(),
        host_origin: env::var("S1_HOST_ORIGIN").unwrap_or_default(),
        bad_start: env::var("S1_BAD_START").map(|v| v == "1").unwrap_or(false),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let dir = probe_dir();
            let _ = fs::create_dir_all(&dir);
            append_event(&dir, "second-instance-detected");
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .manage(state)
        .setup(|app| {
            if env::var("S1_OPEN_GUESTS").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(
                    app,
                    "guest-same-origin",
                    WebviewUrl::App("guest-same.html".into()),
                )
                .title("guest-same-origin")
                .inner_size(520.0, 420.0)
                .build()
                {
                    Ok(_) => append_event(&dir, "guest-same-origin opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("guest-same-origin build error: {e}")),
                }
                if let Ok(url) = env::var("S1_GUEST_ISO_URL") {
                    match url.parse() {
                        Ok(parsed) => match WebviewWindowBuilder::new(
                            app,
                            "guest-custom-origin",
                            WebviewUrl::External(parsed),
                        )
                        .title("guest-custom-origin")
                        .inner_size(520.0, 420.0)
                        .build()
                        {
                            Ok(_) => append_event(&dir, "guest-custom-origin opened by rust setup"),
                            Err(e) => append_event(&dir, &format!("guest-custom-origin build error: {e}")),
                        },
                        Err(e) => append_event(&dir, &format!("guest iso url parse error: {e}")),
                    }
                }
            }
            if env::var("S1_OPEN_PACK").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(app, "pack-render", WebviewUrl::App("pack.html".into()))
                    .title("T21 native pack store probe")
                    .inner_size(900.0, 700.0)
                    .build()
                {
                    Ok(_) => append_event(&dir, "pack-render opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("pack-render build error: {e}")),
                }
            }
            if env::var("S1_OPEN_BROKER").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(app, "broker-render", WebviewUrl::App("broker.html".into()))
                    .title("T18 broker malicious guest probe")
                    .inner_size(900.0, 700.0)
                    .build()
                {
                    Ok(_) => append_event(&dir, "broker-render opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("broker-render build error: {e}")),
                }
            }
            if env::var("S1_OPEN_PROTOCOL").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(app, "protocol-render", WebviewUrl::App("protocol.html".into()))
                    .title("T11 protocol transport probe")
                    .inner_size(900.0, 700.0)
                    .build()
                {
                    Ok(_) => append_event(&dir, "protocol-render opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("protocol-render build error: {e}")),
                }
            }
            if env::var("S1_OPEN_PRINT").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(app, "print-render", WebviewUrl::App("print.html".into()))
                    .title("S4 print renderer")
                    .inner_size(820.0, 1100.0)
                    .build()
                {
                    Ok(_) => append_event(&dir, "print-render opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("print-render build error: {e}")),
                }
            }
            if env::var("S1_OPEN_S2").map(|v| v == "1").unwrap_or(false) {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                match WebviewWindowBuilder::new(app, "s2-shell", WebviewUrl::App("s2.html".into()))
                    .title("S2 persistent editor")
                    .inner_size(900.0, 700.0)
                    .build()
                {
                    Ok(_) => append_event(&dir, "s2-shell opened by rust setup"),
                    Err(e) => append_event(&dir, &format!("s2-shell build error: {e}")),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            boot_state,
            report_results,
            mark_healthy,
            crash_now,
            recover_to_official,
            guest_write_probe,
            whoami,
            unguarded_guest_write,
            sensitive_probe,
            report_guest_result,
            debug_log,
            print_proto::print_window_pdf,
            pack_store_proto::pack_install,
            pack_store_proto::pack_state,
            pack_store_proto::pack_verify,
            pack_store_proto::pack_activate,
            pack_store_proto::pack_rollback,
            pack_store_proto::pack_recover,
            pack_store_proto::pack_corrupt,
            exit_probe
        ])
        .build(tauri::generate_context!())
        .expect("error while building uiws s1 probe")
        .run(|_app, event| match event {
            tauri::RunEvent::ExitRequested { .. } => {
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                append_event(&dir, "exit-requested");
                let _ = fs::write(dir.join("exit-requested.json"), "{\"ok\":true}");
            }
            tauri::RunEvent::Exit => {
                let dir = probe_dir();
                let _ = fs::create_dir_all(&dir);
                let _ = fs::write(dir.join("exit.json"), "{\"ok\":true}");
            }
            _ => {}
        });
}
