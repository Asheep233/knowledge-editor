//! P3-T21 原型：**Rust 原生包存储**（真实 Windows 文件系统）—— T17 TS 语义的可执行等价物，
//! 用于给 T18/T21 的安装/升级/回滚/崩溃恢复提供 W 证据，并为 T20 原生恢复铺路。
//!
//! 语义与 `frontend/src/core/packs/store.ts` 一致：
//! - 版本目录不可变：先写 staging → rename 为 `packs/<id>/<version>/`；
//! - 单提交点：state.json（tmp+rename）记录 active/previous；journal txn.json 记录事务；
//! - 失败/崩溃无损：recover() 清理孤儿版本/staging/journal；active 校验失败且 previous 可用 → 自动回滚；
//! - 清单校验：id/version/apiVersion==1/能力 allowlist/路径安全/资产 sha256。
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ALLOWED_CAPS: [&str; 6] = [
    "ui.shell",
    "panel.sidebar",
    "panel.dock",
    "editor.commands.readonly",
    "context.read",
    "print.request",
];

fn packs_root(root: &str) -> PathBuf {
    Path::new(root).join("packs")
}

fn id_dir(root: &str, id: &str) -> PathBuf {
    packs_root(root).join(id)
}

fn version_dir(root: &str, id: &str, version: &str) -> PathBuf {
    id_dir(root, id).join(version)
}

fn state_path(root: &str, id: &str) -> PathBuf {
    id_dir(root, id).join("state.json")
}

fn txn_path(root: &str, id: &str) -> PathBuf {
    id_dir(root, id).join("txn.json")
}

pub fn sha256_hex_pub(bytes: &str) -> String {
    sha256_hex(bytes.as_bytes())
}

pub fn safe_rel_pub(path: &str) -> Result<String, String> {
    safe_rel(path)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn read_state(root: &str, id: &str) -> Value {
    match fs::read_to_string(state_path(root, id)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({"active": null, "previous": null})),
        Err(_) => json!({"active": null, "previous": null}),
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, serde_json::to_string_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| format!("写临时文件失败: {e}"))?;
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

fn validate_manifest(
    id: &str,
    version: &str,
    api_version: u32,
    capabilities: &[String],
    files: &HashMap<String, String>,
    hashes: &HashMap<String, String>,
) -> Result<(), String> {
    if id.len() < 2 || id.len() > 80 || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-') {
        return Err(format!("E_MANIFEST: 非法包 id: {id}"));
    }
    let vparts: Vec<&str> = version.split('.').collect();
    if vparts.len() != 3 || vparts.iter().any(|p| p.parse::<u32>().is_err()) {
        return Err(format!("E_MANIFEST: 非法版本: {version}"));
    }
    if api_version != 1 {
        return Err(format!("E_API_VERSION: apiVersion={api_version} 不兼容"));
    }
    for cap in capabilities {
        if !ALLOWED_CAPS.contains(&cap.as_str()) {
            return Err(format!("E_CAPABILITY: 未允许的能力: {cap}"));
        }
    }
    if files.is_empty() {
        return Err("E_MANIFEST: 文件不能为空".into());
    }
    for (path, content) in files {
        let rel = safe_rel(path)?;
        let expect = hashes
            .get(&rel)
            .ok_or_else(|| format!("E_HASH: 缺少哈希: {rel}"))?;
        let actual = sha256_hex(content.as_bytes());
        if &actual != expect {
            return Err(format!("E_HASH: 哈希不匹配: {rel}"));
        }
    }
    Ok(())
}

