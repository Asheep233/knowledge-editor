// KnowledgeEditor Sidecar Manager（Phase 7 M1）
//
// 复用 start.ps1 四段式流程（环境检查 → 旧进程清理 → 启动 + health 握手 → 写记录），
// 在 Rust 端按同一顺序实现；退出清理沿用 stop.ps1 思路但**有界**（先通知、轮询最多 1.2s、超时按 PID 树强杀，见 GRACEFUL_WAIT）。
//
// 关键约定（phase7-plan.md 第 5 章）：
// - 握手唯一依据：GET /api/health 返回 status=ok（30s 超时，1s 间隔）
// - runtime.json schema 与 Web 版一致，落盘位置改为 %APPDATA%\KnowledgeEditor\runtime\runtime.json
// - 动态端口：默认 8000，被占则换下一个空闲端口，最多 3 次
// - 侧车运行中崩溃：自动拉起重试 health，≤3 次
use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 退出清理进行中标记：窗口关闭后不再自动拉起侧车。
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// M5（发布前全面审查修复）：**已 spawn 的 sidecar PID**（0 = 尚未拉起）。
///
/// 此前 PID 的唯一记录是 `SidecarState.info`，但它只在 health 握手（最长 30s）**成功之后**才写入；
/// 而子进程在 `.spawn()` 时就已经诞生。于是「握手期关窗」或「崩溃重启窗口关窗」时
/// `cleanup_on_exit` 拿不到 PID → 后端成为**永久孤儿**（占端口、持工作区句柄），
/// 且 runtime.json 已删 → `cleanup_stale` 永久失明。故 spawn 成功即刻登记于此。
static SPAWNED_PID: AtomicU32 = AtomicU32::new(0);

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
// v1.1.7 修复：退出清理必须**有界且快速**——主进程在同步清理后立即退出。
// force/tree 杀 + 1.2s 预算，既保证侧车随主进程消亡（不再孤儿占端口），
// 又不复现 v1.1.6 的「5s 轮询阻塞退出」假死。
const GRACEFUL_WAIT: Duration = Duration::from_millis(1200);
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

/// P1-12：判断指定 PID 是否为本项目 sidecar（命令行含 `knowledgeeditor-backend`）。
/// Windows 用 Get-CimInstance 读取 CommandLine，防止 PID 复用后误杀无关进程；
/// 非 Windows 平台无 taskkill 强杀语义，退化为「PID 存活即可」的原逻辑并在注释说明。
#[cfg(windows)]
fn is_backend_process(pid: u32) -> bool {
    let script = format!("(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\").CommandLine");
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match out {
        Ok(o) => {
            let cmd = String::from_utf8_lossy(&o.stdout).to_lowercase();
            cmd.contains("knowledgeeditor-backend")
        }
        Err(_) => false,
    }
}

