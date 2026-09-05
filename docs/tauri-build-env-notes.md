# Tauri 构建环境备忘（Windows + WSL 挂载盘）

> 背景：本机仓库在 WSL 挂载盘（`/mnt/d`），node_modules 由 **WSL npm** 创建，
> `.bin/*` 全部是 **symlink**——Windows 原生工具（cmd/node/npm）**无法执行 symlink**。
> 这导致 `tauri build` 的 beforeBuildCommand 类路径反复失败。本文记下已验证的绕行方案与根因，供下一轮/CI 参考。

## 结论速览（记住这三条）

1. **前端构建用 WSL bash 跑**（`cd frontend && npm run build`——一直成功）
2. **tauri build 用 Windows cmd 跑**，但 **beforeBuildCommand 必须绕过**（见下）
3. **下载 win32 二进制用 npmmirror**，下载后**必须验证完整性**（大小/解包校验）

## 完整坑列表（按发生顺序）

| 现象 | 根因 | 解法 |
|---|---|---|
| `npx tauri` could not determine executable | desktop 无 @tauri-apps/cli | 在 desktop 目录 `npm install @tauri-apps/cli` |
| npm install 装了 `cli-linux-x64-gnu` | npm 在 WSL 判定平台=linux | 手动下载 win32 包，见下 |
| `npm install --platform=win32` / `npm_config_platform` → `notsup` | npm os/cpu 校验拒绝 | 不能用 npm 装，绕过 |
| `cli-w32-x64-msvc.node is not a valid Win32 application` | 手动 curl registry.npmjs.org 被 WSL 网络截断 → **损坏文件**（6.8MB） | 换 **npmmirror** 下载完整 15.2MB；**下载后 tar -tzf + ls 大小校验** |
| node 跑 tauri.js 显示 cargo metadata 找不到 | WSL node 的 PATH 无 Windows cargo | 用 `cmd.exe /c bat` 启动（Windows PATH） |
| `tsc 不是内部命令`（beforeBuildCommand） | cmd 的 npm 不认 symlink `.bin/tsc` | **WSL 预构建 frontend**（产物进 dist-build）→ **临时把 tauri.conf.json 的 `beforeBuildCommand` 改为 `echo prebuilt`**（构建完恢复） |
| `npm --prefix ../frontend run build` 同失败 | 同上（npm 重设 PATH 只含自身 bin） | 同上绕过 |

## 已验证的 NSIS 构建流程（本机）

```bash
# 1. WSL 预构建前端（dist-build 最新）
cd /mnt/d/KE\ Project/knowledge-editor/frontend && npm run build

# 2. 临时禁用 beforeBuildCommand（dist-build 已就绪）
cd ../desktop/src-tauri
cp tauri.conf.json /c/ke-tmp/tauri.conf.json.bak
sed -i 's|"beforeBuildCommand": "npm --prefix ../frontend run build"|"beforeBuildCommand": "echo frontend prebuilt"|' tauri.conf.json

# 3. Windows cmd 跑 tauri build（tauri-cli 需 win32 二进制在
#    node_modules/@tauri-apps/cli-win32-x64-msvc/ 下）
cat > /c/ke-tmp/tauri-build.bat << 'EOF'
@echo off
set CARGO_TERM_COLOR=never
cd /d "D:\KE Project\knowledge-editor\desktop"
node node_modules\@tauri-apps\cli\tauri.js build
EOF
nohup cmd.exe /c "C:\ke-tmp\tauri-build.bat" > /mnt/d/KE\ Project/tauri-build-v110.log 2>&1 &

# 4. 恢复配置
cp /c/ke-tmp/tauri.conf.json.bak desktop/src-tauri/tauri.conf.json
```

产物：`desktop/src-tauri/target/release/bundle/nsis/KnowledgeEditor_1.1.0_x64-setup.exe`

## win32 tauri-cli 二进制安装（一次性，绕过 npm 平台校验）

```bash
curl -sL "https://registry.npmmirror.com/@tauri-apps/cli-win32-x64-msvc/-/cli-win32-x64-msvc-2.11.4.tgz" \
  -o /c/ke-tmp/cli-win32.tgz
tar -xzf /c/ke-tmp/cli-win32.tgz \
  -C desktop/node_modules/@tauri-apps/cli-win32-x64-msvc --strip-components=1
# 校验：ls 应见 cli.win32-x64-msvc.node 约 15MB；node tauri.js --version
```

## CI 无需处理

GitHub Actions 的 Windows runner 是原生 NTFS + npm 原生（无 WSL symlink 问题），
`tauri build` 的 beforeBuildCommand 正常；本备注仅针对**本机手动打包**场景。

## 遗留待办（未来根治）

- 在 **Windows 原生盘**（如 D:\ 非挂载）重新 `npm ci` 生成真 .cmd 的 .bin——免除所有 symlink 绕行
- 或改 `tauri.conf.json` 的 beforeBuildCommand 为 `wsl npm run build`（跨环境调用 WSL）
