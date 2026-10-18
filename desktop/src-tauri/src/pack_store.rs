//! UI 工坊 P3-T17/T21 产品纵向切片：**Rust 原生包存储**（真实 Tauri 主进程 + 系统应用数据目录）。
//!
//! 语义与 Core `frontend/src/core/packs/store.ts` 一致（同 staging/state/journal/校验规则）：
//! - 包目录不可变：`workshop-packs/<id>/<version>/` 先写 staging 再 rename；
//! - 单提交点：`state.json`（tmp+rename）记录 active/previous，journal 记录事务；
//! - 安装前扫描预览（身份/能力/apiVersion/哈希校验，未知能力与坏哈希无损拒绝）；
//! - 激活/回滚/verify；recover 清理半成品并在 active 损坏时自动回退 previous。
//!
//! 本模块不触碰用户笔记目录：只操作 `app_data_dir()/workshop-packs`。
use std::fs;
use std::path::{Path, PathBuf};

use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// T24：签名规范化载荷（与 TS `canonicalManifestPayload` 逐字节一致：字段固定顺序 + JSON.stringify 语义）。
pub fn canonical_manifest_payload(manifest: &Value) -> Result<Vec<u8>, String> {
    let j = |s: &str| serde_json::to_string(s).map_err(|e| e.to_string());
    let mut out = String::new();
    out.push_str("{\"id\":");
    out.push_str(&j(manifest.get("id").and_then(|v| v.as_str()).unwrap_or(""))?);
    out.push_str(",\"name\":");
    out.push_str(&j(manifest.get("name").and_then(|v| v.as_str()).unwrap_or(""))?);
    out.push_str(",\"version\":");
    out.push_str(&j(manifest.get("version").and_then(|v| v.as_str()).unwrap_or(""))?);
    out.push_str(",\"apiVersion\":");
    out.push_str(&manifest.get("apiVersion").and_then(|v| v.as_u64()).unwrap_or(0).to_string());
    out.push_str(",\"capabilities\":[");
    if let Some(caps) = manifest.get("capabilities").and_then(|v| v.as_array()) {
        for (i, cap) in caps.iter().enumerate() {
            if i > 0 { out.push(','); }
            out.push_str(&j(cap.as_str().unwrap_or(""))?);
        }
    }
    out.push_str("],\"entry\":{\"html\":");
    out.push_str(&j(manifest.get("entry").and_then(|e| e.get("html")).and_then(|v| v.as_str()).unwrap_or(""))?);
    out.push_str(",\"sdk\":");
    match manifest.get("entry").and_then(|e| e.get("sdk")).and_then(|v| v.as_str()) {
        Some(sdk) => out.push_str(&j(sdk)?),
        None => out.push_str("null"),
    }
    out.push_str("},\"commands\":[");
    if let Some(cmds) = manifest.get("commands").and_then(|v| v.as_array()) {
        for (i, cmd) in cmds.iter().enumerate() {
            if i > 0 { out.push(','); }
            out.push_str("{\"name\":");
            out.push_str(&j(cmd.get("name").and_then(|v| v.as_str()).unwrap_or(""))?);
            out.push_str(",\"handler\":");
            out.push_str(&j(cmd.get("handler").and_then(|v| v.as_str()).unwrap_or(""))?);
            out.push('}');
        }
    }
    out.push_str("],\"assets\":[");
    if let Some(assets) = manifest.get("assets").and_then(|v| v.as_array()) {
        for (i, asset) in assets.iter().enumerate() {
            if i > 0 { out.push(','); }
            out.push_str("{\"path\":");
            out.push_str(&j(asset.get("path").and_then(|v| v.as_str()).unwrap_or(""))?);
            out.push_str(",\"sha256\":");
            out.push_str(&j(asset.get("sha256").and_then(|v| v.as_str()).unwrap_or(""))?);
            out.push_str(",\"size\":");
            match asset.get("size").and_then(|v| v.as_u64()) {
                Some(size) => out.push_str(&size.to_string()),
                None => out.push_str("null"),
            }
            out.push('}');
        }
    }
    out.push_str("]}");
    Ok(out.into_bytes())
}

/// 公钥配置（env `KE_WORKSHOP_PUBKEYS` = {keyId: {"key":"<hex32>","revoked":bool,"expiresAt":<ms>}}）。
fn keyring_from_env() -> Value {
    std::env::var("KE_WORKSHOP_PUBKEYS")
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn parse_hex_32(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.trim().to_ascii_lowercase();
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// T24：验签 → `("valid"|"missing"|"invalid", reason)`；异常一律 invalid（不 panic）。
pub fn signature_status(manifest: &Value) -> (String, Option<String>) {
    let sig = match manifest.get("signature") {
        Some(sig) if sig.is_object() => sig,
        _ => return ("missing".into(), None),
    };
    if sig.get("alg").and_then(|v| v.as_str()) != Some("ed25519") {
        return ("invalid".into(), Some("E_SIGNATURE_ALG: 不支持的算法".into()));
    }
    let key_id = sig.get("keyId").and_then(|v| v.as_str()).unwrap_or("");
    let keyring = keyring_from_env();
    let entry = match keyring.get(key_id) {
        Some(entry) => entry,
        None => return ("invalid".into(), Some(format!("E_SIGNATURE_KEY: 未知密钥 {key_id}"))),
    };
    if entry.get("revoked").and_then(|v| v.as_bool()) == Some(true) {
        return ("invalid".into(), Some(format!("E_SIGNATURE_REVOKED: 密钥已撤销 {key_id}")));
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Some(expires) = entry.get("expiresAt").and_then(|v| v.as_u64()) {
        if now_ms >= expires {
            return ("invalid".into(), Some(format!("E_SIGNATURE_EXPIRED: 密钥已过期 {key_id}")));
        }
    }
    let Some(public_key) = entry.get("key").and_then(|v| v.as_str()).and_then(parse_hex_32) else {
        return ("invalid".into(), Some("E_SIGNATURE_KEY: 公钥配置非法".into()));
    };
    let Some(sig_bytes) = sig.get("signature").and_then(|v| v.as_str()).and_then(parse_hex_64) else {
        return ("invalid".into(), Some("E_SIGNATURE_FORMAT: 签名必须是 64 字节 hex".into()));
    };
    let payload = match canonical_manifest_payload(manifest) {
        Ok(payload) => payload,
        Err(e) => return ("invalid".into(), Some(format!("E_SIGNATURE: 载荷序列化失败 {e}"))),
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key) else {
        return ("invalid".into(), Some("E_SIGNATURE_KEY: 公钥非法".into()));
    };
    let signature = Signature::from_bytes(&sig_bytes);
    match verifying_key.verify_strict(&payload, &signature) {
        Ok(()) => ("valid".into(), None),
        Err(_) => ("invalid".into(), Some("E_SIGNATURE: 验签失败".into())),
    }
}

fn parse_hex_64(hex: &str) -> Option<[u8; 64]> {
    let hex = hex.trim().to_ascii_lowercase();
    if hex.len() != 128 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 64];
    for i in 0..64 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

const ALLOWED_CAPS: [&str; 6] = [
    "ui.shell",
    "panel.sidebar",
    "panel.dock",
    "editor.commands.readonly",
    "context.read",
    "print.request",
];

pub fn root_of(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("workshop-packs"))
        .map_err(|e| format!("取应用数据目录失败: {e}"))
}

fn id_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn state_path(root: &Path, id: &str) -> PathBuf {
    id_dir(root, id).join("state.json")
}

fn txn_path(root: &Path, id: &str) -> PathBuf {
    id_dir(root, id).join("txn.json")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"active": null, "previous": null}))
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| format!("写临时文件失败: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("提交 rename 失败: {e}"))
}

