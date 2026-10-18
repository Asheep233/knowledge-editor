# T27 Windows 安装/覆盖升级验收计划（I 证据，待执行）

> 目标：完成 ACCEPTANCE 中 **W08（覆盖升级与兼容）**、W01/W03/W07 的 **I（安装/重启/覆盖升级）**
> 证据。当前状态：**计划与可执行步骤已准备，未在本会话执行**（安装器会改动系统/覆盖安装，需主理人
> 明确授权与专用测试环境；不得触碰用户正在运行的 `D:\AstraNota` 安装）。

## 1. 环境隔离（红线）

- 使用**专用测试用户/VM/临时机器**，不覆盖用户现有安装与真实笔记库；
- 每轮测试前备份：工作区目录、`%APPDATA%\KnowledgeEditor`、`%APPDATA%\com.*` 测试数据；
- 安装包测试版本与用户版本分离（测试 identifier 构建仅用于功能验证；**同 identifier 覆盖升级**必须
  在专用环境执行）；
- 全程不推送、不发布 Release；产出仅本地证据。

## 2. 测试构建（可执行包准备）

```powershell
# 依 repo 构建脚本（desktop/src-tauri + frontend dist-build + PyInstaller sidecar）
cd desktop/src-tauri
npm --prefix ../../frontend run build           # frontend/dist-build
python -m PyInstaller backend/knowledgeeditor-backend.spec --distpath src-tauri/binaries --noconfirm --clean
npx tauri build                                 # 产出 NSIS/MSI 安装器（目标目录见 tauri.conf）
```

产出记录：安装器路径、SHA256、版本、构建 commit、sidecar hash（`versions.json`/`manifest.sha256`）。

## 3. 升级场景与断言（W08）

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| U1 基线安装 | 在干净测试环境安装 v1.2.18 安装器 | 可启动、新建工作区正常 |
| U2 预置数据 | 创建笔记（中文/公式/表格/附件）、设置、工坊信任包/私有状态 | 记录文件哈希与大小 |
| U3 覆盖升级 | 运行分支构建安装器（同 identifier） | 安装成功；笔记/设置/附件/索引重建正常；**旧包按政策运行或明确回官方** |
| U4 新能力 | 工坊面板/签名安装/guest 宿主/打印 | 新功能可用（引用 A1–A8 W 证据） |
| U5 降级再升级 | 卸载新版→安装旧版→再升级 | 数据不丢；协议/包格式不兼容时**只读或明确拒绝**，不静默损坏 |
| U6 崩溃/中断 | 升级中杀进程/断盘（可选故障注入） | 下次启动可恢复；安全模式可操作；不启动循环 |

## 4. 证据采集

- 每步：命令/操作、退出码、安装器日志、版本号、文件 before/after SHA256、截图、录屏（可选）；
- 证据写入 `evidence/T27-upgrade-results.json` + md（I 类）；失败记录复现步骤，不得降级成 U；
- 通过后更新 `reports/T26-acceptance-status.md` 与里程碑评估（W08 I 门禁）。

## 5. 风险与未决

- 同 identifier 覆盖升级会替换用户安装 → **必须专用环境/明确授权**；
- 旧包兼容策略（W01/W08）尚未实现"旧包回官方"策略，需要在测试中如实记录结论；
- 安装器签名/发布渠道不在本阶段（T27/T28 发布候选另行处理）。
