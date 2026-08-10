# Phase 7 前冻结与稳定性检查

> 阶段：7（冻结复核） | 日期：2026-08-10 | 冻结基线：v0.6.0（Phase 6E） | 复核基线：v0.7.3（Phase 6U 完成态）
> 目的：在 Phase 7（Tauri 桌面化）开工前，对 6E 冻结契约与 6U 之后的代码状态做一次基线对账，确认冻结契约未被无意破坏、环境性修复在进入桌面化前仍然稳定。
> 状态：已执行（2026-08-10，契约对账 + P1-P10 核对 + 全量测试重跑 + 浏览器抽测 7/7 通过）。
> 相关文档：`docs/phase6e-report.md`（冻结清单 P1-P10）、`docs/phase6u-report.md`（6U 变更全量）、`docs/phase7-prep.md`（桌面化准备）

## 为什么需要这次复核

6E 的冻结清单建立在 v0.6.0 基线上，而 6U 在冻结之后又叠加了 8 个版本（v0.6.1 → v0.7.3）与一次表格优化：信息块存储格式从 atom 自闭合改为包裹格式、`update_article` 返回结构变化、构建链路引入 `ke-vite.mjs` 与缓存目录迁移、停止逻辑引入端口+特征兜底。这些冻结清单至今以文档记录维护，没有代码校验兜底，因此进入 Phase 7 前需要逐项对账，确认「冻结的东西没被改坏、改过的东西有兼容路径」。

## 1. 冻结契约对账

| # | 冻结项（6E 基线 v0.6.0） | 6U 之后现状 | 结论 |
| --- | --- | --- | --- |
| 1 | API 42 端点清单（v1 无前缀，`/api/*`） | 与 6E 清单逐项比对，46 项一致；仅 attachments 新增 1 个 `DELETE /api/attachments/{rel_path}`（v0.6.1 孤儿附件手动删除引入，前端 `client.ts` 有对应封装）。`update_article` 响应扩展为完整元信息（v0.7.3），浏览器端实测属性面板正确消费 | 增量扩展（只增不减），`update_article` 超集兼容，无调用方依赖旧瘦结构 |
| 2 | 信息块 Markdown 格式：atom 自闭合 `<!-- ke-note -->` | v0.7.0 冻结为包裹格式 `<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`；旧格式保留读取兼容（parseHTML 双规则 + `Fragment.fromJSON` 迁移） | **冻结契约已修改**，新格式为新的冻结基线；兼容路径单测覆盖 + 本次真实文件级迁移验证通过（见 3.3） |
| 3 | Markdown 扩展版本 ke_version = 1 | 不变 | 保持 |
| 4 | settings schema 1 / FTS schema 2 | 不变；搜索/索引重建（`/api/index/rebuild`）实测 8 文档 + 1 模块 + 3 附件 | 保持 |
| 5 | 版本三同步（`__init__.py` 唯一来源 + `version.ts` + `package.json`） | v0.7.3 三处一致（本次复核逐一读取确认）；`start.ps1` 对不一致告警 | 通过 |
| 6 | 构建链路 | 新增 `frontend/scripts/ke-vite.mjs`（esbuild 改名副本 + `ESBUILD_BINARY_PATH`）；`cacheDir` 移出 node_modules 到 `../workspace/.knowledgeeditor/vite-cache` | dev/build 均实测走 `ke-vite.mjs` 成功（见 3.2） |
| 7 | 停止链路 | `stop.ps1` 增加端口+命令行特征兜底（8000 匹配 `uvicorn app.main:app`、5173 匹配 `vite.js`），`taskkill /PID /T /F` | 兜底路径实测成功：无 runtime.json 的遗留 backend + vite 进程被端口+特征识别停止（见 3.4） |
| 8 | 快照/草稿格式 | `Drafts/backup/{doc_rel}/{YYYYMMDD-HHMMSS-mmm}.md` 30 份、`Drafts/recovery/*.draft.md` | 6U 未改动，保持 |

## 2. 6E 遗留问题（P1-P10）状态对账

