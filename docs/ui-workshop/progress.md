# UI 创意工坊实施进度与证据台账

> 任务包：`astranota-ui-workshop-taskpack-2026-10-18`（sha256 zip `09969e62…52fa`，自校验 PASS）。
> 状态词：`todo / in_progress / passed / failed / blocked / deferred`；验收结果另用 `PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE`。

## 当前接手点

```text
日期/时区：2026-10-19 01:00 (Asia/Shanghai)
仓库/分支：knowledge-editor / feat/ui-workshop（基于 master v1.2.18）
HEAD（分支起点）：4c71233（v1.2.18）；overlay 提交：e54d37b
overlay patch SHA-256 / 状态：cfaebc7ac59e42d91ca23dc1c05e17f94d3f38b596aac415ad80a6c1d75eaa92 / APPLIED（README 手合并 3 行）
未提交改动摘要：无
基线差异：任务包基线 v1.2.16（9dd19e7）→ 实施基线 v1.2.18（4c71233，领先 18 提交）；
  verify_package 对原仓库报告 MIXED_OR_DIFFERENT_BASE；补丁对当前 HEAD 自动应用通过（README 除外）。
  v1.2.17（审查修复）/v1.2.18（导出回归修复）全部保留；参考报告中的 v1.2.16 数字仅作参考，
  所有验收在本基线上重跑。
OS / Node / Python / Rust / Tauri / WebView2：
  Windows 11 + WSL2（Ubuntu）；Node 24.19.0（CI 用 22，需在 lockfile/npm ci 上复核）；Python 3.14.4；
  cargo 1.97.1；Tauri v2 + WebView2 已在本机完成 v1.2.17/18 真机/安装包验收（W/I 证据可执行）。
Windows 实机可用性：可用（本机；通过 CDP/安装包实测过 v1.2.17、v1.2.18）。
本轮基线命令与结果（2026-10-19）：
  - frontend: npx tsc -b --noEmit → 0 错
  - frontend: npx vitest run --maxWorkers=2 → 108 files / 1617 passed + 1 skipped，exit 0
  - backend:  python3 -m pytest backend/tests -q → exit 0（全绿；数量见 evidence/T00-baseline.md）
已知失败归属：无新增；历史 v1.2.16 报告中「3 个 Linux 超长文件名失败」在当前基线未复现
  （参见 CHANGELOG_DEV v1.2.17：已随 CI 可移植性修复收敛）。
测试数据目录：临时目录/沙箱（C:\ke-tmp\ke-sandbox 等）；禁止真实笔记。
当前里程碑状态：P0 进行中（T00 in_progress）
```

## 任务进度

| Task ID | 状态 | 实现提交/文件 | 验收 ID 与证据 | 剩余问题 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| T00 | in_progress | e54d37b（overlay）、scripts/ui-workshop/{sandbox-env,collect-env,bench}.sh/ps1、docs/ui-workshop/fixtures/、tools/make_fixtures.py | evidence/T00-baseline.md、evidence/T00-measurements.md、evidence/env-*.txt | 两 shell 预热/内存/切换、Windows 侧启动与 PDF 基线尚未采集 | Windows 测量脚本 + 数据采集 |
| T01 | in_progress | tools/build_feature_baseline.py、feature-baseline.csv（130 行种子）、fixtures/、known-failures.md | CSV 生成自源码（shortcuts/API/toolbar/settings/menu/验收域）；officialBaselineResult 均 NOT_RUN | 需逐项真实入口核对并填结果（130 行），补 packA/B 入口列 | 逐域核对 F01–F16 → 填 result；再谈 W01+ |
| T02–T06 | todo | T02: s1_runtime/；T03: s2_editor/；T04: s3_save/；T05: s4_print/ + s1_runtime/print_proto.rs；T06: s5_txn/ | evidence/P0-S1-prototype.md（iframe 23/25）、P0-S1b-windows-probe.md（child WebviewWindow **10/10**）、P0-S2-prototype.md（WebView2 换壳 **10/10**）、P0-S4-prototype.md（WebView2 真实 PDF **6/6**）、S3/S5 双平台 10/10 | T02 尚缺 capability 文件级 scoping/自定义协议来源；T03 未覆盖产品 NodeView/MathLive/真实 IME；T05 未接真实 session revision/隐藏窗口/长文档；T04/T06 未接入真实后端/运行时 | capability scoping + 自定义协议来源；S2/S4；T07 ADR |
| T07 | todo | | | | 路线 ADR |
| T08–T28 | todo | | | | 按 TASKS.md 依赖推进 |

