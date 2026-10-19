# P5-T26 W07 扩展证据：guest 内存压力 / CPU 压力 — 产品 W 21/21 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2 `Edg/155.0.4283.62`（隔离产品构建 + workshop 协议 guest）
- 工具：`tools/run_t26_fault_mem_probe.py`（新增；隔离 `APPDATA`/工作区、预置 app_config/settings
  自动打开工作区、workshop 签名包、CDP、按路径白名单清理）
- 原始结果：`evidence/T26-W07-mem-results.json`（含 21 条原始 checks + 全量 metrics）
- 证据类型：**W（真实产品 guest/host 进程行为；故障注入仅用 CDP 测试工具，见 §4）**
- 环境：测试构建 `C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256 `c5781adf…3332f`，mtime 2026-10-19 08:20，
  git HEAD `a62961b`）；宿主内存 32273MB（运行前空闲 10061MB）；Python 3.14.7；用户 App 未运行（影响 N/A）。
- 复现（WSL）：
  ```bash
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
    \$env:PYTHONIOENCODING='utf-8'; & 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' \
    -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_fault_mem_probe.py' --scenario all"
  ```
  （`--scenario mem|cpu` 可分场景复跑；本轮 `all` 单次运行 2 场景，合计 21/21。）

## 1. 结论（如实口径）

- **内存压力类别（场景 a）：W 11/11 PASS。** guest 在独立 renderer 内累计分配 **2048MB**（32×64MB 分片，
  逐页触碰提交；耗时 3.3s，0 次 allocation 失败），期间宿主 IPC 仍可响应（13 次采样，最大 **3.6ms**，
  0 超时）；guest renderer 工作集 52.1MB → **2109.5MB（+2057.4MB）**；会话保持 active 且心跳持续。
  随后注入 renderer 崩溃 → 心跳中断，宿主 **1.0s** 检出 suspended（t=7.281s），连续超限 **failed + safeMode
  UI**（t=9.863s），停用 guest → **stopped 持久化**；宿主进程存活、guest renderer 进程消失（内存释放）。
- **CPU 压力类别（场景 b）：W 10/10 PASS。** guest 以 40ms 分片 setTimeout 链满载 6.0s（独立 renderer
  CPU **4.78s / 墙钟 5.96s ≈ 0.80 core**），期间宿主 IPC 最大 **2.5ms**、0 超时，心跳 14 次、会话保持
  active（未误判）；随后 2500ms 长任务链饥饿事件循环（> 1200ms 心跳阈值），宿主在 **1.6s** 内检出
  suspended，连续超限 → **failed + safeMode**，停用 → **stopped 持久化**；宿主存活。
- 两个类别均复现既有结论：**跨域 sandbox iframe guest 位于独立 renderer（OOPIF），guest 侧压力/崩溃
  未阻塞宿主主渲染进程**；心跳检测 → 恢复策略 → 用户可停用的链路可用。
- **W07 仍为「部分通过」**：本证据只补了 CPU/内存压力两个类别；`boot crash / 桥接超时 / 连续启动失败 /
  原生 Rust 恢复 / I 门禁` 仍未验证（见 §4）。

## 2. 场景 a：guest 内存压力（11/11 PASS）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| W07M-1 安装签名包（内存压力包） | PASS | active=1.0.0 |
| W07M-2 guest 启用并心跳流动（active） | PASS | hasSession=true，state=active |
| W07M-3 持续分配达目标（≥1.5GB，无 allocation 失败） | PASS | **2048MB / 32 tick / 0 失败 / 3300ms** |
| W07M-4 压力期间宿主 IPC 仍可响应（无超时 <2000ms） | PASS | 13 采样，max **3.6ms**，p95 3.6ms，超时 0 |
| W07M-5 压力期间会话保持 active（心跳持续，无误判） | PASS | state=active，心跳 8→16 |
| W07M-6 独立 renderer 可观测内存增长（≥1200MB） | PASS | WS 52.1MB → **2109.5MB（+2057.4MB）** |
| W07M-7 renderer 崩溃后心跳中断被检测 | PASS | 注入 t=6.278s → suspended t=7.281s（**≈1.0s**） |
| 连续超限 → failed + safeMode（宿主恢复策略） | PASS | failed t=9.863s，UI 含 `safeMode：guest 已禁用` |
| 停用 guest → stopped 持久化 | PASS | state=stopped（落盘 `workshop-session-status.json`） |
| 宿主进程存活 | PASS | alive=true；guest renderer pid 已消失 |
| 用户实例未被触碰 | PASS | N/A（用户 App 未运行，只读确认 before/after 均空） |

时间线（相对 stress start）：`active → (2GB 分配 3.3s，压力窗口宿主响应) → 保持 1.5s → 注入 Page.crash →
+1.0s suspended → +3.6s failed + safeMode → 停用 stopped`。

额外观测（metrics）：宿主进程树 WorkingSet 基线 723.8MB → 停用后 692.9MB；renderer 崩溃后进程列表中
guest pid 消失（内存释放）；无自然 allocation 失败、无自然 OOM 崩溃。

## 3. 场景 b：guest CPU 压力（10/10 PASS）

| 检查 | 结果 | 实测 |
| --- | --- | --- |
| W07C-1 安装签名包（CPU 压力包） | PASS | active=1.0.0 |
| W07C-2 guest 启用并心跳流动（active） | PASS | hasSession=true，state=active |
| W07C-3 负载期间宿主 IPC 仍可响应（无超时 <2000ms） | PASS | 9 采样，max **2.5ms**，超时 0 |
| W07C-4 负载期间心跳正常、会话 active（无误判） | PASS | 负载窗口 6.0s，心跳 +14，state=active |
| W07C-5 guest CPU 压力可观测（≥0.5 core） | PASS | **4.78 CPU 秒 / 5.96s ≈ 0.80 core**（独立 renderer pid） |
| W07C-6 长任务饥饿 → 心跳超时被检测 | PASS | starve t=6.462s → suspended t=8.064s（**≈1.6s**，阈值 1200ms） |
| 连续超限 → failed + safeMode（宿主恢复策略） | PASS | failed t=10.256s，UI 含 safeMode 横幅 |
| 停用 guest → stopped 持久化 | PASS | state=stopped |
| 宿主进程存活 | PASS | alive=true |
| 用户实例未被触碰 | PASS | N/A（用户 App 未运行，只读确认） |

说明：CSP `default-src 'none'` 阻断 worker（W06 已功能级验证），故 CPU 压力用 setTimeout 分片链实现；
阶段 1 单片 40ms < 心跳阈值 → 不误判；阶段 2 长任务 2500ms > 阈值 → 自然心跳超时，非人工停跳。

## 4. 覆盖边界 / 缺口（不夸大）

1. **自然 OOM 未触发**：本机 32GB 内存、运行前空闲约 10GB，2GB 分配在 guest 独立 renderer 内正常完成
   （0 次 allocation 失败、无崩溃）。**场景 a 的 renderer 崩溃是用 CDP `Page.crash` 对 guest target 注入的
   测试故障**（等效 OOM 被杀后的崩溃路径：心跳中断 → 宿主检测 → 恢复），不是自然 OOM；真实内存耗尽
   （需把分配推高到数 GB～10GB，可能危及宿主/同机其它进程）未纳入本轮。
2. **依赖实现细节**：宿主/guest 独立性来自 WebView2 对跨域 sandbox iframe 的 site isolation（OOPIF，
   guest `http://workshop.localhost` 独立 renderer）。W07 无限循环与本轮压力均依赖该行为，
   Tauri/WebView2 升级后需复跑（与 `P5-T26-W07-fault.md` 同口径）。
3. **CDP 为测试工具**：Page.crash 注入只出现在探针中，非产品能力；产品路径仍是「心跳超时 → 连续超限 →
   failed + safeMode → 停用」。
4. **W07 其余子项仍 NOT_RUN**：boot crash、桥接超时、连续启动失败、原生 Rust 恢复、I 门禁未验证；
   CPU 压力也未覆盖多核并行（worker 被 CSP 阻断，只能单 renderer 单线程负载）。
5. **用户实例**：本轮用户 App 未运行 → 用户影响判定为 N/A（只读查询 before/after 均为空；未启动/未杀用户实例；
   测试进程清理只按 `C:\ke-tmp\uiws-t26\bin\*` 与 `F:\Work\Dev\cargo-target\*` 路径白名单）。

## 5. 判定

- 内存压力 / CPU 压力两个故障类别：**产品 W 通过（11/11 + 10/10）**，宿主独立性 + 心跳检测 +
  safeMode 恢复 + 停用持久化均实测成立。
- W07 条目整体：**部分通过**（无限循环 8/8 + 内存 11/11 + CPU 10/10；其余子项与 I 门禁未验证），
  不改变 `EXPERIMENTAL_TRUSTED_PACKS` 里程碑结论。