fn verify(root: &str, id: &str, version: &str) -> Result<bool, String> {
    let dir = version_dir(root, id, version);
    let manifest_path = dir.join("manifest.json");
    let manifest: Value = match fs::read_to_string(&manifest_path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("清单损坏: {e}"))?,
        Err(_) => return Ok(false),
    };
    let files = manifest.get("files").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    for (path, sha) in files {
        let bytes = match fs::read(dir.join(&path)) {
            Ok(b) => b,
            Err(_) => return Ok(false),
        };
        let actual = sha256_hex(&bytes);
        if Some(actual.as_str()) != sha.as_str() {
            return Ok(false);
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn pack_install(
    root: String,
    id: String,
    version: String,
    api_version: u32,
    capabilities: Vec<String>,
    files: HashMap<String, String>,
    hashes: HashMap<String, String>,
    fail_after_rename: Option<bool>,
) -> Result<Value, String> {
    validate_manifest(&id, &version, api_version, &capabilities, &files, &hashes)?;
    let dir = version_dir(&root, &id, &version);
    if dir.exists() {
        return Err(format!("E_DUPLICATE: 版本已安装 {id}@{version}"));
    }
    if txn_path(&root, &id).exists() {
        return Err("E_TXN: 存在未完成事务，请先 recover()".into());
    }
    let before = read_state(&root, &id);
    fs::create_dir_all(id_dir(&root, &id)).map_err(|e| e.to_string())?;
    let staging = id_dir(&root, &id).join(format!(".staging-{version}-{}", std::process::id()));
    let txn = json!({"op": "install", "id": id, "version": version, "staging": staging.to_string_lossy(), "before": before});
    write_json_atomic(&txn_path(&root, &id), &txn)?;
    let result: Result<Value, String> = (|| {
        for (path, content) in &files {
            let rel = safe_rel(path)?;
            let target = staging.join(&rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&target, content.as_bytes()).map_err(|e| format!("写资产失败 {rel}: {e}"))?;
        }
        write_json_atomic(
            &staging.join("manifest.json"),
            &json!({"id": id, "version": version, "apiVersion": api_version, "capabilities": capabilities, "files": hashes}),
        )?;
        fs::rename(&staging, &dir).map_err(|e| format!("版本目录 rename 失败: {e}"))?;
        if fail_after_rename.unwrap_or(false) {
            return Err("E_INJECTED: fail_after_rename 注入失败".into());
        }
        let active = before.get("active").and_then(|v| v.as_str()).map(|s| s.to_string());
        let previous: Value = if active.as_deref() == Some(version.as_str()) {
            before.get("previous").cloned().unwrap_or(Value::Null)
        } else {
            active.map(|s| Value::String(s)).unwrap_or(Value::Null)
        };
        let next = json!({
            "active": version,
            "previous": previous,
            "updatedAt": format!("{:?}", std::time::SystemTime::now()),
        });
        write_json_atomic(&state_path(&root, &id), &next)?;
        let _ = fs::remove_file(txn_path(&root, &id));
        Ok(next)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_file(txn_path(&root, &id));
    }
    result
}

#[tauri::command]
pub fn pack_state(root: String, id: String) -> Value {
    read_state(&root, &id)
}

#[tauri::command]
pub fn pack_verify(root: String, id: String, version: String) -> Result<bool, String> {
    verify(&root, &id, &version)
}

#[tauri::command]
pub fn pack_activate(root: String, id: String, version: String) -> Result<Value, String> {
    if !verify(&root, &id, &version)? {
        return Err(format!("E_HASH: 版本完整性校验失败 {id}@{version}"));
    }
    let before = read_state(&root, &id);
    let txn = json!({"op": "activate", "id": id, "version": version, "before": before});
    write_json_atomic(&txn_path(&root, &id), &txn)?;
    let next = json!({"active": version, "previous": before.get("active").cloned().unwrap_or(Value::Null),
        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
    write_json_atomic(&state_path(&root, &id), &next)?;
    let _ = fs::remove_file(txn_path(&root, &id));
    Ok(next)
}

#[tauri::command]
pub fn pack_rollback(root: String, id: String) -> Result<Value, String> {
    let before = read_state(&root, &id);
    let previous = before.get("previous").and_then(|v| v.as_str()).map(|s| s.to_string());
    let Some(previous) = previous else {
        return Err(format!("E_ROLLBACK: 没有可回滚的 previous 版本 {id}"));
    };
    if !verify(&root, &id, &previous)? {
        return Err(format!("E_HASH: previous 版本已损坏，拒绝回滚 {id}@{previous}"));
    }
    let txn = json!({"op": "rollback", "id": id, "version": previous, "before": before});
    write_json_atomic(&txn_path(&root, &id), &txn)?;
    let next = json!({"active": previous, "previous": before.get("active").cloned().unwrap_or(Value::Null),
        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
    write_json_atomic(&state_path(&root, &id), &next)?;
    let _ = fs::remove_file(txn_path(&root, &id));
    Ok(next)
}

#[tauri::command]
pub fn pack_recover(root: String, id: String) -> Result<Value, String> {
    let txn: Option<Value> = fs::read_to_string(txn_path(&root, &id)).ok().and_then(|s| serde_json::from_str(&s).ok());
    let before = read_state(&root, &id);
    if let Some(txn) = &txn {
        if let Some(staging) = txn.get("staging").and_then(|v| v.as_str()) {
            let _ = fs::remove_dir_all(staging);
        }
        if txn.get("op").and_then(|v| v.as_str()) == Some("install") {
            if let Some(version) = txn.get("version").and_then(|v| v.as_str()) {
                let active = before.get("active").and_then(|v| v.as_str());
                let previous = before.get("previous").and_then(|v| v.as_str());
                if active != Some(version) && previous != Some(version) {
                    let _ = fs::remove_dir_all(version_dir(&root, &id, version));
                }
            }
        }
        let _ = fs::remove_file(txn_path(&root, &id));
    }
    let mut state = read_state(&root, &id);
    let active = state.get("active").and_then(|v| v.as_str()).map(|s| s.to_string());
    if let Some(active) = active {
        if !verify(&root, &id, &active)? {
            let previous = state.get("previous").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(previous) = previous {
                if verify(&root, &id, &previous)? {
                    let next = json!({"active": previous, "previous": active,
                        "updatedAt": format!("{:?}", std::time::SystemTime::now())});
                    write_json_atomic(&state_path(&root, &id), &next)?;
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

/// 测试钩子：篡改版本内资产（模拟磁盘损坏）。
#[tauri::command]
pub fn pack_corrupt(root: String, id: String, version: String, path: String, content: String) -> Result<(), String> {
    let rel = safe_rel(&path)?;
    fs::write(version_dir(&root, &id, &version).join(rel), content.as_bytes()).map_err(|e| e.to_string())
}


/// T20 原型：启动恢复全部已安装包（与产品壳 recover_all 同语义），返回摘要。
pub fn pack_recover_all(root: &str) -> serde_json::Value {
    let mut results: Vec<serde_json::Value> = vec![];
    let mut checked = 0usize;
    let mut safe_mode = false;
    let packs = std::path::Path::new(root).join("packs");
    if let Ok(entries) = std::fs::read_dir(&packs) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() || !entry.path().join("state.json").exists() {
                continue;
            }
            checked += 1;
            let id = entry.file_name().to_string_lossy().to_string();
            match pack_recover(root.to_string(), id.clone()) {
                Ok(mut value) => {
                    if value.get("action").and_then(|v| v.as_str()) == Some("corrupt-no-fallback") {
                        safe_mode = true;
                    }
                    value["id"] = serde_json::json!(id);
                    results.push(value);
                }
                Err(e) => {
                    safe_mode = true;
                    results.push(serde_json::json!({"id": id, "error": e}));
                }
            }
        }
    }
    serde_json::json!({"checked": checked, "results": results, "safeMode": safe_mode})
}


/// T19 探针：从已安装包读取资产（真实 entry 资源加载；路径安全校验）。
#[tauri::command]
pub fn pack_read_asset(root: String, id: String, version: String, path: String) -> Result<String, String> {
    let rel = safe_rel_pub(&path)?;
    let file = std::path::Path::new(&root).join("packs").join(&id).join(&version).join(&rel);
    std::fs::read_to_string(&file).map_err(|e| format!("E_IO: 读取包资产失败 {}: {e}", file.display()))
}
