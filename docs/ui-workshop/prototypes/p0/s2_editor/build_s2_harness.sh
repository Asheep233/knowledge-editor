#!/usr/bin/env bash
# 构建 P0-S2 harness：esbuild 打包 Tiptap 壳实验为单文件 IIFE，供原型 WebView2 窗口加载。
# 用法：bash docs/ui-workshop/prototypes/p0/s2_editor/build_s2_harness.sh
set -eu
cd "$(dirname "$0")/../../../.."   # 仓库根
OUT="docs/ui-workshop/prototypes/p0/s1_runtime/tauri_sandbox/frontend/s2.js"
NODE_PATH="$PWD/frontend/node_modules" ./frontend/node_modules/.bin/esbuild \
  docs/ui-workshop/prototypes/p0/s2_editor/harness.ts \
  --bundle --format=iife --platform=browser --target=es2020 \
  --outfile="$OUT"
echo "built: $OUT"