fn safe_rel(path: &str) -> Result<String, String> {
    let raw = path.replace('\\', "/");
    if raw.is_empty() || raw.starts_with('/') || raw.chars().nth(1) == Some(':') {
        return Err(format!("E_PATH: 绝对路径不允许: {path}"));
    }
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") || parts[0].starts_with('.') {
        return Err(format!("E_PATH: 非法路径: {path}"));
    }
    Ok(parts.join("/"))
}

fn parse_manifest(source_dir: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(source_dir.join("manifest.json"))
        .map_err(|e| format!("E_MANIFEST: 读取 manifest.json 失败: {e}"))?;
    let manifest: Value = serde_json::from_str(&text).map_err(|e| format!("E_MANIFEST: 非法 JSON: {e}"))?;
    let obj = manifest.as_object().ok_or("E_MANIFEST: manifest 必须是对象")?;
    for key in ["id", "name", "version"] {
        if !obj.get(key).and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty()) {
            return Err(format!("E_MANIFEST: 缺少字段 {key}"));
        }
    }
    if obj.get("apiVersion").and_then(|v| v.as_u64()) != Some(1) {
        return Err("E_API_VERSION: 仅支持 apiVersion=1".into());
    }
    let caps = obj.get("capabilities").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for cap in caps {
        let cap = cap.as_str().unwrap_or("");
        if !ALLOWED_CAPS.contains(&cap) {
            return Err(format!("E_CAPABILITY: 未允许的能力: {cap}"));
        }
    }
    let assets = obj.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if assets.is_empty() {
        return Err("E_MANIFEST: assets 不能为空".into());
    }
    Ok(manifest)
}

fn verify_assets(source_dir: &Path, manifest: &Value) -> Result<u64, String> {
    let mut total: u64 = 0;
    for asset in manifest.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let path = asset.get("path").and_then(|v| v.as_str()).ok_or("E_MANIFEST: 资产缺少 path")?;
        let rel = safe_rel(path)?;
        let expect = asset.get("sha256").and_then(|v| v.as_str()).ok_or("E_HASH: 资产缺少 sha256")?;
        let bytes = fs::read(source_dir.join(&rel)).map_err(|e| format!("E_HASH: 读取资产失败 {rel}: {e}"))?;
        let actual = sha256_hex(&bytes);
        if actual != expect {
            return Err(format!("E_HASH: 资产哈希不匹配: {rel}"));
        }
        total += bytes.len() as u64;
    }
    Ok(total)
}

fn summary(manifest: &Value, size: u64) -> Value {
    let caps = manifest.get("capabilities").cloned().unwrap_or(json!([]));
    let commands = manifest.get("commands").cloned().unwrap_or(json!([]));
    json!({
        "packId": manifest.get("id"),
        "name": manifest.get("name"),
        "version": manifest.get("version"),
        "apiVersion": manifest.get("apiVersion"),
        "capabilities": caps,
        "commands": commands,
        "sizeBytes": size,
        "blocked": false,
    })
}

/// 扫描候选包目录并生成安装预览（不写任何包目录）。
pub fn scan_dir(root: &Path, source_dir: &str) -> Result<Value, String> {
    let _ = root;
    let src = Path::new(source_dir);
    if !src.is_dir() {
        return Err(format!("E_SOURCE: 源目录不存在: {source_dir}"));
    }
    let manifest = parse_manifest(src)?;
    let size = verify_assets(src, &manifest)?;
    let (sig_status, sig_reason) = signature_status(&manifest);
    let mut preview = summary(&manifest, size);
    preview["signatureStatus"] = json!(sig_status);
    if let Some(reason) = sig_reason {
        preview["signatureReason"] = json!(reason);
    }
    Ok(preview)
}

fn state_of(root: &Path, id: &str) -> Value {
    read_json(&state_path(root, id))
}