| # | 问题 | 状态 |
| --- | --- | --- |
| P1 | 恢复点登记链路缺失（`registerRecovery` 封装零调用） | 已修复：`EditorArea.tsx` 自动保存（112 行）与手动保存（169 行）均调用 `registerRecoveryPoint` 登记恢复点 |
| P2 | `config.py` 死常量 `APP_VERSION` 与真实版本漂移 | 已修复（常量删除，版本唯一来源收敛到 `__init__.py`） |
| P3 | 调试探针与临时产物（`p2_empty_probe.mjs`、`probe-*.test.ts`、`.tmp-esbuild/`） | 已清理 |
| P4 | `routers/__init__.py` 的 `__all__` 漏 5 模块 | 已修复 |
| P5 | `fs_watch.py` 死函数、`import_export.py` 未使用 import | 已清理 |
| P6 | 架构文档与代码差异 | 未改写 HTML；以 6E 报告为冻结基线（记录在案） |
| P7 | App 顶栏徽章 "Phase 4" 滞后 | 已修复：`App.tsx` 徽章现显示 "Phase 6"，与当前阶段（6U 为 6 的子阶段）一致；进入 Phase 7 后再更新 |
| P8 | `clearRecentDocuments` 封装无调用方 | 已修复：`LeftSidebar.tsx`（"最近" 区「清空」按钮）已调用 |
| P9 | `ke.ts` 与 `client.ts` 重复 `attachmentUrl`（URI 编码差异） | 未修复，明确留给 Phase 7 侧车封装时合并（见 `docs/phase7-prep.md` 2.4） |
| P10 | `package.json` 无 test 脚本；`dist/` 残留 | 未修复，Phase 7 前补 `vitest run` 并接入 CI（见 `docs/phase7-prep.md` 3） |

## 3. 稳定性检查项

### 3.1 测试基线全量重跑

6U 的 62 vitest + 102 pytest + tsc 与 26 项浏览器 checklist 是当时快照。复核时按同一命令集重跑：`npx vitest run`（frontend）、`python -m pytest`（backend）、`npm run build`（含 `tsc -b`）；浏览器端至少抽测信息块包裹格式往返、脚注两种样式、保存元信息、拖拽附件四项核心路径。

执行结果（2026-08-10）：**全部通过**。`npx vitest run` 62/62（6 文件）；`backend\.venv\python -m pytest -q` 102/102（1 条 Starlette 弃用警告，非失败）；`npm run build` tsc 零错误、`✓ built in 9.82s`、exit code 0（JS 1.94 MB，与基线一致）。浏览器抽测 7/7：A1 旧格式打开渲染、A2 保存落盘包裹格式、B1 包裹格式往返、C1 block 脚注、C2 plain 脚注、D1 保存元信息、E1 拖拽附件（详见下方各节）。

### 3.2 环境性修复的稳定性

白屏修复（esbuild 改名副本 + `ESBUILD_BINARY_PATH` + 缓存目录迁移）依赖本机安全软件行为，属环境性修复。复核关注：dev server 冷启动一次依赖预构建正常产出；`npm run build` 在非 dev 场景（CI 无该安全软件）不依赖副本逻辑；迁移到 Phase 7 打包机后重新评估是否仍需副本。

执行结果：**通过**。dev server 冷启动后 `/` 与 `/repro.html` 均 200（预构建缓存产出正常，页面无白屏）；`npm run build` 日志确认走 `ESBUILD_BINARY_PATH=D:\Agent\KnowledgeEditor\frontend\.esbuild\esbuild-renamed.exe` 成功产出。CI/打包机无安全软件环境是否仍需副本：评估后认为 CI 无需（无拦截），Phase 7 打包机待实际环境复验。

### 3.3 数据兼容路径验证

信息块旧自闭合格式 → 包裹格式的迁移路径（parseHTML 双规则 + `Fragment.fromJSON`）已有 `phase3-roundtrip.test.ts` 覆盖；复核时补充一次真实文件级验证：手工构造一份含旧格式的 .md，打开、保存后确认内容以包裹格式落盘且无数据丢失。

