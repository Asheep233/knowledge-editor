// KnowledgeEditor Sidecar Manager（Phase 7 M1）
//
// 复用 start.ps1 四段式流程（环境检查 → 旧进程清理 → 启动 + health 握手 → 写记录），
// 在 Rust 端按同一顺序实现；退出清理沿用 stop.ps1 思路（先通知、再等 5s、超时按 PID 树强杀）。
//
// 关键约定（phase7-plan.md 第 5 章）：
// - 握手唯一依据：GET /api/health 返回 status=ok（30s 超时，1s 间隔）
// - runtime.json schema 与 Web 版一致，落盘位置改为 %APPDATA%\KnowledgeEditor\runtime\runtime.json
// - 动态端口：默认 8000，被占则换下一个空闲端口，最多 3 次
// - 侧车运行中崩溃：自动拉起重试 health，≤3 次
use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 退出清理进行中标记：窗口关闭后不再自动拉起侧车。
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SIDECAR_NAME: &str = "knowledgeeditor-backend";
const DEFAULT_PORT: u16 = 8000;
const MAX_PORT_ATTEMPTS: u32 = 3;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_INTERVAL: Duration = Duration::from_secs(1);
const GRACEFUL_WAIT: Duration = Duration::from_secs(5);
const MAX_CRASH_RESTARTS: u32 = 3;

/// 供 get_runtime_info 命令（M2 前端基址注入）与状态管理的运行时信息。
#[derive(Clone, Serialize)]
pub struct RuntimeInfo {
    pub api_base: String,
    pub workspace: String,
    pub version: String,
    pub pid: u32,
    pub port: u16,
}

#[derive(Default)]
pub struct SidecarState {
    pub info: Mutex<Option<RuntimeInfo>>,
}

/// 应用数据目录：%APPDATA%\KnowledgeEditor（规划第 10 章，D5 一致）。
pub(crate) fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("KnowledgeEditor")
}

fn runtime_dir() -> PathBuf {
    data_dir().join("runtime")
}

fn runtime_file() -> PathBuf {
    runtime_dir().join("runtime.json")
}

fn default_workspace() -> PathBuf {
    data_dir().join("workspace")
}

/// 找到从 start 起的空闲端口（尝试 bind 127.0.0.1:port，成功即空闲）。
fn find_free_port(start: u16, max_attempts: u32) -> Option<u16> {
    for offset in 0..max_attempts {
        let port = start + offset as u16;
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// 按 PID 整树强杀（taskkill /T /F）。
fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// 读取 runtime.json（存在且合法时返回）。
fn read_runtime() -> Option<serde_json::Value> {
    let path = runtime_file();
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 进程是否存活（tasklist 按 PID 过滤匹配）。
fn is_alive(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid)])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

/// 旧进程清理：扫描 runtime.json 中的 backend.pid，存活则整树停止；随后删除记录文件。
/// 端口兜底由 find_free_port 隐式完成（被占则换端口，不误杀无关服务）。
fn cleanup_stale() {
    if let Some(runtime) = read_runtime() {
        if let Some(pid) = runtime
            .get("backend")
            .and_then(|b| b.get("pid"))
            .and_then(|p| p.as_u64())
        {
            if is_alive(pid as u32) {
                kill_tree(pid as u32);
            }
        }
    }
    let _ = std::fs::remove_file(runtime_file());
}

/// 写 runtime.json（schema 与 start.ps1 一致；桌面版无独立前端进程，frontend 置 null）。
fn write_runtime(pid: u32, port: u16, started_at: &str, version: &str) {
    let json = serde_json::json!({
        "backend": {
            "pid": pid,
            "port": port,
            "started_at": started_at,
            "version": version
        },
        "frontend": null,
        "project_version": version,
        "started_at": started_at
    });
    if let Err(e) = std::fs::create_dir_all(runtime_dir()) {
        eprintln!("[sidecar] 创建 runtime 目录失败: {e}");
        return;
    }
    if let Ok(content) = serde_json::to_string_pretty(&json) {
        let _ = std::fs::write(runtime_file(), content);
    }
}

/// 轮询 /api/health 直到 status=ok 或超时。返回 health 响应体（含 version/started_at）。
fn wait_health(port: u16) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let mut last_err;
    loop {
        let agent = ureq::AgentBuilder::new()
            .timeout_read(Duration::from_secs(2))
            .build();
        match agent.get(&url).call() {
            Ok(resp) => {
                match resp.into_string() {
                    Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(body) => {
                            if body.get("status").and_then(|s| s.as_str()) == Some("ok") {
                                return Ok(body);
                            }
                            last_err = format!("health status != ok: {body}");
                        }
                        Err(_) => last_err = "health 响应不是合法 JSON".into(),
                    },
                    Err(e) => last_err = format!("health 读取失败: {e}"),
                }
            }
            Err(e) => last_err = format!("health 请求失败: {e}"),
        }
        if Instant::now() >= deadline {
            return Err(last_err);
        }
        std::thread::sleep(HEALTH_INTERVAL);
    }
}