pub fn list_packs(root: &Path) -> Value {
    let mut items: Vec<Value> = vec![];
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            // 只有含 state.json 的目录才是已安装包（源码/临时目录可能在同一 root 下）
            if !entry.path().join("state.json").exists() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with('.') {
                continue;
            }
            let state = state_of(root, &id);
            let active = state.get("active").and_then(|v| v.as_str()).unwrap_or("");
            let mut name = String::new();
            let mut caps = json!([]);
            let mut sig_status_text = "missing".to_string();
            let mut signature_reason: Option<String> = None;
            if !active.is_empty() {
                if let Ok(text) = fs::read_to_string(entry.path().join(active).join("manifest.json")) {
                    if let Ok(m) = serde_json::from_str::<Value>(&text) {
                        name = m.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        caps = m.get("capabilities").cloned().unwrap_or(json!([]));
                        let (status, reason) = signature_status(&m);
                        sig_status_text = status;
                        signature_reason = reason;
                    }
                }
            }
            items.push(json!({
                "id": id,
                "name": name,
                "active": state.get("active").cloned().unwrap_or(Value::Null),
                "previous": state.get("previous").cloned().unwrap_or(Value::Null),
                "activeVersion": active,
                "capabilities": caps,
                "signatureStatus": sig_status_text,
                "signatureReason": signature_reason,
            }));
        }
    }
    json!({"packs": items})
}

pub fn install_from_dir(root: &Path, source_dir: &str) -> Result<Value, String> {
    let src = Path::new(source_dir);
    if !src.is_dir() {
        return Err(format!("E_SOURCE: 源目录不存在: {source_dir}"));
    }
    let manifest = parse_manifest(src)?;
    verify_assets(src, &manifest)?;
    // T24：签名无效（含未知/撤销/过期）→ 拒绝安装；missing 交由 T22/T24 安装确认策略决定。
    let (sig_status, sig_reason) = signature_status(&manifest);
    if sig_status == "invalid" {
        return Err(sig_reason.unwrap_or_else(|| "E_SIGNATURE: 包签名无效".into()));
    }
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let version = manifest.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let dir = id_dir(root, &id).join(&version);
    if dir.exists() {
        return Err(format!("E_DUPLICATE: 版本已安装 {id}@{version}"));
    }
    if txn_path(root, &id).exists() {
        return Err("E_TXN: 存在未完成事务，请先 recover()".into());
    }
    let before = state_of(root, &id);
    fs::create_dir_all(id_dir(root, &id)).map_err(|e| e.to_string())?;
    let staging = id_dir(root, &id).join(format!(".staging-{version}-{}", std::process::id()));
    write_json_atomic(&txn_path(root, &id), &json!({
        "op": "install", "id": id, "version": version,
        "staging": staging.to_string_lossy(), "before": before,
    }))?;
    let outcome: Result<Value, String> = (|| {
        let assets = manifest.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for asset in &assets {
            let rel = safe_rel(asset.get("path").and_then(|v| v.as_str()).unwrap_or(""))?;
            let target = staging.join(&rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(src.join(&rel), &target).map_err(|e| format!("复制资产失败 {rel}: {e}"))?;
        }
        fs::copy(src.join("manifest.json"), staging.join("manifest.json")).map_err(|e| e.to_string())?;
        fs::rename(&staging, &dir).map_err(|e| format!("版本目录 rename 失败: {e}"))?;
        let active = before.get("active").and_then(|v| v.as_str()).map(str::to_string);
        let previous: Value = if active.as_deref() == Some(version.as_str()) {
            before.get("previous").cloned().unwrap_or(Value::Null)
        } else {
            active.map(|s| Value::String(s)).unwrap_or(Value::Null)
        };
        let next = json!({"active": version, "previous": previous,
            "updatedAt": format!("{:?}", std::time::SystemTime::now())});
        write_json_atomic(&state_path(root, &id), &next)?;
        let _ = fs::remove_file(txn_path(root, &id));
        Ok(next)
    })();
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(txn_path(root, &id));
    }
    outcome
}

pub fn verify_pack(root: &Path, id: &str, version: &str) -> Result<bool, String> {
    let dir = id_dir(root, id).join(version);
    let manifest = match fs::read_to_string(dir.join("manifest.json")) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(m) => m,
            Err(_) => return Ok(false),
        },
        Err(_) => return Ok(false),
    };
    if verify_assets(&dir, &manifest).is_err() {
        return Ok(false);
    }
    Ok(true)
}

