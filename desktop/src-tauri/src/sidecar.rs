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
use std::path::{Path, PathBuf};
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

// ---------------- W07 A2-10：spawn registry（早期强杀 → 孤儿 sidecar 启动自愈） ----------------

/// spawn 成功**立即**登记的文件（此时 runtime.json 尚未写；早期强杀后下次启动靠它发现孤儿）。
fn spawn_registry_file() -> PathBuf {
    runtime_dir().join("sidecar-spawn.json")
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// spawn registry 载荷（可单测：时间戳由调用方注入，避免测试时钟依赖）。
fn spawn_registry_payload(pid: u32, port: u16, app_pid: u32, spawned_at_ms: u128) -> serde_json::Value {
    serde_json::json!({
        "pid": pid,
        "port": port,
        "appPid": app_pid,
        "spawnedAtMs": spawned_at_ms as u64,
    })
}

fn write_spawn_registry_at(path: &Path, value: &serde_json::Value) -> bool {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(value) {
        Ok(text) => std::fs::write(path, text).is_ok(),
        Err(_) => false,
    }
}

fn read_spawn_registry_at(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()
}

fn remove_spawn_registry_at(path: &Path) -> bool {
    std::fs::remove_file(path).is_ok()
}

/// 生产：spawn 成功即刻写 registry（供下次启动发现「runtime.json 未写出的孤儿」）。
/// 若 registry 属于**另一个仍存活的实例**（多实例共享 data_dir 的极端情况）→ 不覆盖。
fn write_spawn_registry(pid: u32, port: u16) {
    let path = spawn_registry_file();
    if let Some(existing) = read_spawn_registry_at(&path) {
        if let Some(other_app) = existing.get("appPid").and_then(|v| v.as_u64()).map(|p| p as u32) {
            if other_app != std::process::id() && is_alive(other_app) {
                eprintln!("[sidecar] W07 A2-10: 另一实例仍存活，跳过 spawn registry 覆盖（避免破坏其孤儿自愈线索）");
                return;
            }
        }
    }
    let payload = spawn_registry_payload(pid, port, std::process::id(), now_ms());
    let _ = write_spawn_registry_at(&path, &payload);
}

fn remove_spawn_registry() {
    let _ = remove_spawn_registry_at(&spawn_registry_file());
}

/// 孤儿判定结果（可单测的纯决策）。
#[derive(Debug, Clone, PartialEq, Eq)]
enum OrphanDecision {
    /// 确认是本项目上次启动遗留的孤儿 → 整树停止
    Kill { pid: u32 },
    /// 有记录但校验不通过 → **保守跳过**（不误杀用户实例/无关进程）；
    /// keep_registry=true 表示 registry 属于另一个仍存活的实例，**不得删除/覆盖**。
    Skip { pid: u32, reason: String, keep_registry: bool },
    /// 记录对不上/进程已死 → 仅清理 registry
    None,
}

/// 保守孤儿判定：只有同时满足
/// ① registry 记录的 pid 仍存活；② 命令行确为本项目 sidecar（is_backend）；
/// ③ 其父进程 == registry 的 appPid（即由**上次那个应用实例**直接 spawn）；
/// ④ 该 appPid 已死（上次实例确实异常退出，不是另一个仍在运行的实例）
/// 才判定为可整树停止的孤儿。任一不满足 → Skip/None（宁可留孤儿也不误杀）。
fn decide_orphan<A, B, P>(registry: &serde_json::Value, alive: A, is_backend: B, parent_of: P) -> OrphanDecision
where
    A: Fn(u32) -> bool,
    B: Fn(u32) -> bool,
    P: Fn(u32) -> Option<u32>,
{
    let pid = registry
        .get("pid")
        .and_then(|v| v.as_u64())
        .filter(|p| *p > 0 && *p <= u32::MAX as u64)
        .map(|p| p as u32);
    let Some(pid) = pid else {
        return OrphanDecision::None;
    };
    if !alive(pid) {
        return OrphanDecision::None;
    }
    if !is_backend(pid) {
        return OrphanDecision::Skip { pid, reason: "命令行不是本项目 sidecar".into(), keep_registry: false };
    }
    let Some(app_pid) = registry.get("appPid").and_then(|v| v.as_u64()).map(|p| p as u32) else {
        return OrphanDecision::Skip { pid, reason: "registry 缺少 appPid（旧格式）".into(), keep_registry: false };
    };
    if alive(app_pid) {
        return OrphanDecision::Skip {
            pid,
            reason: "上次应用进程仍存活（可能是另一实例），不误杀".into(),
            keep_registry: true,
        };
    }
    match parent_of(pid) {
        Some(parent) if parent == app_pid => OrphanDecision::Kill { pid },
        Some(parent) => OrphanDecision::Skip {
            pid,
            reason: format!("父进程 {parent} 与 registry appPid {app_pid} 不符"),
            keep_registry: false,
        },
        None => OrphanDecision::Skip { pid, reason: "无法读取父进程，保守跳过".into(), keep_registry: false },
    }
}

/// 读取 spawn registry 并处理上次遗留的孤儿（启动清理阶段调用）。
fn clean_orphan_from_registry() {
    let path = spawn_registry_file();
    let Some(registry) = read_spawn_registry_at(&path) else {
        return;
    };
    // 防御：registry 里 pid 不能是当前进程/当前进程刚 spawn 的新 sidecar（正常路径下 registry 在 spawn 时
    // 刚被覆盖，这里读到的是上次遗留；若 pid == 当前 sidecar 则说明是新格式写入后同一进程重启场景）。
    match decide_orphan(&registry, is_alive, is_backend_process, process_parent_pid) {
        OrphanDecision::Kill { pid } => {
            eprintln!("[sidecar] W07 A2-10: 发现上次启动遗留的孤儿 sidecar（pid={pid}），整树停止以释放端口");
            kill_tree(pid);
        }
        OrphanDecision::Skip { pid, reason, keep_registry } => {
            eprintln!("[sidecar] W07 A2-10: spawn registry pid={pid} 校验未通过（{reason}），保守跳过（不误杀）");
            if keep_registry {
                // registry 属于另一个仍存活的实例 → 既不能杀也不能删/覆盖
                return;
            }
        }
        OrphanDecision::None => {}
    }
    let _ = remove_spawn_registry_at(&path);
}

/// 读取指定 PID 的父进程 PID（Windows PowerShell/WMI；失败 → None = 保守跳过）。
#[cfg(windows)]
fn process_parent_pid(pid: u32) -> Option<u32> {
    let script = format!("(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\").ParentProcessId");
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse::<u32>().ok()
}

#[cfg(not(windows))]
fn process_parent_pid(_pid: u32) -> Option<u32> {
    // 非 Windows 没有 taskkill /T 语义；读不到父进程 → 保守跳过（不误杀）。
    None
}

fn default_workspace() -> PathBuf {
    data_dir().join("workspace")
}

// ---------------- W07 B-8：运行时状态清理（崩溃/终态不再对外提供已死 pid） ----------------

/// 崩溃后是否还应自动重启（restarts = 已重启次数）。
fn should_restart(restarts: u32) -> bool {
    restarts < MAX_CRASH_RESTARTS
}

/// B-8：清空 `SidecarState.info`（可单测；返回是否清理了一个已记录的运行时信息）。
fn clear_runtime_info(info: &Mutex<Option<RuntimeInfo>>) -> bool {
    match info.lock() {
        Ok(mut guard) => guard.take().is_some(),
        // 锁中毒（持有线程 panic）时仍尽力清空：运行时信息本身无跨线程不变量。
        Err(poisoned) => poisoned.into_inner().take().is_some(),
    }
}

/// B-8：删除指定 `runtime.json`（可单测；返回是否真的删除了文件）。
fn remove_runtime_file_at(path: &Path) -> bool {
    std::fs::remove_file(path).is_ok()
}

/// B-8：崩溃/终态清理（可单测）—— 清空已死运行时信息 + 删除 stale `runtime.json`。
/// 返回值表示 info 是否被清空；文件删除失败不视为致命（仅诊断文件）。
fn clear_stale_runtime(info: &Mutex<Option<RuntimeInfo>>, runtime_path: &Path) -> bool {
    let cleared = clear_runtime_info(info);
    let _ = remove_runtime_file_at(runtime_path);
    cleared
}

/// B-8 生产入口：sidecar 进程退出后立即清理当前应用的运行时状态，`get_runtime_info`
/// 不再返回已死 pid；自动重启成功后由 `watch_sidecar` 写入新的 info/runtime.json。
fn clear_runtime_state(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        clear_stale_runtime(&state.info, &runtime_file());
    } else {
        let _ = remove_runtime_file_at(&runtime_file());
    }
}

