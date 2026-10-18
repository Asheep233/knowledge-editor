//! A7：`workshop` 自定义协议 —— 为已安装包提供**独立 origin**的入口资源（含包文档 CSP）。
//!
//! Windows 上 Tauri 将自定义协议映射为 `http://workshop.localhost/<path>`（独立 origin）；
//! 路径约定：`/<packId>/<version>/<rel...>`，仅允许读取 app_data/workshop-packs 内已安装包文件。
//! 包文档响应带自身 CSP（允许包内联脚本/样式/同源资产，禁止网络与父窗口注入），
//! 从而绕开主窗口 `script-src 'self'` 对 sandbox srcdoc 内联脚本的阻断（A7 首跑发现）。
use std::borrow::Cow;

use tauri::{http, AppHandle, Manager, Runtime};

pub const WORKSHOP_ORIGIN: &str = "http://workshop.localhost";
const MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 解析 `/<packId>/<version>/<rel...>`；拒绝穿越/绝对路径/缺失段。
pub fn parse_pack_path(path: &str) -> Result<(String, String, String), String> {
    let trimmed = path.trim_start_matches('/');
    let mut segments = trimmed.split('/');
    let pack_id = segments.next().filter(|s| !s.is_empty()).ok_or("E_PATH: 缺少 packId")?;
    let version = segments.next().filter(|s| !s.is_empty()).ok_or("E_PATH: 缺少 version")?;
    let rel: Vec<&str> = segments.collect();
    if rel.is_empty() {
        return Err("E_PATH: 缺少资源路径".into());
    }
    for part in std::iter::once(&pack_id).chain(std::iter::once(&version)).chain(rel.iter()) {
        if part.is_empty() || *part == "." || *part == ".." || part.contains('\\') || part.contains(':') {
            return Err(format!("E_PATH: 非法路径段 {part:?}"));
        }
    }
    Ok((pack_id.to_string(), version.to_string(), rel.join("/")))
}

pub fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// 包文档 CSP：允许包内联脚本/样式/同源资产；禁止网络与外部来源；只允许被主窗口嵌入。
pub fn pack_document_csp() -> String {
    format!(
        "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' {origin}; \
         style-src 'unsafe-inline' {origin}; img-src data: {origin}; font-src data: {origin}; \
         connect-src 'none'; frame-ancestors http://tauri.localhost http://localhost:5173",
        origin = WORKSHOP_ORIGIN
    )
}

/// 包文档硬化守卫：在 Tauri 初始化脚本注入 `__TAURI_INTERNALS__` 之后，于包脚本执行前
/// 将其 `invoke` 置空并移除 window 引用（纵深防御；remote IPC 本已不可用，但需防止实现漂移）。
pub fn hardening_script() -> &'static str {
    r#"<script>(function(){try{var i=window.__TAURI_INTERNALS__;if(i){try{Object.defineProperty(i,'invoke',{value:undefined,writable:false,configurable:false});}catch(e){}}
try{Object.defineProperty(window,'__TAURI_INTERNALS__',{value:undefined,writable:false,configurable:false});}catch(e){try{delete window.__TAURI_INTERNALS__;}catch(e2){}}}catch(e){}})();</script>"#
}

/// 在 HTML 的 `<head>` 后（或 doctype 后）注入硬化脚本，避免破坏 quirks/布局。
pub fn inject_guard(html: Vec<u8>) -> Vec<u8> {
    let guard = hardening_script().as_bytes();
    let lower_head = html.windows(6).position(|w| w.eq_ignore_ascii_case(b"<head>"));
    if let Some(pos) = lower_head {
        let insert_at = pos + 6;
        let mut out = Vec::with_capacity(html.len() + guard.len());
        out.extend_from_slice(&html[..insert_at]);
        out.extend_from_slice(guard);
        out.extend_from_slice(&html[insert_at..]);
        return out;
    }
    let mut out = Vec::with_capacity(html.len() + guard.len());
    out.extend_from_slice(guard);
    out.extend_from_slice(&html);
    out
}

fn response(status: u16, content_type: &str, body: Vec<u8>, include_csp: bool) -> http::Response<Cow<'static, [u8]>> {
    let mut builder = http::Response::builder().status(status).header("Content-Type", content_type);
    if include_csp {
        builder = builder.header("Content-Security-Policy", pack_document_csp());
    }
    builder.body(Cow::Owned(body)).unwrap_or_else(|_| http::Response::new(Cow::Borrowed(b"internal error" as &[u8])))
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, request: http::Request<Vec<u8>>) -> http::Response<Cow<'static, [u8]>> {
    let Some((pack_id, version, rel)) = parse_pack_path(request.uri().path()).ok() else {
        return response(400, "text/plain; charset=utf-8", b"E_PATH: bad path".to_vec(), false);
    };
    let Ok(root) = app.path().app_data_dir() else {
        return response(500, "text/plain", b"app data dir".to_vec(), false);
    };
    let file = root.join("workshop-packs").join(&pack_id).join(&version).join(&rel);
    let Ok(meta) = std::fs::metadata(&file) else {
        return response(404, "text/plain", b"not found".to_vec(), false);
    };
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return response(404, "text/plain", b"not found".to_vec(), false);
    }
    match std::fs::read(&file) {
        Ok(bytes) => {
            let is_html = rel.ends_with(".html") || rel.ends_with(".htm");
            let body = if is_html { inject_guard(bytes) } else { bytes };
            response(200, content_type(&rel), body, is_html)
        }
        Err(_) => response(500, "text/plain", b"read error".to_vec(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_pack_path() {
        assert_eq!(
            parse_pack_path("/com.demo.pack/1.0.0/index.html").unwrap(),
            ("com.demo.pack".into(), "1.0.0".into(), "index.html".into())
        );
        assert_eq!(
            parse_pack_path("/com.demo.pack/1.0.0/assets/app.js").unwrap().2,
            "assets/app.js"
        );
    }

    #[test]
    fn parse_rejects_traversal_and_missing_segments() {
        assert!(parse_pack_path("/../etc/passwd").is_err());
        assert!(parse_pack_path("/com.demo.pack/../x").is_err());
        assert!(parse_pack_path("/com.demo.pack/1.0.0/../evil").is_err());
        assert!(parse_pack_path("/com.demo.pack").is_err());
        assert!(parse_pack_path("//1.0.0/x").is_err());
        assert!(parse_pack_path("/com.demo.pack/1.0.0/a\\b").is_err());
    }

    #[test]
    fn html_guard_injected_after_head() {
        let html = b"<!doctype html><html><head><title>x</title></head><body>hi</body></html>".to_vec();
        let out = String::from_utf8(inject_guard(html)).unwrap();
        let head_idx = out.find("<head>").unwrap();
        let guard_idx = out.find("__TAURI_INTERNALS__").unwrap();
        assert!(guard_idx > head_idx, "guard 应在 <head> 之后");
        assert!(out.contains("Object.defineProperty(window,'__TAURI_INTERNALS__'"));
        assert!(out.ends_with("</html>"));
    }

    #[test]
    fn html_guard_prepends_when_no_head() {
        let out = String::from_utf8(inject_guard(b"<div>fragment</div>".to_vec())).unwrap();
        assert!(out.starts_with("<script>"));
        assert!(out.ends_with("<div>fragment</div>"));
    }

    #[test]
    fn content_types_and_csp() {
        assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("a.css"), "text/css; charset=utf-8");
        let csp = pack_document_csp();
        assert!(csp.contains("script-src 'unsafe-inline'"));
        assert!(csp.contains("frame-ancestors http://tauri.localhost"));
        assert!(csp.contains("connect-src 'none'"));
    }
}
