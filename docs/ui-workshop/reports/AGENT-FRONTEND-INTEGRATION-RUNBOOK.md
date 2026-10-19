# 前端 UI 接入 / 完整验证 Runbook（给另一个 Agent）

> 目标：让一个前端 UI Agent 用本仓库的既有流程**接一次完整的前端 UI，并完整验证本工坊实现能不能跑起来**。
> 本文件只描述**可复现步骤与预期结果**；验收结论以证据文件为准，不夸大。
> 分支：`feat/ui-workshop`（远程 `https://github.com/Asheep233/knowledge-editor.git`，主理人已授权推送；
> 不创建 Release、不 push 到 master）。

## 0. 环境

| 场景 | 需要 |
| --- | --- |
| Linux 可完成（推荐先跑） | Node.js **24**、Python 3.10+、Git；前端 `npm ci`；后端 `pip install -r backend/requirements.txt` |
| Windows 产品 W（可选，需 Windows） | 上述 + Rust stable（msvc）+ VS Build Tools C++ + WebView2 Runtime；pwsh 7 |
| 无需 | 真实用户笔记、真实 `%APPDATA%\KnowledgeEditor` 数据 |

## 1. 取代码

```bash
git clone --branch feat/ui-workshop https://github.com/Asheep233/knowledge-editor.git
cd knowledge-editor
git log --oneline -1        # 记录 HEAD
```

## 2. 前端（纳入 UI 接入后）验证

```bash
cd frontend
npm ci
npx tsc -b --noEmit                      # 期望：0 错误
npx vitest run --maxWorkers=2            # 期望：143 files / 1981 passed + 1 skipped（以实际为准，允许新增测试）
npm run build                            # 期望：dist-build 构建成功
# 工坊启用构建（产品级 UI 接入必须验证双 flag）：
VITE_KE_WORKSHOP=1 VITE_KE_CORE_SAVE=1 npm run build
```

> UI 接入约定：工坊入口受 `import.meta.env.VITE_KE_WORKSHOP==='1'` 控制；Core 保存受
> `VITE_KE_CORE_SAVE==='1'` 控制。**不要**在默认构建里默默打开工坊（生产默认关闭是验收要求）。

## 3. 后端验证

```bash
python3 -m pytest backend/tests -q        # 期望：841 passed / 6 skipped（以实际为准）
```

## 4. 工坊/协议/设备侧验证（Linux 可做）

```bash
# 4.1 验证矩阵与交付一致性（仓库自带检查器）
python3 docs/ui-workshop/tools/build_validation_matrix.py --check   # 期望：MATRIX GATE: PASS
python3 docs/ui-workshop/tools/verify_delivery_consistency.py       # 期望：8/8 PASS（只读；推送后 DC-5 允许「已推送」）
python3 docs/ui-workshop/tools/build_evidence_index.py              # 证据索引可重建

# 4.2 云端交接包脚本回归（39 项，Linux 可跑）
python3 -m pytest docs/ui-workshop/reports/cloud-handoff/tests -q   # 期望：39 passed
python3 docs/ui-workshop/tools/build_cloud_handoff.py               # 可重建 Windows VM 交接包

# 4.3 SDK 与参考包（Node）
node docs/ui-workshop/sdk/build.mjs && node docs/ui-workshop/sdk/selftest.mjs   # 期望：自检通过（4/4）
node docs/ui-workshop/tools/build_reference_packs.mjs               # 需测试签名私钥；无则跳过并记录 NOT_RUN
```

## 5. Windows 产品 W（仅当有 Windows 环境；否则如实 NOT_RUN）

```powershell
# 构建隔离测试产品（详见 docs/ui-workshop/tools/t26_isolated_build.md）
# 关键：前端用 VITE_KE_WORKSHOP=1 VITE_KE_CORE_SAVE=1 构建 dist-build，src-tauri 用隔离 identifier
# 跑关键探针（顺序执行、窗口独占、隔离 APPDATA/工作区）：
python tools/run_t26_save_probe.py            # A8 Core 保存 flag（期望 9/9）
python tools/run_t26_protocol_probe.py        # W05 协议线（期望 7/7）
python tools/run_t26_guest_io_probe.py        # G1/G2 内容读/写（期望 14/14）
python tools/run_t26_pack_editor_cmd_probe.py --pack a   # 命令桥（期望 36/36）
```

> **没有 Windows 环境时**：第 5 节必须记为 `NOT_RUN`，不得用 Linux/happy-dom 结果替代 Windows/WebView2 证据；
> I 类（安装/升级/回滚）证据同理，见 `reports/DECISION-T27-I-gate-blocked.md`。

## 6. 验收判定（本仓库口径）

- 矩阵 `--check` PASS、交付一致性 8/8、前端/后端测试通过、双 flag 构建成功 = **Linux 侧完整验证通过**；
- Windows 产品 W 探针全过 = 本机真实产品 W 证据通过；
- 安装/升级/回滚（I 类）**必须**在专用 Windows VM 按 `reports/cloud-handoff/README.md` 执行，未执行即 NOT_RUN；
- 最终交付状态按 TASK PACK 口径只能声明到有证据的那一档（当前：`EXPERIMENTAL_TRUSTED_PACKS`）。

## 7. 红线

不推送 master/不创建 Release；不用真实笔记/真实用户数据；不把 happy-dom/Linux Chromium 当 Windows 证据；
不隐藏旧 App、不伪造 PASS；失败如实记录（日志+截图）。