## 单项验收记录

（格式见任务包 REPORT_TEMPLATE.md；随任务推进追加）

## 路线 ADR

见 `docs/ui-workshop/adr/`；已记录 ADR-000（实施基线选择）。

## 本轮交付（2026-10-19，T00/T01 种子）

- `scripts/ui-workshop/sandbox-env.sh|.ps1`：隔离测试数据目录（KE_WORKSPACE/KE_APP_CONFIG/LEGACY/WebView2 user data）
- `scripts/ui-workshop/collect-env.sh` → `evidence/env-*.txt`：环境快照
- `scripts/ui-workshop/bench.sh` → `evidence/T00-measurements.md`：
  tsc 19.7s / build 21.9s（dist-build 2,830,583 B）/ backend health 805ms（隔离目录）
- `docs/ui-workshop/tools/make_fixtures.py` → `fixtures/`：basic.md、large-256kb.md、
  large-512kb.md、附件占位、fixtures-manifest.json（5 files，确定性可复现）
- `docs/ui-workshop/tools/build_feature_baseline.py` → `feature-baseline.csv`：
  130 行种子（快捷键动作 42 / API 路由 / 工具栏 / 设置 / 原生菜单 / 导出与对话框 / F01–F16+W 验收域）
- `docs/ui-workshop/known-failures.md`：当前无新增失败；历史 3 条登记且本基线未复现

## P0 原型进展（2026-10-19）

- **S5 包/私有状态原子事务（T06 部分）**：`prototypes/p0/s5_txn/` 完成不可变安装
  （路径穿越/zip bomb/篡改/同版本改字节拒绝）、单提交点激活（journal→fsync→os.replace）、
  崩溃恢复（4 个提交点进程终止用例）、回滚不动 Core 笔记、私有状态隔离与迁移回调；
  Linux WSL + Windows Python(NTFS) 各 10/10 通过。证据：`evidence/P0-S5-prototype.md`。
  未验证：真实运行时/包格式/Tauri/Rust 指针（留给 T17–T20）。

## P0 原型进展（续 2026-10-19）

- **S3 保存垂直切片（T04 部分）**：`prototypes/p0/s3_save/` 完成
  可信快照（全文+revision+磁盘指纹）→ 保存三阶段（accepted/recovery_durable/file_durable）→
  revision CAS、外部改盘冲突、切库 epoch 迟到写拒绝、两工作区同相对路径隔离、
  requestId 幂等 + queryResult、崩溃三阶段恢复（恢复日志后/正文写入后/提交后）且
  恢复不覆盖外部新内容；Linux WSL + Windows Python(NTFS) 各 10/10 通过。
  证据：`evidence/P0-S3-prototype.md`。未验证：真实 FastAPI/WorkspaceContext（T09）、
  真实 Core 与 UI 网络时序（T10/W02）。

## P0 原型进展（S1 实机，2026-10-19）

