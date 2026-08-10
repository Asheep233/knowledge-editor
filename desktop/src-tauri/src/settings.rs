// KnowledgeEditor 应用设置（Phase 7 M3，规划第 7 章 7.3）。
//
// 原则：设置属于应用层。不写入 Markdown、不修改 Workspace 文件结构、不与文章数据混存。
// 存储：%APPDATA%\KnowledgeEditor\settings.json（schema v1，KE_APP_CONFIG 机制仅供测试重定向）。
// 读写：Rust 命令 get_settings / update_settings；维护项 open_log_dir / open_data_dir；
//       重建索引复用后端 POST /api/index/rebuild（规划明确不新增后端接口）。
//
// schema（v1，与 phase7-plan.md 第 7 章一致）：
// {
//   "schemaVersion": 1,
//   "startup": { "restoreLastState": true, "autoOpenRecentWorkspace": true },
//   "editor": { "autosaveIntervalMs": 3000, "historyRetentionCount": 30, "display": {} },
//   "ui": { "theme": "system", "displayPreference": {} },
//   "maintenance": {}
// }

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

pub const SCHEMA_VERSION: u32 = 1;
const THEMES: [&str; 3] = ["system", "light", "dark"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StartupSettings {
    pub restore_last_state: bool,
    pub auto_open_recent_workspace: bool,
}

impl Default for StartupSettings {
    fn default() -> Self {
        Self {
            restore_last_state: true,
            auto_open_recent_workspace: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EditorSettings {
    pub autosave_interval_ms: u32,
    pub history_retention_count: u32,
    pub display: serde_json::Value,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            autosave_interval_ms: 3000,
            history_retention_count: 30,
            display: serde_json::Value::Object(Default::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiSettings {
    pub theme: String,
    pub display_preference: serde_json::Value,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            display_preference: serde_json::Value::Object(Default::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub startup: StartupSettings,
    pub editor: EditorSettings,
    pub ui: UiSettings,
    pub maintenance: serde_json::Value,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            startup: StartupSettings::default(),
            editor: EditorSettings::default(),
            ui: UiSettings::default(),
            maintenance: serde_json::Value::Object(Default::default()),
        }
    }
}

fn settings_file() -> PathBuf {
    crate::sidecar::data_dir().join("settings.json")
}

/// 读取设置：文件缺失/损坏/非法值一律回退默认值（不阻塞启动，与 app_config.py 策略一致）。
/// 兼容 UTF-8 BOM：Windows 记事本 / PowerShell 5 Set-Content -Encoding UTF8 都会写 BOM，
/// serde_json 不认 BOM，直接解析会失败并静默回退默认，导致用户改动丢失。
fn load_from(path: &std::path::Path) -> AppSettings {
    let raw = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return AppSettings::default(),
    };
    let text = raw.trim_start_matches('\u{feff}');
    serde_json::from_str::<AppSettings>(text).unwrap_or_default()
}

fn load() -> AppSettings {
    load_from(&settings_file())
}

/// 原子保存（tmp + rename），与后端 app_config.py 的 save() 策略一致。
fn save_to(path: &std::path::Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化设置失败: {e}"))?;
    std::fs::write(&tmp, text).map_err(|e| format!("写入设置失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存设置失败: {e}"))?;
    Ok(())
}

fn save(settings: &AppSettings) -> Result<(), String> {
    save_to(&settings_file(), settings)
}

/// 深合并：patch 为对象时逐键递归合并（仅覆盖存在的键）；非对象整体覆盖。
fn merge_value(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (key, value) in patch_obj {
            match base_obj.get_mut(key) {
                Some(existing) => merge_value(existing, value),
                None => {
                    base_obj.insert(key.clone(), value.clone());
                }
            }
        }
    } else {
        *base = patch.clone();
    }
}

/// 对补丁做 schema 级净化：theme 只允许 system/light/dark，非法值回退默认。
fn sanitize(mut settings: AppSettings) -> AppSettings {
    if !THEMES.contains(&settings.ui.theme.as_str()) {
        settings.ui.theme = UiSettings::default().theme;
    }
    settings
}

/// 前端读取设置（挂载后调用一次；也供设置面板初始化）。
#[tauri::command]
pub fn get_settings() -> AppSettings {
    sanitize(load())
}

/// 前端更新设置：patch 为部分字段（camelCase，与 schema 一致），深合并后原子落盘。
#[tauri::command]
pub fn update_settings(patch: serde_json::Value) -> Result<AppSettings, String> {
    let current = load();
    let mut merged = serde_json::to_value(&current)
        .map_err(|e| format!("序列化当前设置失败: {e}"))?;
    merge_value(&mut merged, &patch);
    let settings = serde_json::from_value::<AppSettings>(merged)
        .map_err(|e| format!("设置补丁非法: {e}"))?;
    let settings = sanitize(settings);
    save(&settings)?;
    Ok(settings)
}

/// 维护：打开日志目录（%APPDATA%\KnowledgeEditor\logs，不存在则创建）。
#[tauri::command]
pub fn open_log_dir() -> Result<(), String> {
    let dir = crate::sidecar::data_dir().join("logs");
    open_dir(dir)
}

/// 维护：打开数据目录（%APPDATA%\KnowledgeEditor\workspace，不存在则创建）。
#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let dir = crate::sidecar::data_dir().join("workspace");
    open_dir(dir)
}

/// 打开目录：Windows 用 explorer（GUI 程序不创建控制台，直接 spawn 不等待）。
fn open_dir(dir: PathBuf) -> Result<(), String> {
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("创建目录失败: {e}"));
    }
    let path = dir
        .to_str()
        .ok_or_else(|| "目录路径包含非法字符".to_string())?;
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_settings_file() -> PathBuf {
        // 测试不写真实 %APPDATA%：在系统临时目录下用唯一文件名隔离。
        let mut path = std::env::temp_dir();
        path.push(format!(
            "ke-settings-test-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        path
    }

    #[test]
    fn defaults_match_schema_v1() {
        let s = AppSettings::default();
        assert_eq!(s.schema_version, 1);
        assert!(s.startup.restore_last_state);
        assert!(s.startup.auto_open_recent_workspace);
        assert_eq!(s.editor.autosave_interval_ms, 3000);
        assert_eq!(s.editor.history_retention_count, 30);
        assert_eq!(s.ui.theme, "system");
    }

    #[test]
    fn merge_partial_patch_keeps_other_fields() {
        let base = AppSettings::default();
        let mut merged = serde_json::to_value(&base).unwrap();
        merge_value(
            &mut merged,
            &serde_json::json!({ "editor": { "autosaveIntervalMs": 5000 } }),
        );
        let out: AppSettings = serde_json::from_value(merged).unwrap();
        assert_eq!(out.editor.autosave_interval_ms, 5000);
        assert_eq!(out.editor.history_retention_count, 30); // 未被覆盖
        assert_eq!(out.ui.theme, "system"); // 其他分组不受影响
        assert_eq!(out.startup.restore_last_state, true);
    }

    #[test]
    fn merge_rejects_unknown_top_level_keys_silently() {
        let base = AppSettings::default();
        let mut merged = serde_json::to_value(&base).unwrap();
        merge_value(
            &mut merged,
            &serde_json::json!({ "plugins": { "x": 1 }, "ui": { "theme": "dark" } }),
        );
        let out: AppSettings = serde_json::from_value(merged).unwrap();
        assert_eq!(out.ui.theme, "dark");
        // 未知键被 serde 忽略（默认不报错），不影响已知字段
        assert_eq!(out.schema_version, 1);
    }

    #[test]
    fn sanitize_fixes_invalid_theme() {
        let mut s = AppSettings::default();
        s.ui.theme = "neon".to_string();
        let out = sanitize(s);
        assert_eq!(out.ui.theme, "system");
        for theme in THEMES {
            let mut s = AppSettings::default();
            s.ui.theme = theme.to_string();
            assert_eq!(sanitize(s).ui.theme, theme);
        }
    }

    #[test]
    fn roundtrip_save_load_restores_fields() {
        let mut s = AppSettings::default();
        s.editor.autosave_interval_ms = 8000;
        s.ui.theme = "dark".to_string();
        let path = tmp_settings_file();
        save_to(&path, &s).expect("save should succeed");
        let loaded = load_from(&path);
        assert_eq!(loaded.editor.autosave_interval_ms, 8000);
        assert_eq!(loaded.ui.theme, "dark");
        assert_eq!(loaded.startup.restore_last_state, true);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupted_file_falls_back_to_defaults() {
        let path = tmp_settings_file();
        std::fs::write(&path, "{ not valid json").unwrap();
        let loaded = load_from(&path);
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.ui.theme, "system");
        assert_eq!(loaded.editor.autosave_interval_ms, 3000);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_file_falls_back_to_defaults() {
        let path = tmp_settings_file();
        let _ = std::fs::remove_file(&path);
        let loaded = load_from(&path);
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.editor.history_retention_count, 30);
    }

    #[test]
    fn utf8_bom_is_tolerated() {
        // Windows 记事本 / PowerShell 5 会写带 BOM 的 UTF-8，必须能读取，否则静默回退默认。
        let mut s = AppSettings::default();
        s.ui.theme = "dark".to_string();
        s.editor.autosave_interval_ms = 8000;
        let path = tmp_settings_file();
        let mut bytes = b"\xef\xbb\xbf".to_vec(); // UTF-8 BOM
        bytes.extend_from_slice(serde_json::to_string(&s).unwrap().as_bytes());
        std::fs::write(&path, &bytes).unwrap();
        let loaded = load_from(&path);
        assert_eq!(loaded.ui.theme, "dark");
        assert_eq!(loaded.editor.autosave_interval_ms, 8000);
        std::fs::remove_file(&path).ok();
    }
}
