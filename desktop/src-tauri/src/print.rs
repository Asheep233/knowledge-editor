//! task-71：PDF **静默导出**（WebView2 `PrintToPdf`，不弹系统打印对话框）。
//!
//! 与编辑器渲染完全一致：打印走**同一个 WebView2 引擎 + 同一份 print.css**，
//! 因此主题跟随、公式/表格/字体与屏幕态一致（详见 `frontend/src/print.css`）。
//!
//! 关键点：
//! - `ShouldPrintBackgrounds = true` —— 否则主题底色/代码块底色会被剥离（已实测确认）
//! - 页边距 0 + 前端 `@page { margin: 0 }` → 主题底色铺满整页
//! - 等异步完成回调再返回；失败返回**可读中文错误**，绝不 panic
//! - **绝不覆盖**已存在文件（调用方与本函数双重校验）

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_2, ICoreWebView2_7,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::{Interface, HSTRING, PCWSTR};

/// 静默导出主窗口为 PDF。
///
/// * `path` —— 目标文件绝对路径（调用方保证在工作区之外、且不存在）
///
/// 成功返回实际写入的路径；失败返回可读错误信息（不 panic、不覆盖已有文件）。
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    filename: String,
    content_width: Option<f64>,
) -> Result<String, String> {
    let target = resolve_target(&filename)?;

    // 双重保险：绝不覆盖已有文件
    if target.exists() {
        return Err(format!("目标文件已存在，拒绝覆盖：{}", target.display()));
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口，无法导出 PDF".to_string())?;

    // with_webview 的闭包必须返回 ()（错误经这个槽带回）
    let err_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    // WebView2 完成回调是否报告成功（用于区分「回调失败」与「回调成功但文件没出现」）
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

                    // 打印设置：Environment6 → CreatePrintSettings
                    let env = core
                        .cast::<ICoreWebView2_2>()
                        .and_then(|c| c.Environment())
                        .map_err(|e| format!("取 WebView2 环境失败：{e}"))?;
                    let env6: ICoreWebView2Environment6 =
                        env.cast().map_err(|e| format!("环境版本不支持打印设置：{e}"))?;
                    let settings: ICoreWebView2PrintSettings = env6
                        .CreatePrintSettings()
                        .map_err(|e| format!("创建打印设置失败：{e}"))?;

                    settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|e| format!("设置背景打印失败：{e}"))?; // 主题底色（关键）
                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|e| format!("设置页眉页脚失败：{e}"))?;
                    settings.SetMarginTop(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginBottom(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginLeft(0.0).map_err(|e| e.to_string())?;
                    settings.SetMarginRight(0.0).map_err(|e| e.to_string())?;
                    // 页宽 = 编辑器正文**内容宽** + 打印内边距（14mm×2），
                    // 这样 PDF 的换行位置与编辑器一致（「完全一致」的关键之一）；
                    // 未提供时退回 A4 宽度。
                    const PRINT_PADDING_PX: f64 = 52.9167 * 2.0; // 14mm × 2
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

                    // 等异步完成（内部 message pump）再返回
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
    // 有些环境下文件落盘比完成回调稍晚 → 轮询等待最多 ~3s，并核对非空
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
        "打印流程已结束，但目标 PDF 未出现：{}（WebView2 报告{}；请检查该目录是否存在/可写，或被安全软件拦截）",
        target.display(),
        if reported_ok { "成功" } else { "失败" }
    ))
}

/// 解析导出目标：`%USERPROFILE%\Documents\AstraNota Exports\<filename>.pdf`（**工作区之外**）。
///
/// - 文件名做最小净化（去掉路径分隔符与控制字符），避免越出导出目录
/// - 目标已存在时追加 ` (2)`、` (3)`… —— **绝不覆盖**已有文件
fn resolve_target(filename: &str) -> Result<PathBuf, String> {
    let stem: String = filename
        .trim()
        .trim_end_matches(".pdf")
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();
    let stem = if stem.is_empty() { "未命名文档".to_string() } else { stem };

    let profile = std::env::var("USERPROFILE")
        .map_err(|_| "无法确定用户目录（USERPROFILE 未设置）".to_string())?;
    let dir = PathBuf::from(profile).join("Documents").join("AstraNota Exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建导出目录失败：{e}"))?;

    let mut target = dir.join(format!("{stem}.pdf"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
        if n > 999 {
            return Err("同名导出文件过多，请先清理导出目录".to_string());
        }
    }
    Ok(target)
}