/// R-3（独立验证发现）：**是否为本进程拉起的 sidecar**。
/// `is_backend_process` 只比对命令行 —— 多实例场景下别的 AstraNota 实例的后端命令行相同，
/// PID 复用后会被误判成"我们的"。故退出清理再加一层**父进程校验**（sidecar 由本进程 spawn）。
#[cfg(windows)]
fn is_our_backend_process(pid: u32) -> bool {
    let me = std::process::id();
    let script = format!(
        "$p=Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\"; if($p){{ \"$($p.CommandLine)|$($p.ParentProcessId)\" }}"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut parts = text.trim().rsplitn(2, '|');
            let parent = parts.next().and_then(|v| v.trim().parse::<u32>().ok());
            let cmd = parts.next().unwrap_or("").to_lowercase();
            cmd.contains("knowledgeeditor-backend") && parent == Some(me)
        }
        // PowerShell 不可用/失败 → 保守判否（宁可保守跳过强杀，也不误杀他人进程树）
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn is_our_backend_process(pid: u32) -> bool {
    is_backend_process(pid)
}

#[cfg(not(windows))]
fn is_backend_process(_pid: u32) -> bool {
    // 非 Windows：不读取进程命令行，退化为「存活即可」逻辑（无法用 taskkill /T 杀树）。
    true
}

/// 旧进程清理：扫描 runtime.json 中的 backend.pid，存活且命令行确为本项目 sidecar 时整树停止；
/// 命令行不匹配（PID 复用/已被替换）则只删记录、不杀进程。随后删除记录文件。
/// 端口兜底由 find_free_port 隐式完成（被占则换端口，不误杀无关服务）。
fn cleanup_stale() {
    if let Some(runtime) = read_runtime() {
        if let Some(pid) = runtime
            .get("backend")
            .and_then(|b| b.get("pid"))
            .and_then(|p| p.as_u64())
        {
            let pid = pid as u32;
            if is_alive(pid) {
                if is_backend_process(pid) {
                    kill_tree(pid);
                } else {
                    eprintln!(
                        "[sidecar] PID {pid} 存活但命令行不含 knowledgeeditor-backend，跳过强杀（仅清理 stale 记录）"
                    );
                }
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

/// 轮询 /api/health 直到 status=ok 且含 version 字段或超时。返回 health 响应体。
/// P3-13：校验响应体含 `version`（应用标识），避免「端口被巧合占用」时握手到一个无关服务。
fn wait_health(port: u16) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let mut last_err;
    loop {
        // M5：握手等待期间（最长 30s）若已进入退出流程 → 立即放弃，不再空等。
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return Err("应用正在退出，已取消 sidecar health 握手".into());
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_read(Duration::from_secs(2))
            .build();
        match agent.get(&url).call() {
            Ok(resp) => {
                match resp.into_string() {
                    Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(body) => {
                            let is_ke = body.get("status").and_then(|s| s.as_str()) == Some("ok")
                                && body.get("version").and_then(|v| v.as_str()).is_some();
                            if is_ke {
                                return Ok(body);
                            }
                            last_err = format!("health 响应缺少 KE 标识: {body}");
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

    // M5：进程已诞生 → 立刻登记 PID，使退出清理在 health 握手完成前也能找到它。
    let spawned_pid = child.pid();
    SPAWNED_PID.store(spawned_pid, Ordering::SeqCst);
    // M5：启动与退出赛跑 —— 若本进程已在退出流程中，立即清掉刚拉起的子进程，不留孤儿。
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        if is_our_backend_process(spawned_pid) {
            kill_tree(spawned_pid);
        }
        SPAWNED_PID.store(0, Ordering::SeqCst);
        return Err("应用正在退出，已取消 sidecar 启动".into());
    }

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
            // P2-19：健康检查失败时应整树停止（PyInstaller onefile 中 bootloader 会再拉起子进程，
            // 只杀 child 会留下孤儿进程），改按 PID 树 kill。
            let _ = kill_tree(child.pid());
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

/// 后台日志文件：%APPDATA%\KnowledgeEditor\logs\backend.log（P2-10 桌面 release 零日志）。
fn backend_log_path() -> PathBuf {
    data_dir().join("logs").join("backend.log")
}

/// 将侧车一行输出追加写盘（带时间戳，目录不存在则创建）。
/// 保留 eprintln 供控制台（dev / 排障），同时落盘保证 release 无控制台时也有日志。
fn log_backend(line: &str) {
    use std::io::Write;
    let path = backend_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{ts}] {line}");
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
                            log_backend(line);
                        }
                    }
                }
                CommandEvent::Error(e) => {
                    eprintln!("[sidecar] 事件错误: {e}");
                }
                CommandEvent::Terminated(payload) => {
                    // R-3：进程已终止 → 立刻清零登记 PID，避免残留 PID 被系统复用后误判。
                    SPAWNED_PID.store(0, Ordering::SeqCst);
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
                        // P2-19/P3-13：崩溃后原端口可能已被其他进程占用，重启前重新探测端口，
                        // 避免「固定旧端口」导致拉起即绑定失败。
                        let base = std::env::var("KE_PORT")
                            .ok()
                            .and_then(|p| p.parse::<u16>().ok())
                            .unwrap_or(DEFAULT_PORT);
                        let next_port = find_free_port(base, MAX_PORT_ATTEMPTS).unwrap_or(port);
                        std::thread::sleep(Duration::from_secs(1));
                        // M5：1s 重启等待期间可能已进入退出流程 → 不再拉起。
                        if SHUTTING_DOWN.load(Ordering::SeqCst) {
                            return;
                        }
                        match watch_sidecar(app_clone.clone(), next_port, restarts + 1) {
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

/// 退出清理：窗口关闭/退出握手的**第二阶段**调用（有界，绝不复现 5s 假死）。
///
/// 流程：置 `SHUTTING_DOWN` → 取 PID（**优先 `SPAWNED_PID`**，其次 `SidecarState.info`）→
/// 校验该 PID 确为本项目 backend（M6：防 PID 复用误杀无关进程树）→ 独立线程 `taskkill /F /T`
/// → 轮询最多 [`GRACEFUL_WAIT`]（1.2s，进程退出即提前结束）→ 仍存活则 PID 树强杀 → 删 runtime.json。
pub fn cleanup_on_exit(app: &AppHandle) {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    // M5：优先用 spawn 时登记的 PID（health 握手未完成时 info 尚不存在）。
    let registered = SPAWNED_PID.load(Ordering::SeqCst);
    let info_pid = app
        .try_state::<SidecarState>()
        .and_then(|state| state.info.lock().unwrap().clone())
        .map(|info| info.pid);
    let pid = if registered != 0 { Some(registered) } else { info_pid };
    if let Some(pid) = pid {
        // M6+R-3：强杀前校验「确实是我们这个进程拉起的 backend」（命令行 + 父进程）。
        // 不匹配时**保守处理**：不强杀、且**保留 runtime.json** —— 若它其实是孤儿后端，
        // 下次启动的 `cleanup_stale` 还能凭记录清掉；反之若删记录，就永久失明了
        // （独立验证指出这正是「校验失败 → 删记录 → 孤儿失明」的反向风险）。
        if !is_our_backend_process(pid) {
            eprintln!(
                "[sidecar] 退出清理：PID {pid} 未通过「本进程 sidecar」校验（已退出 / PID 被复用 / 查询失败），保守跳过强杀并保留 runtime.json 供下次启动清理"
            );
            return;
        }
        // 1) 通知后端优雅退出（uvicorn 自行收尾）。PyInstaller bootloader 不响应
        //    CTRL_CLOSE_EVENT 时 taskkill 会无限等待，因此放独立线程防阻塞。
        std::thread::spawn(move || {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        });
        // 2) 轮询等待（有界），进程退出即提前结束
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