- **S1 运行域/命令面/原生恢复（T02 部分，Windows/WebView2 实机）**：
  迷你 Tauri 原型（独立 identifier）验证：sandbox iframe（opaque origin）无法访问宿主 DOM、无法导航顶层、
  无法跨源 fetch 后端/宿主、写请求无副作用；**opaque origin 的 Tauri invoke 被拒**（`Origin header is not a valid URL`）。
  **发现**：iframe 继承宿主 Tauri 初始化脚本（`__TAURI_INTERNALS__`/`__TAURI__` 可见），且
  `allow-same-origin` 同源对照 iframe 的 invoke **成功** → 隔离边界是 Origin，iframe 不能当安全边界。
  Rust 原生恢复状态机实测：坏启动崩溃 ×2 → safe mode（Rust 写状态）→ 显式恢复，真实进程 `exit 99` 驱动。
  证据：`evidence/P0-S1-prototype.md` + `P0-S1-probe-results.json`。
  下一步：child WebviewWindow + capability/ACL 精确匹配原型（T02b），再决定 iframe/独立窗口路线（T07 ADR）。

## P0 原型进展（S1b child WebviewWindow，2026-10-19）

- **S1b（T02 续，Windows/WebView2 实机 10/10）**：child WebviewWindow 对照实验：
  - 同源 guest 窗口（http://tauri.localhost）：app 命令全局可达（whoami 返回 guest label；未守卫写命令成功）
    → 证明 **app 命令默认对所有 webview 可见**；label 守卫命令被拒（防御原型生效）；
    且同源 guest 可**直连后端 loopback**（`ok:200`）→ 同源包运行域不可用于不受信包；
  - 独立来源 guest 窗口（http://127.0.0.1:8123）：Tauri ACL 拒绝 app 命令（`Command ... not allowed by ACL`）、
    后端 CORS 拒绝 loopback（`blocked:TypeError`）、零副作用 → **独立来源窗口具备默认 IPC 隔离**；
  - 工程坑记录：command handler 内同步 `WebviewWindowBuilder::build()` 会死锁，窗口须在 Rust setup/主线程创建。
  证据：`evidence/P0-S1b-windows-probe.md` + `P0-S1-windows-probe-results.json`。
  下一步：capability 文件级 scoping + 自定义协议来源（离线包）实验，随后 T07 ADR 定运行域。

## P0 原型进展（S2 持续编辑面，2026-10-19）

- **S2（T03 部分，WebView2 实机 10/10）**：`s2_editor/harness.ts` 在真实 WebView2 内创建单个 Tiptap Editor，
  挂 shell A → 编辑/记录 → **只移动 view.dom** 到 shell B → 断言 view/DOM 身份、正文、undo/redo、焦点、
  synthetic composition、源码草稿保持；再移回 shell A 二次断言。结果经 Tauri `report_results` 落盘。
  证据：`evidence/P0-S2-prototype.md` + `P0-S2-probe-results.json`。
  限制：最小 StarterKit、无产品 React NodeViews/MathLive、synthetic IME、两 shell 为 vanilla 容器（真实两框架 T24）。

## P0 原型进展（S4 独立打印，2026-10-19）

- **S4（T05 部分，Windows/WebView2 真实 PDF 6/6）**：`print_proto.rs`（产品 print.rs 简化移植：对指定
  renderer 窗口 PrintToPdf）+ `s4_print/harness.ts`（内存 session 快照 → 只读 HTML：未保存标记/
  KaTeX 行内+根号公式/表格）→ 真实 PDF **90,002 B / 1 页**，PyMuPDF 文本校验含 `UNSAVED-SNAPSHOT-MARK`
  与公式排版文本；打印**不隐式保存**（临时源笔记 sha256 不变），输出在系统临时目录。
  证据：`evidence/P0-S4-prototype.md` + `P0-S4-probe-results.json`。
  限制：快照未接真实 EditorSession revision、单页、未测隐藏窗口/长文档/图片附件/主题，留 T16。
- **P0 五原型全部完成**（S1/S1b 运行域+恢复、S2 持续编辑面、S3 保存垂直切片、S4 独立打印、S5 事务）。
  下一步：**T07 路线 ADR + P0 阶段报告**，然后进入 P1（T08 codec → T09 WorkspaceContext → T10 Core）。
