//! UI 工坊 P2-T16 产品纵向切片：**指定 revision 快照的打印**（隐藏 renderer 窗口 + WebView2 PrintToPdf）。
//!
//! 约束（ARCHITECTURE / T16）：
//! - 打印只使用调用方提供的**可信快照 HTML**（不读取当前编辑器 DOM、不隐式保存）；
//! - 隐藏 renderer 窗口由启动时创建（env `KE_WS_PRINT_RENDER=1`；命令里创建窗口会死锁）；
//! - 输出路径安全：必须是绝对路径、不覆盖已有文件；失败不 panic；
//! - 产品 UI 接线（T23/打印对话框）与 Windows 端到端 W 验收在后续任务。
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};

/// 打印 renderer 就绪状态（token → 已就绪）。由注入脚本在 document/fonts 就绪后回调。
#[derive(Default)]
pub struct PrintRenderState {
    pub ready: Mutex<HashMap<String, bool>>,
}

static PRINT_TOKEN_SEQ: AtomicU64 = AtomicU64::new(1);

pub const PRINT_RENDER_WINDOW: &str = "print-render";

/// 启动时创建隐藏 renderer 窗口（仅 env 开启；不会出现在任务栏/前台）。
pub fn ensure_render_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(PRINT_RENDER_WINDOW).is_some() {
        return Ok(());
    }
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let window = WebviewWindowBuilder::new(app, PRINT_RENDER_WINDOW, WebviewUrl::App("print-render.html".into()))
        .title("AstraNota print render")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(900.0, 1200.0)
        .build()
        .map_err(|e| format!("E_PRINT_RENDER: 创建打印 renderer 失败: {e}"))?;
    let _ = window.hide();
    Ok(())
}

/// renderer 就绪回调（来自注入脚本；校验窗口 label 与 token）。
#[tauri::command]
pub fn print_snapshot_ready(
    window: tauri::WebviewWindow,
    token: String,
    state: State<'_, PrintRenderState>,
) -> Result<(), String> {
    if window.label() != PRINT_RENDER_WINDOW {
        return Err("E_PRINT_RENDER: 非法调用窗口".into());
    }
    if let Ok(mut ready) = state.ready.lock() {
        ready.insert(token, true);
    }
    Ok(())
}

fn is_ready(state: &PrintRenderState, token: &str) -> bool {
    state.ready.lock().map(|m| m.get(token).copied().unwrap_or(false)).unwrap_or(false)
}

/// 把快照 HTML 注入隐藏 renderer 并打印到 target。
#[tauri::command]
pub async fn print_snapshot_pdf(
    app: AppHandle,
    state: State<'_, PrintRenderState>,
    html: String,
    target: String,
    content_width: Option<f64>,
) -> Result<String, String> {
    let path = PathBuf::from(&target);
    if !path.is_absolute() {
        return Err(format!("E_PATH: 打印输出必须是绝对路径: {target}"));
    }
    if path.exists() {
        return Err(format!("目标文件已存在，拒绝覆盖：{}", path.display()));
    }
    let window = app
        .get_webview_window(PRINT_RENDER_WINDOW)
        .ok_or_else(|| "E_PRINT_RENDER: 打印 renderer 未创建（需要以 KE_WS_PRINT_RENDER=1 启动）".to_string())?;
    // T16 收尾：**显式 ready 握手**（token）替代固定 sleep：
    // 注入脚本在 document/fonts 就绪后经 __TAURI_INTERNALS__.invoke('print_snapshot_ready') 回调。
    let token = PRINT_TOKEN_SEQ.fetch_add(1, Ordering::SeqCst).to_string();
    let script = format!(
        "document.open();document.write({html});document.close();\
         (function(){{var t={token};\
           var send=function(){{try{{window.__TAURI_INTERNALS__.invoke('print_snapshot_ready',{{token:t}});}}catch(e){{}}}};\
           var go=function(){{requestAnimationFrame(function(){{(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(send);}});}};\
           if(document.readyState==='complete')go();else window.addEventListener('load',go);}})();",
        html = serde_json::to_string(&html).map_err(|e| format!("E_PRINT_HTML: HTML 序列化失败: {e}"))?,
        token = serde_json::to_string(&token).map_err(|e| format!("E_PRINT_TOKEN: {e}"))?,
    );
    window.eval(&script).map_err(|e| format!("E_PRINT_RENDER: 注入快照失败: {e}"))?;
    // 轮询就绪（≤5s）；超时仍继续打印（记录警告，避免环境差异导致打印不可用）
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if is_ready(&state, &token) {
            break;
        }
        if Instant::now() >= deadline {
            eprintln!("[ws] E_PRINT_RENDER_TIMEOUT: renderer ready 手超时，继续打印");
            break;
        }
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(30)))
            .await
            .map_err(|e| format!("E_PRINT_RENDER: 等待就绪失败: {e}"))?;
    }
    if let Ok(mut ready) = state.ready.lock() {
        ready.remove(&token);
    }
    crate::print::render_window_pdf_to(app, PRINT_RENDER_WINDOW.to_string(), path, content_width).await
}
