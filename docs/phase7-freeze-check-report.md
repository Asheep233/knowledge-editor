# Phase 7 前冻结与稳定性检查报告

> 阶段：7（冻结复核） | 日期：2026-08-10 | 冻结基线：v0.6.0（Phase 6E） | 复核基线：v0.7.3（Phase 6U 完成态）
> 范围：按 `docs/phase7-prep-freeze-check.md` 的检查标准与通过标准，对 6E 冻结契约与 6U 之后的代码状态做基线对账与稳定性验证，作为 Phase 7（Tauri 桌面化）开工前的最后一道闸门。

## 1. 检查概述

本次检查**通过**，Phase 7 可以开工。检查覆盖四项：冻结契约对账（8 项）、6E 遗留问题对账（P1-P10）、测试基线重跑（pytest / vitest / tsc / build）、浏览器端核心路径抽测（7 项）。所有项均有明确结论：契约中仅信息块格式与 API 端点两项相对 6E 基线有变更，均带兼容路径且实测通过；102 后端测试、62 前端测试、tsc 与生产构建全部通过；浏览器 7 项抽测全部通过；启动/停止两条链路实测通过。检查中未发现产品级缺陷，确认 3 条既有行为（非缺陷）。

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 冻结契约对账（8 项） | 通过 | 2 项契约变更（信息块格式、API 端点），均有兼容路径；其余保持 |
| 6E 遗留 P1-P10 对账 | 通过 | P1/P2/P4/P7/P8 已修复，P3/P5 已清理，P9/P10 留给 Phase 7 |
| 测试基线重跑 | 通过 | pytest 102/102、vitest 62/62、tsc + build exit 0 |
| 浏览器核心路径抽测 | 通过 | 7/7（旧格式迁移、包裹往返、两种脚注、保存元信息、拖拽附件） |
| 启动/停止链路 | 通过 | stop.ps1 兜底与正常路径、start.ps1 一键启动均实测 |
| 环境性修复稳定性 | 通过 | dev 预构建正常、build 走 esbuild 改名副本成功 |

## 2. 检查标准与方法

检查标准来自 `docs/phase7-prep-freeze-check.md`，通过标准共 4 条：契约对账全部有明确结论；P1/P7/P8 待核对项给出结论；全量测试重跑通过且文件级迁移验证无数据丢失；版本三同步一致且 `npm run build` exit code 0。

执行环境：Windows 本机，backend 为 `backend\.venv`（Python + FastAPI），frontend 为 Vite dev server（经 `ke-vite.mjs` 启动），浏览器抽测使用真实 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）+ playwright-core 驱动。数据兼容验证采用真实文件级方式：手工构造旧格式 .md 写入 `workspace/Articles/`，经主应用打开、保存后直接读取落盘文件断言。测试产物（测试文档与拖拽上传附件）在检查完成后已清理。

## 3. 冻结契约对账

| # | 冻结项（6E 基线 v0.6.0） | 复核结论 |
| --- | --- | --- |
| 1 | API 42 端点清单（v1 无前缀，`/api/*`） | 与 6E 清单逐项比对，46 项一致；仅 attachments 新增 1 个 `DELETE /api/attachments/{rel_path}`（v0.6.1 孤儿附件手动删除引入，前端 `client.ts` 有对应封装），属增量扩展（只增不减）。`update_article` 响应扩展为完整元信息（v0.7.3），浏览器端实测属性面板正确消费，无调用方依赖旧瘦结构 |
| 2 | 信息块 Markdown 格式：atom 自闭合 | **契约已修改**：v0.7.0 冻结为包裹格式 `<!-- ke-note: {json} -->\n内容\n<!-- /ke-note -->`，新格式为新的冻结基线；旧格式读取兼容（parseHTML 双规则 + `Fragment.fromJSON` 迁移）有单测覆盖，本次真实文件级迁移验证通过（见第 6 节 A 项） |
| 3 | Markdown 扩展版本 ke_version = 1 | 保持 |
| 4 | settings schema 1 / FTS schema 2 | 保持；索引重建（`/api/index/rebuild`）实测 8 文档 + 1 模块 + 3 附件 |
| 5 | 版本三同步（`__init__.py` 唯一来源 + `version.ts` + `package.json`） | v0.7.3 三处一致（逐一读取确认）；`start.ps1` 对不一致告警 |
| 6 | 构建链路 | dev/build 均实测走 `ke-vite.mjs`（esbuild 改名副本 + `ESBUILD_BINARY_PATH`）成功；`cacheDir` 位于 `../workspace/.knowledgeeditor/vite-cache` |
| 7 | 停止链路 | 兜底路径实测成功：无 runtime.json 的遗留 backend（8000，`uvicorn app.main:app`）与 vite（5173，`vite.js`）被端口+命令行特征识别并 `taskkill /PID /T /F` 停止 |
| 8 | 快照/草稿格式 | `Drafts/backup/{doc_rel}/{YYYYMMDD-HHMMSS-mmm}.md` 30 份、`Drafts/recovery/*.draft.md`，6U 未改动，保持 |

