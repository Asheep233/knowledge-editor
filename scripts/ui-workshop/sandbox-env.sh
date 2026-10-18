#!/usr/bin/env bash
# T00：隔离数据目录（Linux/WSL 开发侧）。
# 用法：source scripts/ui-workshop/sandbox-env.sh [基目录]
# 三个位置全部指向新建临时目录；LEGACY 保持不存在，避免导入无关配置。
set -u
BASE="${1:-/tmp/ke-ui-workshop-sandbox}"
rm -rf "$BASE"
mkdir -p "$BASE/workspace" "$BASE/appdata"
export KE_WORKSPACE="$BASE/workspace"
export KE_APP_CONFIG="$BASE/appdata/app_config.json"
export KE_APP_CONFIG_LEGACY="$BASE/appdata/legacy-does-not-exist.json"
export WEBVIEW2_USER_DATA_FOLDER="$BASE/webview2"   # 桌面态参考（Tauri 侧需确认实际生效键）
echo "KE_WORKSPACE=$KE_WORKSPACE"
echo "KE_APP_CONFIG=$KE_APP_CONFIG"
echo "KE_APP_CONFIG_LEGACY=$KE_APP_CONFIG_LEGACY (不存在=正确)"