执行结果：**通过**。手工构造 `Articles/freeze-check-legacy.md`（自闭合 `<!-- ke-note: {...content...} -->`）→ 主应用打开，信息块渲染正常（`data-ke-note` 存在、块内文字可见、0 页面错误）→ 修改并保存 → 落盘为包裹格式 `<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow"} -->` + 块内文本 + `<!-- /ke-note -->`，原 content 属性被移除，正文内容无丢失。验证后测试文档已清理。

### 3.4 启动/停止链路

按 `start.ps1` 一键启动 → 页面可操作 → `stop.ps1`（含无 runtime.json 场景）完整停止，确认端口无残留进程；`runtime/logs/` 四日志正常写入。

执行结果：**通过**。两条停止路径均实测：兜底路径（发现无 runtime.json 记录的遗留 backend 8000 + vite 5173 进程，按端口+命令行特征识别并 `taskkill /PID /T /F` 停止）；正常路径（`start.ps1` 一键启动写入 runtime.json → 页面可操作 → `stop.ps1` 按记录停止）。停止后 8000/5173 端口均无监听残留。

### 3.5 冻结契约的代码校验兜底

当前冻结清单（API 端点、settings schema、FTS schema、包裹格式）没有代码校验。建议复核时评估：是否在 CI 增加「API 端点快照对比」步骤（对 OpenAPI 路径集合做断言），把文档冻结升级为可执行校验。

执行结果：本次未实施（属改进项，不阻塞 Phase 7）。保留建议：进入 Phase 7 后接入 CI 时一并增加 OpenAPI 端点快照断言。

### 3.6 复核中发现与确认的行为（非缺陷）

- 文件树项由 `LeftSidebar.tsx` renderNode 渲染为 `div`（无 `title` 属性），自动化定位需按节点结构（span 文本 + `div.cursor-pointer`）而非 `aside [title]`；「最近」列表按钮才带 `title` 属性。此前的 6U checklist 以 `[title]` 定位实际命中「最近」列表。不影响用户操作。
- 外部直接写入 workspace 的文件需重建 FTS 索引后才出现在文件树（正常新建走 API 会即时索引）。搜索命中验证：搜正文「旧格式内容文字」命中，搜 `freeze-check` 不命中系连字符分词（FTS5 分词特性，符合 6E schema 2 设计）。
- 本次测试产生的 5 个拖拽上传附件（`Attachments/files/17*.txt`）与测试文档 `Articles/freeze-check-legacy.md` 已全部清理，测试后索引状态恢复（rebuild 后 8 文档 + 1 模块 + 0 附件）。

## 4. 通过标准

1. 第 1 节契约对账全部有明确结论：未破坏项直接确认；已修改项（信息块格式、`update_article` 响应）有兼容路径与单测覆盖。**满足**。
2. P1/P7/P8 三项待核对问题给出明确结论（已修复/保留/需处理）。**满足**（均已在 6U 期间修复，本次复核确认）。
3. 3.1 全量测试重跑通过，3.3 文件级迁移验证无数据丢失。**满足**（pytest 102 / vitest 62 / build 通过；迁移验证无丢失）。
4. 版本三同步校验一致，`npm run build` exit code 0。**满足**。

## 5. 结论

**本次冻结与稳定性检查通过，Phase 7 可以开工。** 冻结契约中仅信息块格式（atom → 包裹）与 API 端点（+1 附件删除）两项相对 6E 基线有变更，均有兼容路径且本次实测通过；6E P1-P10 全部有明确去向（P1/P2/P4/P7/P8 已修复、P3/P5 已清理、P9/P10 留给 Phase 7）；测试基线（102 pytest + 62 vitest + tsc/build）与浏览器 7 项核心路径抽测全部通过。进入 Phase 7 后按 `docs/phase7-prep.md` 执行顺序推进，其中 P10（test 脚本 + CI 接入）与 3.5 的端点快照断言建议在桌面化工程中一并落地。本次执行记录见 `CHANGELOG_DEV.md`。
