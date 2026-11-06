# AstraNota v1.3.0-rc.3（Release Candidate 3）

> **发布候选版**：正式版仍为 `v1.2.18`（Latest）。RC.3 只修**覆盖安装/升级**遇到的两个工程问题（用户 rc.2 真机实测），不改编辑器/PDF 业务逻辑。

## 修复

### 1. 升级安装报「无法打开要写入的文件」→ 已修

现象（rc.2 真机）：旧版已退出但 `knowledgeeditor-backend.exe`（PyInstaller 侧车）残留存活并锁定文件，
NSIS 覆盖 `D:\AstraNota\knowledgeeditor-backend.exe` 时失败中止。

修复（`desktop/src-tauri/nsis/legacy-migration.nsh` 的 `NSIS_HOOK_PREINSTALL`）：
- 复用 Tauri 官方 `CheckIfAppIsRunning` 流程处理**主程序**（silent 直接结束；交互模式提示并给保存机会）；
- 随后 `taskkill /F /T /IM knowledgeeditor-backend.exe` 清理**残留侧车（含 PyInstaller 子进程树）**；
- 清理后再进入文件复制，避免占用。

### 2. 侧车孤儿进程 → 已修

现象：主程序异常/强杀退出时正常清理链不执行，侧车长期存活（占资源 + 锁住升级文件）。

修复：
- Tauri spawn 侧车时注入 `KE_PARENT_PID`（`sidecar.rs`）；
- 后端新增父进程心跳（`backend/app/services/parent_watch.py`）：每 2s 检查一次父进程，连续 3 次不可达即自行退出（约 6s 内）；
- 仅桌面壳注入时启用；独立启动后端（开发/测试/手动 uvicorn）行为不变；
- 保留原有退出清理 `cleanup_on_exit`（正常关闭仍由主程序主动结束侧车）。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-rc.3_x64-setup.exe` | 51,154,196 B | `ac558696c85a443ebed5bf19b2504d99a79a5af2d1560a80f3d9beff421602ed` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,251,623 B | `fa74426e4c35ed7ee3375d135aab35af0f2ebc5a0d907998d53ccd6a5f58e8eb` |
| `manifest.sha256`（79 个产物） | 9,930 B | `529bd63226ac1f4bfb0dea31f8d8a29786be4e4265d0cf94151adad82df584ae` |
| `versions.json` | 16,026 B | `3005c0e531966fa51cd90edb34d4d650eba80dfcb50d3d01afed4d161ab2baa1` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-rc.3`（NSIS x64，未签名）。

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-rc.3`） |
| 前端全量测试 | **153/153 文件、2084 passed + 1 skipped**、EXIT=0 |
| 后端测试 | `pytest backend/tests` **EXIT=0**（含新增 `test_parent_watch.py` 5 例：当前进程存活/不存在进程/无配置不启用/非法 env） |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-rc.3` 与源码一致 ✔ |
| 安装器 | NSIS x64 构建成功（含 preinstall hook 展开）；ProductVersion=FileVersion=`1.3.0-rc.3` |
| 父进程心跳实测 | 本机 Windows：`KE_PARENT_PID`=存活进程 → 8s 后仍运行（无误杀）；=不存在 PID → **约 8.2s 自动退出**，0 残留进程 |
| 升级锁文件修复 | 生成的安装器 NSIS 脚本已包含 `CheckIfAppIsRunning` + `taskkill /F /T /IM knowledgeeditor-backend.exe`（makensis 编译通过） |

## 已知限制（未变）

安装包未签名｜125%/150% 缩放与多屏未验｜附件/模块端到端未验｜10k 首次激活不支持｜20MiB 默认排版首开约 2 分钟｜富媒体图片保真/慢资源超时未验｜系统打印 fallback UNVERIFIED。

## 升级/回滚
- 可直接覆盖安装 rc.1/rc.2 及更早预发布（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。
