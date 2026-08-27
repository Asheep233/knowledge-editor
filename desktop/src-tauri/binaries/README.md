# binaries/ — sidecar 构建产物（不入库）

## 契约（P1-16 双真相源消除）

`knowledgeeditor-backend-x86_64-pc-windows-msvc.exe` **不再从源码库分发**，改为
**构建期产物**（唯一事实源 = `backend/` 源码 + `backend/knowledgeeditor-backend.spec`）。

### 从源码构建 sidecar（Windows，要求 Python 3.10+ 与 PyInstaller）

```powershell
# 一次性准备
pip install -r backend\requirements.txt pyinstaller

# 构建（在仓库根执行，以匹配 spec 的 pathex=['backend']）
python -m PyInstaller backend\knowledgeeditor-backend.spec `
  --distpath desktop\src-tauri\binaries `
  --workpath backend\build\pyinstaller --noconfirm --clean
Move-Item -Force desktop\src-tauri\binaries\knowledgeeditor-backend.exe `
  desktop\src-tauri\binaries\knowledgeeditor-backend-x86_64-pc-windows-msvc.exe
```

产物命名必须带 target triple 后缀（Tauri `externalBin` 约定）。

### 校验

- `scripts\build.ps1`（`Get-HashManifest`）在构建后生成
  `desktop/src-tauri/binaries/versions.json`（结构化）与
  `manifest.sha256`（`sha256sum` 格式），作为该次构建的完整性清单。
- CI `desktop` job 从源码构建 → 校验 exe 内嵌 backend 版本字符串与
  `backend/app/__init__.py` 的 `__version__` 一致 → 生成并上传 manifest 作为发布附件。
- 本目录已被 `.gitignore` 排除（`*.exe` / `versions.json` / `manifest.sha256`），
  仓库内**不包含**任何预编译二进制。

### v1.0.1 参考构建

本地参考构建（Windows Python 3.14.7 + 锁定 requirements）的
`manifest.sha256` 见知识编辑器的 v1.0.1 验证报告（`knowledge-editor-fix-report.md` 附录）。
