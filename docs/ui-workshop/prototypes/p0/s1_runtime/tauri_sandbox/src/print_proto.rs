//! P0-S4 原型：对**指定窗口**执行 WebView2 `PrintToPdf`（从产品 print.rs 简化移植）。
//!
//! 与产品一致的关键点：ShouldPrintBackgrounds、页眉页脚关、页边距 0、页宽=内容宽+打印内边距、
//! 等异步回调完成、失败返回可读错误、**不覆盖**已存在文件、轮询等待落盘。
//! 差异：本原型打印**指定的 snapshot renderer 窗口**（不是主窗口），用于验证「独立打印面」。
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_2, ICoreWebView2_7,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::{Interface, HSTRING, PCWSTR};

pub async fn render_window_pdf(
    app: AppHandle,
    window_label: String,
    target: PathBuf,
    content_width: Option<f64>,
) -> Result<String, String> {
    if target.exists() {
        return Err(format!("目标已存在，拒绝覆盖：{}", target.display()));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
    }
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("找不到打印窗口：{window_label}"))?;
    let err_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let ok_slot: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
    let ok_slot_in = Arc::clone(&ok_slot);
    let err_slot_in = Arc::clone(&err_slot);
    let path_for_closure = target.clone();

    window
        .with_webview(move |pw| {
            let outcome: Result<(), String> = (|| {
                unsafe {
                    let controller = pw.controller();
                    let core = controller
                        .CoreWebView2()
                        .map_err(|e| format!("取 CoreWebView2 失败：{e}"))?;
                    let env = core
                        .cast::<ICoreWebView2_2>()
                        .and_then(|c| c.Environment())
                        .map_err(|e| format!("取 WebView2 环境失败：{e}"))?;
                    let env6: ICoreWebView2Environment6 =
                        env.cast().map_err(|e| format!("环境版本不支持打印设置：{e}"))?;
                    let settings: ICoreWebView2PrintSettings = env6
                        .CreatePrintSettings()
                        .map_err(|e| format!("创建打印设置失败：{e}"))?;
                    settings.SetShouldPrintBackgrounds(true).map_err(|e| e.to_string())?;
                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|e| e.to_string())?;
                    settings.SetMarginTop(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginBottom(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginLeft(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginRight(0.0).map_err(|e| e.to_string())?;
                    const PRINT_PADDING_PX: f64 = 52.9167 * 2.0;
                    let page_w_in = match content_width {
                        Some(w) if w > 200.0 && w < 4000.0 => (w + PRINT_PADDING_PX) / 96.0,
                        _ => 8.27,
                    };
                    settings.SetPageWidth(page_w_in).map_err(|e| e.to_string())?;
                    settings.SetPageHeight(11.69).map_err(|e| e.to_string())?;
                    let core7: ICoreWebView2_7 = core
                        .cast()
                        .map_err(|e| format!("当前 WebView2 版本不支持 PrintToPdf：{e}"))?;
                    let hpath = HSTRING::from(path_for_closure.to_string_lossy().as_ref());
                    PrintToPdfCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| {
                            core7.PrintToPdf(PCWSTR(hpath.as_ptr()), &settings, &handler)?;
                            Ok(())
                        }),
                        Box::new(move |result, is_successful| {
                            if is_successful {
                                if let Ok(mut o) = ok_slot_in.lock() {
                                    *o = true;
                                }
                                Ok(())
                            } else {
                                result
                            }
                        }),
                    )
                    .map_err(|e| format!("打印到 PDF 失败：{e}"))?;
                }
                Ok(())
            })();
            if let Err(e) = outcome {
                if let Ok(mut slot) = err_slot_in.lock() {
                    *slot = Some(e);
                }
            }
        })
        .map_err(|e| format!("调用打印流程失败：{e}"))?;

    if let Some(e) = err_slot.lock().ok().and_then(|mut s| s.take()) {
        return Err(e);
    }
    let mut waited = 0u32;
    while waited < 30 {
        if let Ok(meta) = std::fs::metadata(&target) {
            if meta.len() > 0 {
                return Ok(target.to_string_lossy().to_string());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited += 1;
    }
    let reported_ok = ok_slot.lock().map(|v| *v).unwrap_or(false);
    Err(format!(
        "打印流程已结束，但目标 PDF 未出现：{}（WebView2 报告{}）",
        target.display(),
        if reported_ok { "成功" } else { "失败" }
    ))
}

#[tauri::command]
pub async fn print_window_pdf(
    app: AppHandle,
    window_label: String,
    target: String,
    content_width: Option<f64>,
) -> Result<String, String> {
    render_window_pdf(app, window_label, PathBuf::from(target), content_width).await
}