/// 启动 sidecar 并完成 health 握手 + 写记录。返回 (child, rx, info)。
/// 事件（stderr/stdout/terminated）与崩溃自动拉起由 watch_sidecar 统一管理。
fn spawn_sidecar(
    app: &AppHandle,
    port: u16,
) -> Result<(CommandChild, tauri::async_runtime::Receiver<CommandEvent>, RuntimeInfo), String> {
    let workspace = std::env::var("KE_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_workspace());
    if let Err(e) = std::fs::create_dir_all(&workspace) {
        return Err(format!("创建 workspace 失败: {e}"));
    }
    // M4：软件级配置（跨 workspace 最近列表等）落在应用数据目录，
    // 注入 KE_APP_CONFIG 供后端 AppConfig 使用；后端首次启动会把旧 Web 版
    // 位置（~/.knowledgeeditor/app_config.json）并入此处（见 app_config.py）。
    let app_config = data_dir().join("app_config.json");
    if let Err(e) = std::fs::create_dir_all(&data_dir()) {
        return Err(format!("创建应用数据目录失败: {e}"));
    }

    // 桌面 release 的 WebView origin 为 tauri.localhost；dev 模式（debug 构建）追加 Vite 开发
    // 服务器 origin（端口取 KE_DEV_FRONTEND_PORT，缺省 5173，与 tauri.conf.json devUrl 一致）。
    let mut cors = vec![
        "http://tauri.localhost".to_string(),
        "https://tauri.localhost".to_string(),
    ];
    if let Ok(existing) = std::env::var("KE_CORS_ORIGINS") {
        for item in existing.split(',') {
            let item = item.trim().to_string();
            if !item.is_empty() && !cors.contains(&item) {
                cors.push(item);
            }
        }
    }
    if cfg!(debug_assertions) {
        let dev_port = std::env::var("KE_DEV_FRONTEND_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(5173);
        cors.push(format!("http://127.0.0.1:{dev_port}"));
        cors.push(format!("http://localhost:{dev_port}"));
    }

    let sidecar = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("加载 sidecar 失败: {e}"))?;
    let (mut rx, child) = sidecar
        .env("KE_HOST", "127.0.0.1")
        .env("KE_PORT", port.to_string())
        .env("KE_WORKSPACE", workspace.to_string_lossy().to_string())
        .env("KE_APP_CONFIG", app_config.to_string_lossy().to_string())
        .env("KE_CORS_ORIGINS", cors.join(","))
        .spawn()
        .map_err(|e| format!("spawn sidecar 失败: {e}"))?;

    match wait_health(port) {
        Ok(health) => {
            let version = health
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let started_at = health
                .get("started_at")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let pid = child.pid();
            write_runtime(pid, port, &started_at, &version);
            let info = RuntimeInfo {
                api_base: format!("http://127.0.0.1:{port}"),
                workspace: workspace.to_string_lossy().to_string(),
                version,
                pid,
                port,
            };
            Ok((child, rx, info))
        }
        Err(_) => {
            let _ = child.kill();
            // 读取 stderr 后 30 行用于诊断（事件循环刚启动，直接从 rx 短暂读取）
            let mut stderr_lines = Vec::new();
            while let Ok(event) = rx.try_recv() {
                if let CommandEvent::Stderr(bytes) = event {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        stderr_lines.push(line.to_string());
                    }
                }
            }
            let tail: Vec<String> = stderr_lines.into_iter().rev().take(30).collect();
            Err(format!(
                "侧车启动后 health 未就绪（30s 超时）。stderr 尾部: {}",
                tail.join(" | ")
            ))
        }
    }
}