pub fn activate(root: &Path, id: &str, version: &str) -> Result<Value, String> {
    if !verify_pack(root, id, version)? {
        return Err(format!("E_HASH: 版本完整性校验失败 {id}@{version}"));
    }
    let before = state_of(root, id);
    // 幂等：重复激活当前 active 版本不得改写 previous（否则 rollback 目标被破坏）
    if before.get("active").and_then(|v| v.as_str()) == Some(version) {
        return Ok(before);
    }
    write_json_atomic(&txn_path(root, id), &json!({"op": "activate", "id": id, "version": version, "before": before}))?;
    let next = json!({"active": version,
        "previous": before.get("active").cloned().unwrap_or(Value::Null),
        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
    write_json_atomic(&state_path(root, id), &next)?;
    let _ = fs::remove_file(txn_path(root, id));
    Ok(next)
}

pub fn rollback(root: &Path, id: &str) -> Result<Value, String> {
    let before = state_of(root, id);
    let previous = before.get("previous").and_then(|v| v.as_str()).map(str::to_string);
    let Some(previous) = previous else {
        return Err(format!("E_ROLLBACK: 没有可回滚的 previous 版本 {id}"));
    };
    if !verify_pack(root, id, &previous)? {
        return Err(format!("E_HASH: previous 版本已损坏，拒绝回滚 {id}@{previous}"));
    }
    write_json_atomic(&txn_path(root, id), &json!({"op": "rollback", "id": id, "version": previous, "before": before}))?;
    let next = json!({"active": previous,
        "previous": before.get("active").cloned().unwrap_or(Value::Null),
        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
    write_json_atomic(&state_path(root, id), &next)?;
    let _ = fs::remove_file(txn_path(root, id));
    Ok(next)
}

/// 卸载包：先写空 state 提交（active/previous=null），再删除包目录；删除失败回滚 state。
pub fn uninstall(root: &Path, id: &str) -> Result<Value, String> {
    if !state_path(root, id).exists() {
        return Err(format!("E_NOT_FOUND: 包未安装 {id}"));
    }
    let before = state_of(root, id);
    let empty = json!({"active": null, "previous": null,
        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
    write_json_atomic(&state_path(root, id), &empty)?;
    match fs::remove_dir_all(id_dir(root, id)) {
        Ok(()) => Ok(json!({"uninstalled": id, "previousState": before})),
        Err(e) => {
            let _ = write_json_atomic(&state_path(root, id), &before);
            Err(format!("E_IO: 删除包目录失败: {e}"))
        }
    }
}

pub fn recover(root: &Path, id: &str) -> Result<Value, String> {
    let txn: Option<Value> = fs::read_to_string(txn_path(root, id)).ok().and_then(|s| serde_json::from_str(&s).ok());
    let before = state_of(root, id);
    if let Some(txn) = &txn {
        if let Some(staging) = txn.get("staging").and_then(|v| v.as_str()) {
            let _ = fs::remove_dir_all(staging);
        }
        if txn.get("op").and_then(|v| v.as_str()) == Some("install") {
            if let Some(version) = txn.get("version").and_then(|v| v.as_str()) {
                let active = before.get("active").and_then(|v| v.as_str());
                let previous = before.get("previous").and_then(|v| v.as_str());
                if active != Some(version) && previous != Some(version) {
                    let _ = fs::remove_dir_all(id_dir(root, id).join(version));
                }
            }
        }
        let _ = fs::remove_file(txn_path(root, id));
    }
    let mut state = state_of(root, id);
    let active = state.get("active").and_then(|v| v.as_str()).map(str::to_string);
    if let Some(active) = active {
        if !verify_pack(root, id, &active)? {
            let previous = state.get("previous").and_then(|v| v.as_str()).map(str::to_string);
            if let Some(previous) = previous {
                if verify_pack(root, id, &previous)? {
                    let next = json!({"active": previous, "previous": active,
                        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
                    write_json_atomic(&state_path(root, id), &next)?;
                    return Ok(json!({"recovered": true, "action": "rollback-corrupt-active", "state": next}));
                }
            }
            return Ok(json!({"recovered": false, "action": "corrupt-no-fallback", "state": state}));
        }
    }
    state["recovered"] = json!(txn.is_some());
    state["action"] = json!(if txn.is_some() { "cleanup-journal" } else { "clean" });
    Ok(state)
}

// ---------------- W01：ZIP 离线包安装（解压安全：炸弹/条目数/路径穿越/符号链接）----------------

const MAX_ZIP_ENTRIES: usize = 1000;
const MAX_ZIP_ENTRY_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// 解压 zip 到 root 下的临时 staging 目录（安全校验后），返回 staging 路径。
pub fn extract_zip_to_staging(root: &Path, zip_path: &str) -> Result<PathBuf, String> {
    let src = Path::new(zip_path);
    if !src.is_file() {
        return Err(format!("E_SOURCE: zip 文件不存在: {zip_path}"));
    }
    let file = fs::File::open(src).map_err(|e| format!("E_IO: 打开 zip 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("E_ZIP: 非法 zip: {e}"))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!("E_ZIP: 条目数超过上限（{} > {MAX_ZIP_ENTRIES}）", archive.len()));
    }
    let staging = root.join(format!(
        ".staging-zip-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&staging).map_err(|e| format!("E_IO: 创建 staging 失败: {e}"))?;
    let mut total: u64 = 0;
    let mut files_written = 0usize;
    let result: Result<(), String> = (|| {
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| format!("E_ZIP: 读取条目失败: {e}"))?;
            // 目录条目跳过（安装只需文件）
            let Some(name) = entry.enclosed_name() else {
                return Err(format!("E_ZIP: 非法条目路径（疑似穿越）: {}", entry.name()));
            };
            let rel = name.to_string_lossy().replace('\\', "/");
            if rel.is_empty() || rel.ends_with('/') {
                continue;
            }
            let safe = safe_rel(&rel)?;
            // 符号链接/特殊文件拒绝（仅普通文件）
            if let Some(mode) = entry.unix_mode() {
                if mode & 0o170000 == 0o120000 {
                    return Err(format!("E_ZIP: 拒绝符号链接条目: {rel}"));
                }
            }
            let size = entry.size();
            if size > MAX_ZIP_ENTRY_BYTES {
                return Err(format!("E_ZIP: 单文件超过上限 {rel} ({size} bytes)"));
            }
            total = total.saturating_add(size);
            if total > MAX_ZIP_TOTAL_BYTES {
                return Err(format!("E_ZIP: 解压总量超过上限（>{MAX_ZIP_TOTAL_BYTES} bytes）"));
            }
            let target = staging.join(&safe);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("E_IO: 创建目录失败: {e}"))?;
            }
            let mut out = fs::File::create(&target).map_err(|e| format!("E_IO: 写入失败 {rel}: {e}"))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("E_IO: 解压失败 {rel}: {e}"))?;
            files_written += 1;
        }
        if files_written == 0 {
            return Err("E_ZIP: 空包（无文件）".into());
        }
        if !staging.join("manifest.json").is_file() {
            return Err("E_ZIP: 缺少 manifest.json".into());
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    Ok(staging)
}

/// 校验 staging 目录确实由我们创建（防止任意路径安装）。
fn staging_dir_guard(root: &Path, source_dir: &str) -> Result<PathBuf, String> {
    let dir = Path::new(source_dir);
    if !dir.starts_with(root) {
        return Err("E_STAGED: 非法 staging 路径（不在应用数据目录内）".into());
    }
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !name.starts_with(".staging-zip-") {
        return Err("E_STAGED: 非法 staging 目录名".into());
    }
    Ok(dir.to_path_buf())
}

/// 启动时对全部已安装包执行 recover：清理半成品/损坏回退，并生成状态摘要。
/// 返回 `{checked, results, safeMode, generatedAt}`；safeMode = 存在无法回退的损坏包。
pub fn recover_all(root: &Path) -> Value {
    let mut results: Vec<Value> = vec![];
    let mut checked = 0usize;
    let mut safe_mode = false;
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() || !entry.path().join("state.json").exists() {
                continue;
            }
            checked += 1;
            let id = entry.file_name().to_string_lossy().to_string();
            match recover(root, &id) {
                Ok(mut value) => {
                    if value.get("action").and_then(|v| v.as_str()) == Some("corrupt-no-fallback") {
                        safe_mode = true;
                    }
                    value["id"] = json!(id);
                    results.push(value);
                }
                Err(e) => {
                    safe_mode = true;
                    results.push(json!({"id": id, "error": e}));
                }
            }
        }
    }
    json!({
        "checked": checked,
        "results": results,
        "safeMode": safe_mode,
        "generatedAt": format!("{:?}", std::time::SystemTime::now()),
    })
}

/// A7：产品 guest 会话状态（幂等覆盖；供工坊 UI/诊断/恢复读取）。
fn session_status_path(root: &Path) -> PathBuf {
    root.join("workshop-session-status.json")
}

const SESSION_STATES: [&str; 6] = ["idle", "starting", "active", "suspended", "failed", "stopped"];

/// 校验并规范化会话状态（未知状态拒绝，避免 UI/恢复逻辑读到脏数据）。
pub fn normalize_session_status(status: &Value) -> Result<Value, String> {
    let state = status.get("state").and_then(|v| v.as_str()).unwrap_or("");
    if !SESSION_STATES.contains(&state) {
        return Err(format!("E_SESSION_STATE: 非法会话状态 {state:?}"));
    }
    let pack_id = status.get("packId").cloned().unwrap_or(Value::Null);
    if let Some(id) = pack_id.as_str() {
        safe_rel(id)?;
    } else if !pack_id.is_null() {
        return Err("E_SESSION_STATE: packId 必须是字符串或 null".into());
    }
    Ok(json!({
        "state": state,
        "packId": pack_id,
        "capabilities": status.get("capabilities").cloned().unwrap_or(json!([])),
        "lastError": status.get("lastError").cloned().unwrap_or(Value::Null),
        "updatedAt": format!("{:?}", std::time::SystemTime::now()),
    }))
}

pub fn read_session_status(root: &Path) -> Value {
    fs::read_to_string(session_status_path(root))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or_else(|| json!({"state": "idle", "packId": null, "capabilities": [], "updatedAt": null}))
}

pub fn write_session_status(root: &Path, status: &Value) -> Result<Value, String> {
    let normalized = normalize_session_status(status)?;
    write_json_atomic(&session_status_path(root), &normalized)?;
    Ok(normalized)
}

/// 把启动恢复状态写入应用数据区（供 UI/诊断读取；写失败不阻断启动）。
pub fn write_recover_status(app_data_root: &Path, status: &Value) -> Result<PathBuf, String> {
    let path = app_data_root.join("workshop-recover-status.json");
    write_json_atomic(&path, status)?;
    Ok(path)
}

// ---------------- Tauri commands（产品壳） ----------------

#[tauri::command]
pub fn workshop_pack_scan(app: AppHandle, source_dir: String) -> Result<Value, String> {
    scan_dir(&root_of(&app)?, &source_dir)
}

#[tauri::command]
pub fn workshop_pack_install(app: AppHandle, source_dir: String) -> Result<Value, String> {
    install_from_dir(&root_of(&app)?, &source_dir)
}

#[tauri::command]
pub fn workshop_pack_list(app: AppHandle) -> Result<Value, String> {
    Ok(list_packs(&root_of(&app)?))
}

/// A7/T17：读取**已安装包**的入口资源（路径安全 + 大小上限；供产品 guest 宿主加载真实 entry）。
#[tauri::command]
pub fn workshop_pack_read_asset(
    app: AppHandle,
    id: String,
    version: String,
    path: String,
) -> Result<String, String> {
    const MAX_ASSET_BYTES: u64 = 5 * 1024 * 1024;
    let rel = safe_rel(&path)?;
    let id = safe_rel(&id)?;           // id 同样不得含路径穿越
    let version = safe_rel(&version)?;
    let file = id_dir(&root_of(&app)?, &id).join(&version).join(&rel);
    if !file.is_file() {
        return Err(format!("E_NOT_FOUND: 包资源不存在 {}@{}:{rel}", id, version));
    }
    let meta = fs::metadata(&file).map_err(|e| format!("E_IO: {e}"))?;
    if meta.len() > MAX_ASSET_BYTES {
        return Err(format!("E_TOO_LARGE: 包资源超过上限 {} bytes", MAX_ASSET_BYTES));
    }
    fs::read_to_string(&file).map_err(|e| format!("E_IO: 读取包资源失败: {e}"))
}

/// A7：读取 product guest 会话状态（无记录 → idle）。
/// W01：ZIP 离线包 —— 安全解压到 staging 并返回扫描预览（token=staging 目录）。
#[tauri::command]
pub fn workshop_pack_stage_zip(app: AppHandle, zip_path: String) -> Result<Value, String> {
    let root = root_of(&app)?;
    let staging = extract_zip_to_staging(&root, &zip_path)?;
    let preview = scan_dir(&root, staging.to_string_lossy().as_ref())?;
    let mut out = preview;
    out["token"] = json!(staging.to_string_lossy());
    out["source"] = json!("zip-file");
    Ok(out)
}

/// W01：安装已解压 staged 包（原子安装；完成后清理 staging）。
#[tauri::command]
pub fn workshop_pack_install_staged(app: AppHandle, source_dir: String) -> Result<Value, String> {
    let root = root_of(&app)?;
    let staging = staging_dir_guard(&root, &source_dir)?;
    let result = install_from_dir(&root, staging.to_string_lossy().as_ref());
    let _ = fs::remove_dir_all(&staging);
    result
}

/// W01：取消/清理 staged 包。
#[tauri::command]
pub fn workshop_pack_abort_staged(app: AppHandle, source_dir: String) -> Result<(), String> {
    let root = root_of(&app)?;
    let staging = staging_dir_guard(&root, &source_dir)?;
    fs::remove_dir_all(&staging).map_err(|e| format!("E_IO: 清理 staging 失败: {e}"))
}

#[tauri::command]
pub fn workshop_pack_session_status(app: AppHandle) -> Result<Value, String> {
    Ok(read_session_status(&root_of(&app)?))
}

/// A7：写入 product guest 会话状态（校验 state/packId；原子覆盖）。
#[tauri::command]
pub fn workshop_pack_session_report(app: AppHandle, status: Value) -> Result<Value, String> {
    write_session_status(&root_of(&app)?, &status)
}

#[tauri::command]
pub fn workshop_pack_verify(app: AppHandle, id: String, version: String) -> Result<bool, String> {
    verify_pack(&root_of(&app)?, &id, &version)
}

#[tauri::command]
pub fn workshop_pack_activate(app: AppHandle, id: String, version: String) -> Result<Value, String> {
    activate(&root_of(&app)?, &id, &version)
}

#[tauri::command]
pub fn workshop_pack_rollback(app: AppHandle, id: String) -> Result<Value, String> {
    rollback(&root_of(&app)?, &id)
}

#[tauri::command]
pub fn workshop_pack_recover(app: AppHandle, id: String) -> Result<Value, String> {
    recover(&root_of(&app)?, &id)
}

// ---------------- Tauri commands（产品壳） ----------------

#[tauri::command]
pub fn workshop_pack_uninstall(app: AppHandle, id: String) -> Result<Value, String> {
    uninstall(&root_of(&app)?, &id)
}

#[tauri::command]
pub fn workshop_pack_recover_all(app: AppHandle) -> Result<Value, String> {
    let root = root_of(&app)?;
    let status = recover_all(&root);
    let _ = write_recover_status(&root, &status);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("ke-pack-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn make_pack(dir: &Path, id: &str, version: &str, tamper: bool) {
        fs::create_dir_all(dir).unwrap();
        let content = format!("<html>{id}</html>");
        fs::write(dir.join("index.html"), &content).unwrap();
        let mut hash = sha256_hex(content.as_bytes());
        if tamper {
            hash = "0".repeat(64);
        }
        let manifest = json!({
            "id": id, "name": "Test", "version": version, "apiVersion": 1,
            "capabilities": ["ui.shell"], "entry": {"html": "index.html"},
            "assets": [{"path": "index.html", "sha256": hash}],
        });
        fs::write(dir.join("manifest.json"), serde_json::to_string(&manifest).unwrap()).unwrap();
    }

    // 环境变量（KE_WORKSHOP_PUBKEYS）在并行测试间共享 → 串行化用到 env 的用例
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn signed_manifest(public_key_hex: &str, mutate: Option<&str>) -> (Value, String) {
        use ed25519_dalek::{Signer, SigningKey};
        let seed: [u8; 32] = [
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
            0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
        ];
        let signing_key = SigningKey::from_bytes(&seed);
        let _ = public_key_hex;
        let mut manifest = json!({
            "id": "com.demo.signed", "name": "Signed Pack", "version": "1.0.0", "apiVersion": 1,
            "capabilities": ["ui.shell"], "entry": {"html": "index.html"},
            "commands": [{"name": "demo.hello", "handler": "hello"}],
            "assets": [{"path": "index.html", "sha256": "a".repeat(64)}],
        });
        if let Some(field) = mutate {
            manifest[field] = json!("tampered");
        }
        let payload = canonical_manifest_payload(&manifest).unwrap();
        let signature = signing_key.sign(&payload).to_bytes();
        let signature_hex: String = signature.iter().map(|b| format!("{b:02x}")).collect();
        let public_key = signing_key.verifying_key().to_bytes();
        let public_hex: String = public_key.iter().map(|b| format!("{b:02x}")).collect();
        manifest["signature"] = json!({"alg": "ed25519", "keyId": "k1", "signature": signature_hex});
        (manifest, public_hex)
    }

    fn with_keyring(public_hex: &str) {
        std::env::set_var(
            "KE_WORKSHOP_PUBKEYS",
            serde_json::to_string(&json!({ "k1": { "key": public_hex } })).unwrap(),
        );
    }

    #[test]
    fn canonical_payload_matches_ts_contract() {
        let manifest = json!({
            "id": "com.demo.signed", "name": "Signed Pack", "version": "1.0.0", "apiVersion": 1,
            "capabilities": ["ui.shell"], "entry": {"html": "index.html"},
            "commands": [{"name": "demo.hello", "handler": "hello"}],
            "assets": [{"path": "index.html", "sha256": "a".repeat(64)}],
        });
        let expected = format!(
            "{{\"id\":\"com.demo.signed\",\"name\":\"Signed Pack\",\"version\":\"1.0.0\",\"apiVersion\":1,\"capabilities\":[\"ui.shell\"],\"entry\":{{\"html\":\"index.html\",\"sdk\":null}},\"commands\":[{{\"name\":\"demo.hello\",\"handler\":\"hello\"}}],\"assets\":[{{\"path\":\"index.html\",\"sha256\":\"{}\" ,\"size\":null}}]}}",
            "a".repeat(64)
        ).replace("\" ,", "\",");
        let actual = String::from_utf8(canonical_manifest_payload(&manifest).unwrap()).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn signature_status_valid_invalid_missing() {
        let _guard = env_guard();
        let (manifest, public_hex) = signed_manifest("", None);
        with_keyring(&public_hex);
        assert_eq!(signature_status(&manifest).0, "valid");
        // 篡改：payload 变化 → invalid
        let mut tampered = manifest.clone();
        tampered["version"] = json!("9.9.9");
        assert_eq!(signature_status(&tampered).0, "invalid");
        // 未知密钥
        let mut unknown = manifest.clone();
        unknown["signature"]["keyId"] = json!("k-unknown");
        assert_eq!(signature_status(&unknown).0, "invalid");
        // 无签名
        let unsigned = json!({"id": "x"});
        assert_eq!(signature_status(&unsigned).0, "missing");
        std::env::remove_var("KE_WORKSHOP_PUBKEYS");
    }

    #[test]
    fn signature_revoked_and_expired() {
        let _guard = env_guard();
        let (manifest, public_hex) = signed_manifest("", None);
        std::env::set_var(
            "KE_WORKSHOP_PUBKEYS",
            serde_json::to_string(&json!({ "k1": { "key": public_hex, "revoked": true } })).unwrap(),
        );
        assert_eq!(signature_status(&manifest).0, "invalid");
        assert!(signature_status(&manifest).1.unwrap().contains("E_SIGNATURE_REVOKED"));
        std::env::set_var(
            "KE_WORKSHOP_PUBKEYS",
            serde_json::to_string(&json!({ "k1": { "key": public_hex, "expiresAt": 1u64 } })).unwrap(),
        );
        assert!(signature_status(&manifest).1.unwrap().contains("E_SIGNATURE_EXPIRED"));
        std::env::remove_var("KE_WORKSHOP_PUBKEYS");
    }

    #[test]
    fn install_rejects_invalid_signature() {
        let _guard = env_guard();
        let root = tmp_root("sig-install");
        let src = root.join("src-signed");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("index.html"), "<html>signed</html>").unwrap();
        let (mut manifest, _public_hex) = signed_manifest("", None);
        // 资产 sha 不匹配（让哈希校验先过：直接按真实内容改 sha 并重新签）
        let hash = sha256_hex(b"<html>signed</html>");
        manifest["assets"][0]["sha256"] = json!(hash);
        fs::write(src.join("manifest.json"), serde_json::to_string(&manifest).unwrap()).unwrap();
        // 用错误密钥配置 → 验签失败 → 安装拒绝
        std::env::set_var("KE_WORKSHOP_PUBKEYS", "{}");
        let err = install_from_dir(&root, src.to_str().unwrap()).unwrap_err();
        assert!(err.contains("E_SIGNATURE"), "{err}");
        std::env::remove_var("KE_WORKSHOP_PUBKEYS");
    }

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) -> Result<(), String> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let file = fs::File::create(path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in entries {
            zip.start_file(*name, opts).map_err(|e| e.to_string())?;
            zip.write_all(content).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn manifest_bytes(id: &str, version: &str, content: &str) -> Vec<u8> {
        let hash = sha256_hex(content.as_bytes());
        serde_json::to_vec(&json!({
            "id": id, "name": "ZipPack", "version": version, "apiVersion": 1,
            "capabilities": ["ui.shell"], "entry": {"html": "index.html"},
            "assets": [{"path": "index.html", "sha256": hash}],
        }))
        .unwrap()
    }

    #[test]
    fn zip_stage_and_install_valid_pack() {
        let root = tmp_root("zip-valid");
        let zip_path = root.join("pack.zip");
        let content = b"<html>zip pack</html>";
        make_zip(&zip_path, &[("manifest.json", &manifest_bytes("com.test.zip", "1.0.0", "<html>zip pack</html>")),
                              ("index.html", content)]).unwrap();
        let staging = extract_zip_to_staging(&root, zip_path.to_str().unwrap()).unwrap();
        assert!(staging.join("manifest.json").is_file());
        assert!(staging.join("index.html").is_file());
        install_from_dir(&root, staging.to_str().unwrap()).unwrap();
        let listed = list_packs(&root);
        assert_eq!(listed["packs"][0]["id"], "com.test.zip");
    }

    #[test]
    fn zip_rejects_zip_slip_and_absolute_paths() {
        let root = tmp_root("zip-slip");
        let zip_path = root.join("evil.zip");
        make_zip(&zip_path, &[("../evil.txt", b"x"), ("manifest.json", b"{}")]).unwrap();
        assert!(extract_zip_to_staging(&root, zip_path.to_str().unwrap()).is_err());
        let zip2 = root.join("abs.zip");
        make_zip(&zip2, &[("/etc/passwd", b"x")]).unwrap();
        assert!(extract_zip_to_staging(&root, zip2.to_str().unwrap()).is_err());
    }

    #[test]
    fn zip_rejects_too_many_entries_and_missing_manifest() {
        let root = tmp_root("zip-bomb");
        let zip_path = root.join("many.zip");
        let names: Vec<String> = (0..(MAX_ZIP_ENTRIES + 1)).map(|i| format!("f{i}.txt")).collect();
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), b"x" as &[u8])).collect();
        make_zip(&zip_path, &entries).unwrap();
        let err = extract_zip_to_staging(&root, zip_path.to_str().unwrap()).unwrap_err();
        assert!(err.contains("条目数超过上限"), "{err}");
        let zip2 = root.join("nomanifest.zip");
        make_zip(&zip2, &[("a.txt", b"x")]).unwrap();
        let err2 = extract_zip_to_staging(&root, zip2.to_str().unwrap()).unwrap_err();
        assert!(err2.contains("manifest.json"), "{err2}");
    }

    #[test]
    fn staging_dir_guard_rejects_outside_paths() {
        let root = tmp_root("staging-guard");
        assert!(staging_dir_guard(&root, root.join(".staging-zip-1-x").to_str().unwrap()).is_ok());
        assert!(staging_dir_guard(&root, root.join("com.test.a").to_str().unwrap()).is_err());
        assert!(staging_dir_guard(&root, "/tmp/.staging-zip-1-x").is_err());
    }

    #[test]
    fn session_status_roundtrip_and_validation() {
        let root = tmp_root("session-status");
        assert_eq!(read_session_status(&root)["state"], "idle");
        let written = write_session_status(
            &root,
            &json!({"state": "active", "packId": "com.test.a", "capabilities": ["context.read"]}),
        )
        .unwrap();
        assert_eq!(written["state"], "active");
        assert_eq!(written["capabilities"][0], "context.read");
        let read_back = read_session_status(&root);
        assert_eq!(read_back["state"], "active");
        assert_eq!(read_back["packId"], "com.test.a");
        // 非法状态/非法 packId 拒绝
        assert!(write_session_status(&root, &json!({"state": "running"})).is_err());
        assert!(write_session_status(&root, &json!({"state": "active", "packId": "../evil"})).is_err());
    }

    #[test]
    fn read_asset_paths_and_content() {
        let root = tmp_root("read-asset");
        let src = root.join("src");
        make_pack(&src, "com.test.asset", "1.0.0", false);
        install_from_dir(&root, src.to_str().unwrap()).unwrap();
        let iddir = root.join("com.test.asset");
        // 直接验证路径安全函数（命令本体需要 AppHandle；此处覆盖底层约束）
        assert!(safe_rel("index.html").is_ok());
        assert!(safe_rel("../evil").is_err());
        assert!(safe_rel("/abs").is_err());
        assert!(safe_rel("a\\..\\b").is_err());
        let content = fs::read_to_string(iddir.join("1.0.0").join("index.html")).unwrap();
        assert!(content.contains("com.test.asset"));
    }

    #[test]
    fn activate_same_version_is_idempotent() {
        let root = tmp_root("activate-idem");
        let src1 = root.join("src-1");
        let src2 = root.join("src-2");
        make_pack(&src1, "com.test.idem", "1.0.0", false);
        make_pack(&src2, "com.test.idem", "2.0.0", false);
        install_from_dir(&root, src1.to_str().unwrap()).unwrap();
        install_from_dir(&root, src2.to_str().unwrap()).unwrap();
        let before = state_of(&root, "com.test.idem");
        assert_eq!(before["active"], "2.0.0");
        assert_eq!(before["previous"], "1.0.0");
        // 重复 activate 当前 active：状态不变（previous 仍为 1.0.0），rollback 仍可用
        let same = activate(&root, "com.test.idem", "2.0.0").unwrap();
        assert_eq!(same["active"], "2.0.0");
        assert_eq!(same["previous"], "1.0.0");
        let rolled = rollback(&root, "com.test.idem").unwrap();
        assert_eq!(rolled["active"], "1.0.0");
        assert_eq!(rolled["previous"], "2.0.0");
    }

    #[test]
    fn safe_rel_rejects_traversal_and_absolute() {
        assert!(safe_rel("../evil.md").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert!(safe_rel("C:/x.md").is_err());
        assert!(safe_rel("assets/ok.js").is_ok());
    }

    #[test]
    fn scan_ok_and_tampered_blocked() {
        let root = tmp_root("scan");
        let src = root.join("src-ok");
        make_pack(&src, "com.demo.ok", "1.0.0", false);
        let s = scan_dir(&root, src.to_str().unwrap()).unwrap();
        assert_eq!(s["packId"], "com.demo.ok");
        assert_eq!(s["blocked"], false);
        let bad = root.join("src-bad");
        make_pack(&bad, "com.demo.bad", "1.0.0", true);
        assert!(scan_dir(&root, bad.to_str().unwrap()).unwrap_err().contains("E_HASH"));
    }

    #[test]
    fn uninstall_removes_pack_and_state() {
        let root = tmp_root("uninstall");
        let src = root.join("src");
        make_pack(&src, "com.demo.gone", "1.0.0", false);
        install_from_dir(&root, src.to_str().unwrap()).unwrap();
        assert!(verify_pack(&root, "com.demo.gone", "1.0.0").unwrap());
        let out = uninstall(&root, "com.demo.gone").unwrap();
        assert_eq!(out["uninstalled"], "com.demo.gone");
        assert!(!root.join("com.demo.gone").exists());
        assert!(uninstall(&root, "com.demo.gone").is_err()); // 已卸载
        assert!(list_packs(&root)["packs"].as_array().unwrap().is_empty());
    }

    #[test]
    fn recover_all_reports_clean_and_corrupt_packs() {
        let root = tmp_root("recover-all");
        let clean = root.join("src-clean");
        make_pack(&clean, "com.demo.clean", "1.0.0", false);
        install_from_dir(&root, clean.to_str().unwrap()).unwrap();
        let chain = root.join("src-chain-v1");
        make_pack(&chain, "com.demo.chain2", "1.0.0", false);
        install_from_dir(&root, chain.to_str().unwrap()).unwrap();
        let chain2 = root.join("src-chain-v2");
        make_pack(&chain2, "com.demo.chain2", "2.0.0", false);
        install_from_dir(&root, chain2.to_str().unwrap()).unwrap();
        // 损坏 active v2（previous v1 可用）→ recover_all 应自动回退
        fs::write(root.join("com.demo.chain2/2.0.0/index.html"), b"corrupted").unwrap();
        let status = recover_all(&root);
        assert_eq!(status["checked"], 2);
        assert_eq!(status["safeMode"], false);
        let results = status["results"].as_array().unwrap();
        let chain_result = results.iter().find(|r| r["id"] == "com.demo.chain2").unwrap();
        assert_eq!(chain_result["recovered"], true);
        assert_eq!(chain_result["state"]["active"], "1.0.0");
        let path = write_recover_status(&root, &status).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn install_list_rollback_recover_chain() {
        let root = tmp_root("chain");
        let v1 = root.join("src-v1");
        make_pack(&v1, "com.demo.chain", "1.0.0", false);
        let state1 = install_from_dir(&root, v1.to_str().unwrap()).unwrap();
        assert_eq!(state1["active"], "1.0.0");
        let v2 = root.join("src-v2");
        make_pack(&v2, "com.demo.chain", "2.0.0", false);
        let state2 = install_from_dir(&root, v2.to_str().unwrap()).unwrap();
        assert_eq!(state2["active"], "2.0.0");
        assert_eq!(state2["previous"], "1.0.0");
        let listed = list_packs(&root);
        assert_eq!(listed["packs"].as_array().unwrap().len(), 1);
        assert_eq!(listed["packs"][0]["signatureStatus"], "missing");
        assert!(verify_pack(&root, "com.demo.chain", "1.0.0").unwrap());
        let rb = rollback(&root, "com.demo.chain").unwrap();
        assert_eq!(rb["active"], "1.0.0");
        assert_eq!(rb["previous"], "2.0.0");
        // 损坏 active → recover 自动回滚到 previous
        fs::write(root.join("com.demo.chain/1.0.0/index.html"), b"corrupted").unwrap();
        assert!(!verify_pack(&root, "com.demo.chain", "1.0.0").unwrap());
        let rec = recover(&root, "com.demo.chain").unwrap();
        assert_eq!(rec["recovered"], true);
        assert_eq!(rec["state"]["active"], "2.0.0");
    }
}