## 4. 6E 遗留问题（P1-P10）对账

| # | 问题 | 复核结论 |
| --- | --- | --- |
| P1 | 恢复点登记链路缺失 | 已修复：`EditorArea.tsx` 自动保存与手动保存均调用 `registerRecoveryPoint` 登记恢复点 |
| P2 | `config.py` 死常量 `APP_VERSION` 漂移 | 已修复（常量删除，版本唯一来源收敛到 `__init__.py`） |
| P3 | 调试探针与临时产物残留 | 已清理 |
| P4 | `routers/__init__.py` 的 `__all__` 漏 5 模块 | 已修复 |
| P5 | `fs_watch.py` 死函数、`import_export.py` 未使用 import | 已清理 |
| P6 | 架构文档与代码差异 | 未改写 HTML；以 6E 报告为冻结基线（记录在案） |
| P7 | App 顶栏徽章 "Phase 4" 滞后 | 已修复：`App.tsx` 徽章现显示 "Phase 6"，与当前阶段一致；进入 Phase 7 后再更新 |
| P8 | `clearRecentDocuments` 封装无调用方 | 已修复：`LeftSidebar.tsx`（"最近" 区「清空」按钮）已调用 |
| P9 | `ke.ts` 与 `client.ts` 重复 `attachmentUrl` | 未修复，留给 Phase 7 侧车封装时合并（`docs/phase7-prep.md` 2.4） |
| P10 | `package.json` 无 test 脚本；`dist/` 残留 | 未修复，Phase 7 工程中补 `vitest run` 并接入 CI |

## 5. 测试基线重跑

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 后端 | `backend\.venv\python -m pytest -q` | 102/102 通过（1 条 Starlette 弃用警告，非失败） |
| 前端 | `npx vitest run` | 62/62 通过（6 个测试文件） |
| 类型检查 + 构建 | `npm run build`（`tsc -b` + `ke-vite.mjs build`） | tsc 零错误；`✓ built in 9.82s`；exit code 0；JS 1.94 MB、CSS 73.65 KB，与 6U 基线一致 |

构建日志确认走 `ESBUILD_BINARY_PATH=D:\Agent\KnowledgeEditor\frontend\.esbuild\esbuild-renamed.exe`，白屏修复在构建路径上稳定（仅 chunk > 500 kB 体积提示，非失败）。

## 6. 浏览器端核心路径抽测

真实 Chrome 驱动，7 项全部通过：