/// 监听 sidecar 事件并透传日志；进程异常退出时自动拉起并重试 health，
/// 最多 MAX_CRASH_RESTARTS 次（规划第 5 章异常处理表）。返回 Err 表示本次启动失败。
fn watch_sidecar(app: AppHandle, port: u16, restarts: u32) -> Result<(), String> {
    let (_child, mut rx, info) = spawn_sidecar(&app, port)?;
    if let Some(state) = app.try_state::<SidecarState>() {
        *state.info.lock().unwrap() = Some(info.clone());
    }
    let _ = app.emit("ke:runtime-ready", &info);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        while let Some(event) = tauri::async_runtime::block_on(rx.recv()) {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if !line.trim().is_empty() {
                            eprintln!("[sidecar] {line}");
                        }
                    }
                }
                CommandEvent::Error(e) => {
                    eprintln!("[sidecar] 事件错误: {e}");
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_clone.emit(
                        "ke:sidecar-exited",
                        serde_json::json!({
                            "code": payload.code,
                            "signal": payload.signal,
                        }),
                    );
                    if SHUTTING_DOWN.load(Ordering::SeqCst) {
                        return;
                    }
                    if restarts < MAX_CRASH_RESTARTS {
                        eprintln!(
                            "[sidecar] 进程异常退出（code={:?} signal={:?}），1s 后自动拉起（第 {}/{} 次）",
                            payload.code, payload.signal, restarts + 1, MAX_CRASH_RESTARTS
                        );
                        std::thread::sleep(Duration::from_secs(1));
                        match watch_sidecar(app_clone.clone(), port, restarts + 1) {
                            Ok(()) => {}
                            Err(e) => {
                                eprintln!("[sidecar] 自动拉起失败: {e}");
                                let _ = app_clone.emit(
                                    "ke:runtime-error",
                                    serde_json::json!({ "message": e }),
                                );
                            }
                        }
                        return;
                    }
                    eprintln!("[sidecar] 崩溃重启次数耗尽（{MAX_CRASH_RESTARTS} 次），不再自动拉起");
                    let _ = app_clone.emit(
                        "ke:runtime-error",
                        serde_json::json!({ "message": "侧车崩溃且自动重启次数已耗尽" }),
                    );
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// 前台入口：由 setup 调用，在后台线程执行完整启动流程。
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        cleanup_stale();

        // 动态端口：默认 8000，被占则换端口，最多 3 次
        let base = std::env::var("KE_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        let mut last_err = String::from("未找到空闲端口");
        for attempt in 0..MAX_PORT_ATTEMPTS {
            let Some(port) = find_free_port(base + attempt as u16, 1) else {
                last_err = format!("端口 {base} 被占用且无可重试端口");
                continue;
            };
            match watch_sidecar(app.clone(), port, 0) {
                Ok(()) => return,
                Err(e) => {
                    eprintln!("[sidecar] 第 {} 次尝试失败: {e}", attempt + 1);
                    last_err = e;
                }
            }
        }
        let _ = app.emit("ke:runtime-error", serde_json::json!({ "message": last_err }));
    });
}

/// 退出清理：窗口关闭时调用。先通知后端优雅退出（独立线程，防止 taskkill 挂起阻塞窗口关闭），
/// 轮询等待最多 5s（进程退出即提前结束），超时按 PID 树强杀；最后删 runtime.json。
pub fn cleanup_on_exit(app: &AppHandle) {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Some(info) = state.info.lock().unwrap().clone() {
            // 1) 通知后端优雅退出（uvicorn 自行收尾）。PyInstaller bootloader 不响应
            //    CTRL_CLOSE_EVENT 时 taskkill 会无限等待，因此放独立线程防阻塞。
            let pid = info.pid;
            std::thread::spawn(move || {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            });
            // 2) 轮询等待最多 5s，进程退出即提前结束
            let deadline = Instant::now() + GRACEFUL_WAIT;
            while Instant::now() < deadline {
                if !is_alive(pid) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            // 3) 超时仍存活 → 按 PID 树强杀
            if is_alive(pid) {
                kill_tree(pid);
            }
        }
    }
    let _ = std::fs::remove_file(runtime_file());
}

/// 供前端获取运行时信息（M2 接入前端基址注入）。
#[tauri::command]
pub fn get_runtime_info(state: State<'_, SidecarState>) -> Result<RuntimeInfo, String> {
    state
        .info
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "后端尚未就绪".into())
}
