//! UI 工坊 P2-T16 产品纵向切片：**指定 revision 快照的打印**（隐藏 renderer 窗口 + WebView2 PrintToPdf）。
//!
//! 约束（ARCHITECTURE / T16）：
//! - 打印只使用调用方提供的**可信快照 HTML**（不读取当前编辑器 DOM、不隐式保存）；
//! - 隐藏 renderer 窗口由启动时创建（env `KE_WS_PRINT_RENDER=1`；命令里创建窗口会死锁）；
//! - 输出路径安全：必须是绝对路径、不覆盖已有文件；失败不 panic；
//! - 产品 UI 接线（T23/打印对话框）与 Windows 端到端 W 验收在后续任务。
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

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

/// 把快照 HTML 注入隐藏 renderer 并打印到 target。
#[tauri::command]
pub async fn print_snapshot_pdf(
    app: AppHandle,
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
    let script = format!(
        "document.open();document.write({});document.close();",
        serde_json::to_string(&html).map_err(|e| format!("E_PRINT_HTML: HTML 序列化失败: {e}"))?
    );
    window.eval(&script).map_err(|e| format!("E_PRINT_RENDER: 注入快照失败: {e}"))?;
    // 等布局/字体就绪（快照 HTML 应内联样式与字体；产品后续可改为显式 ready 握手）
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(400)))
        .await
        .map_err(|e| format!("E_PRINT_RENDER: 等待布局失败: {e}"))?;
    crate::print::render_window_pdf_to(app, PRINT_RENDER_WINDOW.to_string(), path, content_width).await
}