/// B-4：`ke:sidecar-exited` 事件载荷（additive 字段：restarting/attempt/maxRestarts，
/// 供前端区分「自动恢复中」与「已降级」；旧消费者忽略未知字段即可）。
fn sidecar_exited_payload(
    code: Option<i32>,
    signal: Option<i32>,
    restarting: bool,
    attempt: u32,
) -> serde_json::Value {
    serde_json::json!({
        "code": code,
        "signal": signal,
        "restarting": restarting,
        "attempt": attempt,
        "maxRestarts": MAX_CRASH_RESTARTS,
    })
}

/// B-4：`ke:runtime-error` 事件载荷（terminal=true 表示不再自动恢复，UI 应提示降级）。
fn runtime_error_payload(message: &str, terminal: bool, attempt: Option<u32>) -> serde_json::Value {
    let mut value = serde_json::json!({
        "message": message,
        "terminal": terminal,
        "maxRestarts": MAX_CRASH_RESTARTS,
    });
    if let Some(attempt) = attempt {
        value["attempt"] = serde_json::json!(attempt);
    }
    value
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
    // W07 A2-10：先处理 spawn registry（覆盖「早期强杀时 runtime.json 尚未写出」的孤儿窗口）；
    // 再做原有 runtime.json 清理（两者互相独立、均保守校验命令行/父进程）。
    clean_orphan_from_registry();
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

/// 组装注入后端的 `KE_CORS_ORIGINS` 白名单（SEC-6 / 2026-10-02 独立审查）。
///
/// 审查事实：此前 `KE_CORS_ORIGINS` 被**无条件**并入白名单 → 任何能设置该环境变量的
/// 手段都能把 `https://evil.example` 加进后端 CORS 白名单（叠加「本机 API 无来源校验」被放大）。
///
/// 现在：
/// - `dev == false`（release）：**完全忽略环境变量**，只返回硬编码的 tauri.localhost；
/// - `dev == true`（debug）：采纳 `KE_CORS_ORIGINS`，并额外追加 dev 前端端口的
///   127.0.0.1 / localhost 两种写法（端口取 `KE_DEV_FRONTEND_PORT`，缺省 5173，
///   与 tauri.conf.json devUrl 一致）。
///
/// 参数显式传入（而非内部读 env / `cfg!`）以便单测覆盖两种构建模式。
fn build_cors_origins(dev: bool, env_cors: Option<String>, env_dev_port: Option<String>) -> Vec<String> {
    let mut cors = vec![
        "http://tauri.localhost".to_string(),
        "https://tauri.localhost".to_string(),
    ];
    if !dev {
        return cors;
    }
    if let Some(existing) = env_cors {
        for item in existing.split(',') {
            let item = item.trim().to_string();
            if !item.is_empty() && !cors.contains(&item) {
                cors.push(item);
            }
        }
    }
    let dev_port = env_dev_port
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(5173);
    for origin in [
        format!("http://127.0.0.1:{dev_port}"),
        format!("http://localhost:{dev_port}"),
    ] {
        if !cors.contains(&origin) {
            cors.push(origin);
        }
    }
    cors
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

    let cors = build_cors_origins(
        cfg!(debug_assertions),
        std::env::var("KE_CORS_ORIGINS").ok(),
        std::env::var("KE_DEV_FRONTEND_PORT").ok(),
    );

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
    // W07 A2-10：同步写 spawn registry（runtime.json 要等 health 成功，早期强杀窗口靠它留痕）。
    write_spawn_registry(spawned_pid, port);
    // M5：启动与退出赛跑 —— 若本进程已在退出流程中，立即清掉刚拉起的子进程，不留孤儿。
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        if is_our_backend_process(spawned_pid) {
            kill_tree(spawned_pid);
        }
        SPAWNED_PID.store(0, Ordering::SeqCst);
        remove_spawn_registry();
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
            // R-3 补：健康握手失败已整树杀掉 → 清零登记 PID（与 :336/:435 对齐，
            // 避免三次启动全失败后残留一个已死 PID）。
            SPAWNED_PID.store(0, Ordering::SeqCst);
            // W07 A2-10：健康握手失败已整树杀掉 → 清理 spawn registry（无存活 sidecar）。
            remove_spawn_registry();
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
                    // W07 B-8：进程已死 → 立刻清空 SidecarState.info 并删除 stale runtime.json
                    //（get_runtime_info 不再返回已死 pid；自动重启成功后重新写入新记录）。
                    clear_runtime_state(&app_clone);
                    // W07 A2-10：进程已死 → 删除 spawn registry；若自动拉起，新 spawn 会重新写。
                    remove_spawn_registry();
                    let shutting_down = SHUTTING_DOWN.load(Ordering::SeqCst);
                    let will_restart = !shutting_down && should_restart(restarts);
                    // W07 B-4：载荷区分「自动恢复中」与「显式停机」，供前端 banner 分级。
                    let _ = app_clone.emit(
                        "ke:sidecar-exited",
                        sidecar_exited_payload(
                            payload.code,
                            payload.signal,
                            will_restart,
                            if will_restart { restarts + 1 } else { restarts },
                        ),
                    );
                    if shutting_down {
                        return;
                    }
                    if will_restart {
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
                                // W07 B-8：重启失败 = 终态（不会再产生新 info）→ 确保运行时状态已清空。
                                clear_runtime_state(&app_clone);
                                let _ = app_clone.emit(
                                    "ke:runtime-error",
                                    runtime_error_payload(&e, true, Some(restarts + 1)),
                                );
                            }
                        }
                        return;
                    }
                    eprintln!("[sidecar] 崩溃重启次数耗尽（{MAX_CRASH_RESTARTS} 次），不再自动拉起");
                    // W07 B-8：终态清理（幂等：退出瞬间已清空，这里保证「耗尽后」仍无 stale 运行时状态）。
                    clear_runtime_state(&app_clone);
                    let _ = app_clone.emit(
                        "ke:runtime-error",
                        runtime_error_payload("侧车崩溃且自动重启次数已耗尽", true, Some(restarts)),
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
        // W07 B3-4：后端读取 app_config 之前先修复损坏 JSON（备份 + 写回默认），
        // 避免后端「静默回退默认」而用户旧配置既没备份也没提示。
        let _ = crate::settings::repair_corrupt_state_files();
        cleanup_stale();

        // 动态端口：默认 8000，被占则换端口，最多 3 次
        let base = std::env::var("KE_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        // W07 B1-4：启动失败必须**可观测** —— 每次尝试写结构化 eprintln（release 也会进日志/父进程
        // stderr），最终失败 emit `ke:runtime-error {message, terminal:true}`（前端 RuntimeHealthBanner
        // 显示真实原因，而不是 30s 后仅剩通用「后端未连接」横幅）。
        let mut last_err = String::from("E_SIDECAR_START: 未找到空闲端口");
        for attempt in 0..MAX_PORT_ATTEMPTS {
            let Some(port) = find_free_port(base + attempt as u16, 1) else {
                last_err = format!(
                    "E_SIDECAR_PORT: 端口 {base} 被占用且后续端口不可用（尝试 {}/{MAX_PORT_ATTEMPTS}）",
                    attempt + 1
                );
                eprintln!("[sidecar] 启动失败（第 {}/{MAX_PORT_ATTEMPTS} 次尝试）: {last_err}", attempt + 1);
                continue;
            };
            match watch_sidecar(app.clone(), port, 0) {
                Ok(()) => return,
                Err(e) => {
                    last_err = format!("E_SIDECAR_START: {e}");
                    eprintln!("[sidecar] 启动失败（第 {}/{MAX_PORT_ATTEMPTS} 次尝试）: {last_err}", attempt + 1);
                }
            }
        }
        eprintln!(
            "[sidecar] 启动失败（已尝试 {MAX_PORT_ATTEMPTS} 次，不再重试）: {last_err}"
        );
        // W07 B-8：全部启动尝试失败 = 终态 → 确保没有 stale 运行时状态对外暴露。
        clear_runtime_state(&app);
        // W07 A2-10：启动失败无存活 sidecar → 清理 spawn registry。
        remove_spawn_registry();
        let _ = app.emit(
            "ke:runtime-error",
            runtime_error_payload(&last_err, true, None),
        );
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
        // M6/R-3 修正（2026-09-20 事故复盘）：**退出路径不得同步调用 PowerShell**。
        // 原实现用 `is_our_backend_process`（WMI 查命令行 + 父进程）做「是不是我们的后端」校验，
        // 在个别机器上 PowerShell/WMI 会长时间阻塞 → `request_exit` 卡在清理里，主线程永远到不了
        // `app.exit(0)`（用户看到窗口消失但进程与侧车仍在）。改为：
        //   · 只按**spawn 时登记的 PID**（本进程直接子进程，见 SPAWNED_PID）清理，纯本地操作、有界；
        //   · PID 复用/跨实例误杀风险由 `cleanup_stale`（下次启动、非退出路径）承担，
        //     那里的 `is_backend_process` 校验可以慢慢查，不影响退出。
        if !is_alive(pid) {
            eprintln!("[sidecar] 退出清理：PID {pid} 已不存在，无需强杀");
            let _ = std::fs::remove_file(runtime_file());
            remove_spawn_registry();
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
    remove_spawn_registry();
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

#[cfg(test)]
mod tests {
    use super::{
        build_cors_origins, clear_runtime_info, clear_stale_runtime, decide_orphan,
        read_spawn_registry_at, remove_runtime_file_at, remove_spawn_registry_at,
        runtime_error_payload, should_restart, sidecar_exited_payload, spawn_registry_payload,
        write_spawn_registry_at, OrphanDecision, RuntimeInfo, MAX_CRASH_RESTARTS,
    };
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// SEC-6：release（dev=false）必须**完全忽略**环境变量 —— 不可由环境注入任意来源。
    #[test]
    fn cors_release_ignores_env() {
        let cors = build_cors_origins(
            false,
            Some("https://evil.example,http://127.0.0.1:5173".to_string()),
            Some("6000".to_string()),
        );
        assert_eq!(
            cors,
            vec![
                "http://tauri.localhost".to_string(),
                "https://tauri.localhost".to_string()
            ],
            "release 白名单必须硬编码、与环境变量无关"
        );
        assert!(!cors.iter().any(|o| o.contains("evil.example")));
        assert!(!cors.iter().any(|o| o.contains(":6000")));
    }

    /// release 在环境变量缺失时同样只含 tauri 来源（幂等）
    #[test]
    fn cors_release_without_env() {
        assert_eq!(build_cors_origins(false, None, None).len(), 2);
    }

    /// dev（dev=true）采纳环境变量 + 追加 dev 端口两种写法
    #[test]
    fn cors_dev_adopts_env_and_dev_port() {
        let cors = build_cors_origins(
            true,
            Some(" https://custom.dev ,, http://127.0.0.1:5173 ".to_string()),
            Some("6000".to_string()),
        );
        assert!(cors.contains(&"https://custom.dev".to_string()));
        assert!(cors.contains(&"http://127.0.0.1:5173".to_string()));
        assert!(cors.contains(&"http://127.0.0.1:6000".to_string()));
        assert!(cors.contains(&"http://localhost:6000".to_string()));
        // 空项与重复项被清理
        assert!(!cors.iter().any(|o| o.is_empty()));
        let mut sorted = cors.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), cors.len(), "白名单不得有重复项");
    }

    /// dev 缺省端口 = 5173（与 tauri.conf.json devUrl 一致）
    #[test]
    fn cors_dev_default_port_is_5173() {
        let cors = build_cors_origins(true, None, None);
        assert!(cors.contains(&"http://127.0.0.1:5173".to_string()));
        assert!(cors.contains(&"http://localhost:5173".to_string()));
    }

    /// 非法端口 → 回退 5173（不得 panic、不得丢 tauri 来源）
    #[test]
    fn cors_dev_invalid_port_falls_back() {
        let cors = build_cors_origins(true, None, Some("not-a-port".to_string()));
        assert!(cors.contains(&"http://127.0.0.1:5173".to_string()));
        assert!(cors.contains(&"http://tauri.localhost".to_string()));
    }

    fn runtime_info(pid: u32) -> RuntimeInfo {
        RuntimeInfo {
            api_base: format!("http://127.0.0.1:8000"),
            workspace: "C:\\tmp\\ws".to_string(),
            version: "test".to_string(),
            pid,
            port: 8000,
        }
    }

    fn temp_runtime_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ke-runtime-b8-test-{}-{tag}.json",
            std::process::id()
        ))
    }

    /// W07 B-8：崩溃/终态清空 SidecarState.info → get_runtime_info 不再返回已死 pid。
    #[test]
    fn b8_clear_runtime_info_drops_dead_pid() {
        let info = Mutex::new(Some(runtime_info(4242)));
        assert!(clear_runtime_info(&info), "首次清理应报告「清掉了一条记录」");
        assert!(info.lock().unwrap().is_none(), "清理后不得再返回已死 pid");
        assert!(!clear_runtime_info(&info), "重复清理应幂等（无记录可清）");
    }

    /// W07 B-8：终态清理同时删除 stale runtime.json。
    #[test]
    fn b8_clear_stale_runtime_removes_runtime_json() {
        let path = temp_runtime_path("stale");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "{\"backend\":{\"pid\":4242}}").unwrap();
        let info = Mutex::new(Some(runtime_info(4242)));
        assert!(clear_stale_runtime(&info, &path));
        assert!(info.lock().unwrap().is_none());
        assert!(!path.exists(), "stale runtime.json 必须被删除");
        // 幂等：再调用不 panic、返回 false
        assert!(!clear_stale_runtime(&info, &path));
    }

    /// W07 B-8：runtime.json 不存在时删除失败不算清理（不 panic）。
    #[test]
    fn b8_remove_runtime_file_missing_is_false() {
        let path = temp_runtime_path("missing");
        let _ = std::fs::remove_file(&path);
        assert!(!remove_runtime_file_at(&path));
    }

    /// W07 B-8：崩溃重启预算判定（0/1/2 可重启，3 次耗尽后终态）。
    #[test]
    fn b8_should_restart_until_budget_exhausted() {
        assert!(should_restart(0));
        assert!(should_restart(1));
        assert!(should_restart(MAX_CRASH_RESTARTS - 1));
        assert!(!should_restart(MAX_CRASH_RESTARTS), "第 3 次崩溃后不得再自动拉起");
        assert!(!should_restart(MAX_CRASH_RESTARTS + 1));
    }

    /// W07 B-4：sidecar-exited 载荷带 restarting/attempt/maxRestarts（前端据此分级 banner）。
    #[test]
    fn b4_sidecar_exited_payload_has_restart_metadata() {
        let restarting = sidecar_exited_payload(Some(1), None, true, 2);
        assert_eq!(restarting["restarting"], serde_json::json!(true));
        assert_eq!(restarting["attempt"], serde_json::json!(2));
        assert_eq!(restarting["maxRestarts"], serde_json::json!(MAX_CRASH_RESTARTS));
        assert_eq!(restarting["code"], serde_json::json!(1));

        let terminal = sidecar_exited_payload(None, Some(9), false, MAX_CRASH_RESTARTS);
        assert_eq!(terminal["restarting"], serde_json::json!(false));
        assert_eq!(terminal["signal"], serde_json::json!(9));
    }

    /// W07 B-4：runtime-error 载荷标记 terminal（UI 显示「已降级」而不是「恢复中」）。
    #[test]
    fn b4_runtime_error_payload_marks_terminal() {
        let with_attempt = runtime_error_payload("重启失败", true, Some(2));
        assert_eq!(with_attempt["terminal"], serde_json::json!(true));
        assert_eq!(with_attempt["message"], serde_json::json!("重启失败"));
        assert_eq!(with_attempt["attempt"], serde_json::json!(2));
        assert_eq!(with_attempt["maxRestarts"], serde_json::json!(MAX_CRASH_RESTARTS));
        let without_attempt = runtime_error_payload("启动失败", true, None);
        assert!(without_attempt.get("attempt").is_none());
    }

    // ---------------- W07 A2-10：spawn registry / 孤儿保守判定 ----------------

    fn temp_registry_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ke-spawn-registry-test-{}-{tag}.json",
            std::process::id()
        ))
    }

    /// A2-10：registry 载荷含 pid/port/appPid/spawnedAtMs（供下次启动保守校验）。
    #[test]
    fn a2_10_spawn_registry_payload_fields() {
        let payload = spawn_registry_payload(4321, 8001, 999, 1_700_000_000_123);
        assert_eq!(payload["pid"], serde_json::json!(4321));
        assert_eq!(payload["port"], serde_json::json!(8001));
        assert_eq!(payload["appPid"], serde_json::json!(999));
        assert_eq!(payload["spawnedAtMs"], serde_json::json!(1_700_000_000_123u64));
    }

    /// A2-10：registry 原子写/读/删（幂等删除）。
    #[test]
    fn a2_10_spawn_registry_roundtrip_and_remove() {
        let path = temp_registry_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        let payload = spawn_registry_payload(4321, 8001, 999, 1);
        assert!(write_spawn_registry_at(&path, &payload));
        let read = read_spawn_registry_at(&path).expect("registry 应可读回");
        assert_eq!(read["pid"], serde_json::json!(4321));
        assert!(remove_spawn_registry_at(&path));
        assert!(!path.exists());
        assert!(!remove_spawn_registry_at(&path), "重复删除返回 false（幂等、不 panic）");
        assert!(read_spawn_registry_at(&path).is_none());
    }

    /// A2-10：孤儿判定必须**保守**——只有「存活 + 命令行是本项目 sidecar + 父进程=已死的上次 appPid」
    /// 才整树停止；其它情况一律 Skip/None（避免误杀用户实例/其它实例）。
    #[test]
    fn a2_10_orphan_decision_is_conservative() {
        let registry = spawn_registry_payload(500, 8000, 400, 1);

        // 上次应用实例仍存活（可能是另一实例）→ 不杀
        assert!(matches!(
            decide_orphan(&registry, |pid| pid == 500 || pid == 400, |_| true, |_| Some(400)),
            OrphanDecision::Skip { .. }
        ));
        // 应用已死 + 父进程匹配 + 命令行匹配 → 唯一可杀情形
        assert_eq!(
            decide_orphan(&registry, |pid| pid == 500, |_| true, |_| Some(400)),
            OrphanDecision::Kill { pid: 500 }
        );
        // 父进程与 appPid 不符（PID 复用/别的实例）→ Skip
        assert!(matches!(
            decide_orphan(&registry, |pid| pid == 500, |_| true, |_| Some(777)),
            OrphanDecision::Skip { .. }
        ));
        // 命令行不是本项目 sidecar → Skip
        assert!(matches!(
            decide_orphan(&registry, |pid| pid == 500, |_| false, |_| Some(400)),
            OrphanDecision::Skip { .. }
        ));
        // 进程已死 → 仅清 registry（None）
        assert_eq!(
            decide_orphan(&registry, |_| false, |_| true, |_| Some(400)),
            OrphanDecision::None
        );
        // 旧格式缺 appPid → Skip（不误杀）
        assert!(matches!(
            decide_orphan(&serde_json::json!({"pid": 500, "port": 8000}), |_| true, |_| true, |_| Some(400)),
            OrphanDecision::Skip { .. }
        ));
        // pid 缺失/非法 → None
        assert_eq!(
            decide_orphan(&serde_json::json!({}), |_| true, |_| true, |_| None),
            OrphanDecision::None
        );
    }
}
