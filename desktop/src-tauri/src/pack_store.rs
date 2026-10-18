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

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

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
    Ok(summary(&manifest, size))
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
            if !active.is_empty() {
                if let Ok(text) = fs::read_to_string(entry.path().join(active).join("manifest.json")) {
                    if let Ok(m) = serde_json::from_str::<Value>(&text) {
                        name = m.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        caps = m.get("capabilities").cloned().unwrap_or(json!([]));
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