| # | 场景 | 断言与结果 |
| --- | --- | --- |
| A1 | 旧自闭合格式文档打开渲染（3.3 文件级验证） | 信息块 DOM（`data-ke-note`）存在、块内「旧格式内容文字」可见、0 页面错误 |
| A2 | 保存后落盘格式与内容完整性 | 落盘为包裹格式 `<!-- ke-note: {"kind":"note","id":"n1","title":"要点","color":"yellow"} -->` + 块内文本 + `<!-- /ke-note -->`；原 `content` 属性被移除；正文段落无丢失 |
| B1 | 包裹格式 markdown 往返 | `setContent(包裹格式)` → `getMarkdown()` 保留 `ke-note` 包裹标记与块内内容，往返一致 |
| C1 | 脚注 block 样式 | 正文上标 + 文末脚注区（`ke-footnotes:start` 标记）正确生成 |
| C2 | 脚注 plain 样式 | 正文上标 [n] + 文末 `# 参考` 段正确生成 |
| D1 | 保存后属性面板元信息（v0.7.3 回归） | 创建时间不变、修改时间更新（01:24:24 → 01:24:31）、字数/大小非「—」 |
| E1 | 拖拽文件插入附件 | 构造 DataTransfer 模拟 drop，文件上传后 `attach` 节点进入文档 |

## 7. 启动/停止链路与环境性修复

`start.ps1` 一键启动实测通过：health 握手返回 version 0.7.3，runtime.json 写入，`/` 与 `/repro.html` 均 200（dev server 冷启动依赖预构建正常产出，无白屏）。`stop.ps1` 两条路径实测：兜底路径（检查前发现无 runtime.json 记录的遗留 backend 8000 与 vite 5173 进程，按端口+命令行特征识别并整树停止）与正常路径（按 runtime.json 记录停止）均成功，停止后 8000/5173 无监听残留。环境性修复（esbuild 改名副本）在 dev 与 build 两条路径均稳定；CI 无安全软件场景预计无需副本，Phase 7 打包机待实际环境复验。

## 8. 确认的既有行为（非缺陷）

- 文件树项由 `LeftSidebar.tsx` renderNode 渲染为 `div`（无 `title` 属性），「最近」列表按钮才带 `title`；自动化定位需按节点结构（span 文本 + `div.cursor-pointer`），此前的 6U checklist 以 `aside [title]` 定位实际命中「最近」列表。不影响用户操作。
- 外部直接写入 workspace 的文件需重建 FTS 索引后才出现在文件树（正常新建走 API 会即时索引）。搜索命中验证：搜正文「旧格式内容文字」命中，搜 `freeze-check` 不命中系连字符分词（FTS5 分词特性，符合 6E schema 2 设计）。
- 浏览器抽测初期 3 项未过均为测试脚本自身问题（文件树定位选择器、脚注断言标记、文件树刷新时序），修正后通过，未发现产品级 bug。

## 9. 通过标准判定

1. 契约对账全部有明确结论，已修改项（信息块格式、`update_article` 响应）有兼容路径与单测覆盖：满足。
2. P1/P7/P8 待核对项给出明确结论（均在 6U 期间已修复）：满足。
3. 全量测试重跑通过，文件级迁移验证无数据丢失：满足。
4. 版本三同步一致，`npm run build` exit code 0：满足。

## 10. 结论与建议

**本次冻结与稳定性检查通过，Phase 7 可以开工。** 相对 6E 基线仅有两处契约变更且均有兼容路径实测通过，6E 全部遗留问题去向明确，测试基线无回归，浏览器核心路径无缺陷。进入 Phase 7 后建议两件事随桌面化工程一并落地：补 `package.json` 的 `vitest run` 脚本并接入 CI（P10），同时在 CI 增加 OpenAPI 端点快照断言，把「以文档维护的冻结清单」升级为可执行校验。执行顺序与准备项见 `docs/phase7-prep.md`。

## 附：执行记录

| 项 | 记录 |
| --- | --- |
| 执行日期 | 2026-08-10 |
| 测试产物 | `Articles/freeze-check-legacy.md`（旧格式验证文档）、5 个拖拽上传附件（`Attachments/files/17*.txt`），均已删除；索引重建后恢复（8 文档 + 1 模块 + 0 附件） |
| 环境恢复 | 服务已停止（`stop.ps1`），8000/5173 端口无残留；`runtime/logs/` 日志正常写入 |
| 执行记录文档 | 结果回填 `docs/phase7-prep-freeze-check.md`；本次执行记入 `CHANGELOG_DEV.md`（Test） |
