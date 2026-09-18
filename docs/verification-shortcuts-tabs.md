# 独立验证报告：项① 自定义快捷键 + Tab 栏（task-33）

- **验证者**：`verifier-attach`（独立对抗验证；不复述开发者自测）
- **验证时刻**：2026-09-18 17:48:22 → 17:49:48（+08:00），单批次完成
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），**git HEAD `6703f5d50baa7cb682001afef42a7c7d92eb4d4c`（`6703f5d`）**，`git status --porcelain` **为空**（干净）
- **验证对象**：task-29（项① 自定义快捷键）+ task-30（Tab 栏）+ task-35（ADP-1 收口 A/B/C）合并冻结态

## 0. 所验证的合并冻结 sha（跑前/跑后各复算一次，16 个文件全部一致 → 验证期间无变动）

| 文件 | sha256 |
|---|---|
| `state/shortcuts.ts` | `9577e3e3d27a9785df200bdaf2d999cd1fb0392ddaeab8b2d094a7f172163317` |
| `state/shortcuts.test.ts` | `cec7aa3fbf280bd64a8352a8e44e22feee8ae526890f34ff0e4e7fb1b629da83` |
| `App.tsx` | `2f69cad6a5e2d2fad4179fe9da13bde15e22033ed97359859e2f49dd2983da72` |
| `components/layout/EditorArea.tsx` | `8fa8cba677ca035e557b3fbbd64d6c7cc84f8b1f0cd1c279a563168b227a3ac5` |
| `components/layout/LeftSidebar.tsx` | `f52040bde56f73155697a480975a809e54ef3b31f8d86d5fa0eb79a04e282ba1` |
| `state/saveQueue.ts` | `09528318ae6d5948e85013846947e23f5f388669462e221eda7b3fabd5d33bfa` |
| `state/saveQueue.test.ts` | `8311c110b5037073972b7e66772bfb07fffb76efce97e1c725d1b5d37f3fd0d9` |
| `settings.ts` | `3c77288cb9309b1c5a0d254587d5ad499b4e7afeda28e258414c7887a5f398ba` |
| `settings.test.ts` | `7ced1dd761b1a271ad7f300cece242a7c67414a698451ccea8b257c449e1fd56` |
| `components/settings/SettingsPanel.tsx` | `3fa3a5c01de934f3c216d00aa5f23fb92867e78a29caddd150bcbc89d90f1d3f` |
| `components/settings/ShortcutsSection.tsx` | `f05ec3052f66c5fc0758e16959dc12c019e114b16b92f81781a627a85dd33105` |
| `components/settings/ShortcutsSection.test.tsx` | `865787801d60f5bcec42d1c3a8c67aaed3639964f93b967e0a4486ff9dde5b97` |
| `desktop/src-tauri/src/settings.rs` | `61ef14b1a138fa041d401c0667b5489abb571d25f76bb0a529ca6d910e27c41c` |
| `components/layout/TabBar.tsx` | `5f7afb48e26c3cd7a707163969d0ee0fe327e1a6c656bcebedd45bf5553653bf` |
| `components/layout/TabBar.test.tsx` | `f6dd3c0647f7e6fb3dcd3101277c8eb41303ac6be81062f195e3d00649fd8e9f` |
| **`state/shortcuts.verify.test.ts`**（本验证套件，42 例） | `9a34b4e23bbf5cb9b162a2c77dfa6d9bb2ea828d65b07a4b5cc02f63f7f91472` |
| **`components/layout/TabBar.verify.test.tsx`**（本验证套件，30 例） | `7085a1f72ad233a2aec02a52f569e763b64fca97fcfc299cbd7f35e30b97f749` |

Lead 提供的合并 sha 与我独立复算**逐字节一致**。

## 1. 结论摘要

| 段 | 判定 | 依据 |
|---|---|---|
| **S 项① 自定义快捷键** | **PASS** | 42/42 用例；既有键位零改动、空映射零副作用、三处同步、墓碑解绑、handler-only 分派、生产接线 |
| **T Tab 栏** | **PASS** | 30/30 用例；纯函数穷举（左优先）、组件语义、App 集成、T-4 数据安全（含对照实验）、G-2/G-3 |
| **回归底线** | **PASS** | `tsc` exit 0；全量 `48 files / 894 passed + 1 skipped / 0 failed`；`cargo test` 20 passed |

**未发现 FAIL**（本轮）。过程性「冻结被破」事件已由 Lead 裁定为 task-35 有意收口，并已按合并冻结态重跑（见 §4 归因）。

---

## 2. 实际命令与实际输出

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/state/shortcuts.verify.test.ts src/components/layout/TabBar.verify.test.tsx --reporter=verbose
npx vitest run
cd ../desktop/src-tauri && /mnt/f/Work/Dev/cargo/bin/cargo.exe test
```

| 命令 | 实际输出 |
|---|---|
| `npx tsc -b --noEmit` | `EXIT=0`（零输出） |
| 我的两套件 | `Test Files 2 passed (2)` / `Tests 72 passed (72)`（S 42 + T 30）/ `EXIT=0` |
| `npx vitest run`（全量） | `Test Files 48 passed (48)` / `Tests 894 passed | 1 skipped (895)` / `EXIT=0` |
| `cargo test` | `running 20 tests` → `test result: ok. 20 passed; 0 failed`（lib 20 + main 0 + doc 0） |

skip 恒为 1（`src/editor/perf-bench.test.ts` 既有 skip）。

---

## 3. S 组：项① 自定义快捷键（42 例）

### 3.1 分组与用例数

| 组 | 例数 | 覆盖 |
|---|---|---|
| S-0 既有默认键位不变动（源码级快照） | 5 | `MathShortcuts` 恰为 `Mod-n`/`Mod-m`（且 Mod-* 集合无新增）；`List/Note` 的 `Enter` + `priority:1000`；**menu.rs 六个加速键逐项绑定**（`MID_NEW=Ctrl+N` / `OPEN_WS=Ctrl+O` / `SETTINGS=Ctrl+,` / `EXIT=Ctrl+Q` / `RELOAD=Ctrl+R` / `DEVTOOLS=F12`）；既有 window keydown（`Ctrl+S`/`Ctrl+K`/`Escape`）；**Tiptap 版本锁 3.31.3** |
| S-1 归一化与解析 | 5 | `normalizeKeyName`（别名/F 键/方向键/Dead→null 等）；`parseKeySpec` 顺序无关+去重+固定规范序；拒绝非法；空白键语义；parse↔format 往返稳定 |
| S-2 键盘事件语义 | 4 | IME（`isComposing`/`keyCode 229`）无条件忽略；录制拒绝修饰键/裸字母/裸空格；`matchesKeySpec` 严格匹配；`platformCanonical` 平台展开 |
| S-3 保留键与冲突 | 5 | `RESERVED_KEYS` 覆盖 menu.rs 六键；`CAUTION_KEYS` 覆盖 Ctrl+S/Z/Y/F/K；保留键拒绝（**Ctrl+N 已知冲突文案**；`Mod+N` 在 Win 同键拒绝、mac 放行）；**平台等价判重**（`Ctrl+B`≡`Mod+B` on Win、`Cmd+B`≡`Mod+B` on mac）；覆盖内置→warn |
| S-4 三态/墓碑/屏蔽表 | 5 | `effectiveBinding` 四态；`resolveBindings` 跳过 `''`/`none`/未知/非法/**保留键（历史配置兜底）**；平台等价去重+确定性；`resolveSuppressedKeys`；**空映射既有键位逐个零消费** |
| S-5 三处同步与墓碑持久化 | 5 | TS 默认字段 ⊆ Rust `from_value_lenient` 白名单（含 `editor.shortcuts`）+ Rust 独有字段白名单；**门禁非空性探针**（抹掉 Rust 白名单分支 → 必须报缺失）；墓碑 `none`/`''` 经 `mergeSettings`+JSON 往返不变；键级合并不丢其它动作；`sanitizeShortcutsMap` 降级 |
| S-6 分派与动作执行 | 10 | 命中→preventDefault+stopPropagation+执行一次；录制态不消费；改键/解绑屏蔽旧内置键位；未命中零副作用；`runAction` handler 优先/注销回落；**无 stub 动作 + 未注册→`via:'none'` 安全降级（warnOnce 一次）**；`registerActionHandlers`（只收表内 id、未知 id warn、统一注销）；**doc.close 已定义/默认不绑定/可绑定/纳入保留键与冲突检测**；**源码守卫：无 `runActionViaDom`/`querySelector`/`DomEnv`** |
| S-6b 生产接线 | 3 | `settings.ts` 自动安装分发器；**空映射零副作用 / 改键即改即生效 / 单实例不重复执行**；幂等 noop；**ADP-1 收口不变量**（App/EditorArea/LeftSidebar 均用 `registerActionHandlers` 注册真实闭包，App 注册 `doc.next/prev/close`） |

### 3.2 Lead 指定关注点的独立结论

1. **「空映射 → 既有键位零变化」**：**PASS**。双层证据：① 直接 battery：15 组既有键位（Ctrl+S/K/B/I/U/Z/Shift+Z/Y/N/M/Shift+8、Ctrl+Alt+1、Escape、Enter、F5）在 `getBindings: () => ({})` 下 `handleShortcutKeydown` 全部返回 `null`，且 `preventDefault`/`stopPropagation` 零调用；② 生产接线：`settings.ts` 实际安装的分发器在默认缓存下对真实 `window` keydown 同样不 `preventDefault`、不执行任何动作。这与实现自述的「只对显式改过/解绑过的动作屏蔽其内置键位」一致（`resolveSuppressedKeys({})` 为空集）。
2. **平台等价比较**：**PASS**。`Ctrl+B`（录制值）与 `Mod+B`（目录默认）在 Windows 判为同一键 → 重复绑定拒绝；macOS 下二者不同键 → 不判重，而 `Cmd+B`≡`Mod+B` → 判重；`Mod+N` 在 Win 落入保留键（拒绝）、在 mac 放行且因撞内置默认为 warn。跨平台写法（`Mod`/`Ctrl`/`Cmd`/`Meta`）无漏判、无与保留键的误判。
3. **动作执行路径**：**架构已变** —— 冻结后的 `shortcuts.ts` **不含任何 DOM 适配层**（源码守卫断言 `runActionViaDom`/`querySelector`/`DomEnv` 均不存在），动作只能由 `registerActionHandler(s)` 注册的真实闭包执行；未注册 → `via:'none'` 安全降级 + warnOnce 一次（不抛错、不吞键）。故「DOM 过渡实现」相关旧结论作废（见 §4）。
4. **真机证据**：dev 做过 CDP 打包版实测（改键/解绑/重启持久）与**破坏性实验**（把工具栏 `title="加粗"` / `title="保存（Ctrl+S）"` 改成 SABOTAGED 后 `button[title="加粗"]` 计数为 0、快捷键仍生效）。我用**源码级交叉验证**支持该结论：`shortcuts.ts` 中 `querySelector`/`runActionViaDom` 出现次数为 **0**（命令与输出见 §6），即**不存在依赖 DOM title 的分派路径**；同时确认 `EditorToolbar.tsx` 仍各有 1 处 `title="加粗"` / `title="保存（Ctrl+S）"`（说明破坏实验的对象确实存在）。**真机部分仍属 dev 自测，未经我复现**（见 §7）。

### 3.3 附带发现（数据，非 FAIL）

- **Tiptap 实测版本 3.31.3**，而分析文档 `docs/analysis-1.1.10/shortcuts.md` §1.2.1 枚举内置键位时记录的是 **3.29.2** → 该文的内置键位清单需按 3.31.3 复核。我已把 3.31.3 锁进快照：任何依赖升级都会让用例变红，强制重新核对 `Mod-b/i/u`、`Mod-z` 等。
- `normalizeKeyName(' ')` 返回 `null`（`trim()` 先执行 → `''`），源码中 `if (t === ' ')` 分支**不可达**（死代码，行为无影响）。
- 错误文案「空格键需要与修饰键组合使用（建议 Ctrl+Space）」与实际行为不一致：`Ctrl+Space` **同样被拒绝**；独立空格亦不可绑定。属文案/行为不一致（非硬裁决项，未修）。

---

## 4. T 组：Tab 栏（30 例）

### 4.1 分组与用例数

| 组 | 例数 | 覆盖 |
|---|---|---|
| T-0 切档数据安全缝 | 2 | `docSwitch` 既有导出仍在；**顺序不变量**：快照 → `flushPending` → `cancelDraftTimer`（颠倒会串档） |
| T-1 纯函数（无 DOM 穷举） | 6 | `openTab` 去重/引用稳定；**`closeTab` 左优先**（中间→左邻、首个→右邻、最后一个→空态、非激活→激活不变、未知 id 原样）；`replaceTab` 原位保持顺序；`setTabTitle` 引用稳定；`adjacentTabId` 环绕/单标签/空/未知激活项 |
| T-2 组件（受控） | 8 | 空集合渲染 `null`；`role=tablist` + `overflow-x-auto` + `data-*` 钩子；原生 `button[role=tab][aria-selected]` 点击激活；脏标记唯一且带可访问名；关闭控件是**兄弟节点**、关闭不触发激活；**中键 `auxclick(button=1)` 关闭 + 中键按下阻止滚动**；DOM 合法性（无 button 嵌套）；`TabBarSlot` 无 provider → null |
| T-3 App 集成（源码级） | 6 | 非激活关闭**零文档请求**（`if (!isActive) return` 在切换调用之前）；激活关闭 `flushWithTimeout` → 确认 → 取消中止 / **确认则 `discardPending(id)` 且在切换之前**；`requestOpenArticle` 复用；**两条放弃入口共享 `discardPending`**；无标签不注册 `doc.next/prev/close`；标签集合不触任何写路径 |
| T-4 数据安全 | 5 | 放弃后不得再落盘（见 §4.2）；**机制核对白盒证据**；在途链结束条目清理不补写；**归因对照实验** |
| T-5 G-2/G-3 | 3 | `EditorToolbar` 无 `onOpenAttachments`；无「附件」title；`TabBarSlot` 槽位接线 |

### 4.2 T-4 对照实验（本次最有价值的证据）

**构造**：① A 有慢保存在途 → ② `flushWithTimeout(A,5)` = false（弹「放弃修改」确认的唯一条件）→ ③ **确认框期间再次 `enqueueSave('A', …)`**（模拟用户继续输入 re-arm `latest`）→ ④ 用户点「放弃」→ ⑤ 切档 effect `flushPending(A)`。

| 分支 | 实测 | 判定 |
|---|---|---|
| **修复后流程**（App 现调用 `discardPending(A)` = `cancelPending` + `abortPending`） | 保存调用次数 = **1**（零新增 PUT） | **PASS** |
| **归因对照**（不调用 `discardPending`） | 保存调用次数 = **2**（第 2 次写入必然发生） | 证明修复必要；并证明写入由**既有 `drain` 循环**驱动、**与切档 effect 无关** |

**机制核对（验证 Lead 原先根因链为错）**：`enqueueSave('M', slowFn, 0)` 调用返回时 `slowFn` **已被同步调用**（观测 `started===['M']`）→ 证明 `drain` 的 `while (e.latest !== undefined) { const fn = e.latest; e.latest = undefined; await fn(signal) }` **在首个 `await` 之前就取走并清空 `latest`**。因此 `flushWithTimeout` 超时返回 false 时 `latest` 已为空，切档的 `flushPending(prevId)` 只会 `return e.running`（等待既有在途链），**不产生新 PUT**。→ 「超时后 latest 仍在」这条根因**不成立**（详见 §5 DEL-1）。

### 4.3 口径更正

骨架原写「关闭激活标签 → 右邻优先」（浏览器惯例）；经 Lead 定调，契约与实现均为**左优先**（与 VS Code 一致）：`closeTab` 取 `i-1 >= 0 ? i-1 : 0`。本套件已按**左优先**断言（T-1 全覆盖），未按右邻判 FAIL。

---

## 5. 归因与更正记录

### 5.1 根因更正（DEL-1）

Lead 原先给出的机制链「`flushWithTimeout` 超时后 `latest` 仍在 → 切档 `flushPending` 会补写被放弃内容」**标记为错误更正**。依据（本套件白盒用例）：`drain` 在首个 `await` 前同步取走并清空 `latest`；超时后无新内容可 drain，`flushPending` 仅等待在途链。真实可达路径是**确认框期间再次入队**（`enqueueSave` re-arm `latest`），该路径已由 task-35 C 的 `discardPending` 修复，本报告以对照实验（1 次 vs 2 次调用）留证。

### 5.2 因 DOM 过渡层移除而作废的旧 S 组结论（3 条）

| # | 旧结论（针对 `78fa80db…`） | 现状 |
|---|---|---|
| 1 | 「DOM 过渡适配层可用：按 toolbar `title` 点击、合成内置键位（列表/标题）、合成 Ctrl+S/Ctrl+K」 | **作废**：`runActionViaDom`/`DomEnv`/合成按键整套已删除（ADP-1 收口），改为 `registerActionHandlers` 真实闭包 |
| 2 | 「已知限制：目标按钮 `disabled` 时适配层仍返回 `true`（动作实际未生效、用户无声无息）」 | **作废（问题消失）**：现无 DOM 依赖；未注册 handler → `via:'none'` + warnOnce 一次，不假报成功 |
| 3 | 「`doc.close` 集成缺口：App 已注册 handler 但动作表无定义 → 绑定不生效」 | **已修**：`doc.close` 已进入动作表（可绑定、默认不绑定、纳入保留键/冲突检测），本套件已加正向断言 |

另：**S 段旧版整体作废**——我针对 `78fa80db…` 的 43/43 结论不再有效；本报告全部结论基于 §0 的合并冻结 sha 重新跑出。

### 5.3 本次（合并冻结态）归因

| 类别 | 项目 | 说明 |
|---|---|---|
| 需求裁决 | 关闭激活标签**左优先** | 契约/实现一致，套件按左优先断言 |
| task-35 C 修复 | `discardPending` 接入两条放弃入口 | 我的 T-4 对照实验证明其必要性；修复后放弃→零新增 PUT |
| 既有（非本次） | 全量 1 个 skipped | `editor/perf-bench.test.ts` 既有 skip |
| 既有（非本次） | 空格键错误文案与行为不一致、`normalizeKeyName` 死分支 | 见 §3.3，数据类发现，未修 |
| 流程 | 冻结与在飞任务重叠（task-35 改动被冻结文件） | Lead 已确认为其流程失误并承诺避免；本报告按合并冻结态重跑 |

---

## 6. 真机破坏性证据的源码级交叉验证（加分项）

```
$ grep -cE "querySelector|runActionViaDom" frontend/src/state/shortcuts.ts
0
$ grep -c 'title="加粗"' frontend/src/components/editor/EditorToolbar.tsx
1
$ grep -c 'title="保存（Ctrl+S）"' frontend/src/components/editor/EditorToolbar.tsx
1
```

即：**子午线不存在「依赖 DOM title 的分派路径」**（`shortcuts.ts` 中相关符号 0 次），而破坏实验的对象（两个 title）确实存在 → dev 的真机观测「title 被改后快捷键仍生效」在机制上自洽。**真机部分为 dev 自测，我未复现**。

---

## 7. 未验证项声明（如实列出，不含推测）

| 项 | 原因 |
|---|---|
| **真机 / 打包版行为**（改键与解绑重启持久、CDP 破坏性实验、真实键盘焦点/输入法） | 属 dev 自测；我未在真机复现，仅在组件/纯函数/源码层交叉验证 |
| **确认框弹出期间用户能否继续输入编辑器**（T-4 可达性前提） | 依赖模态对话框的焦点/输入拦截行为，属 GUI 行为；机制路径已构造并验证，**可达性未在真机确认** |
| **App 端到端复现**（渲染整个 App + 真实编辑器 + 慢保存 + 弹窗交互） | 超出本任务回归面与写入边界；已用「saveQueue 缝级实验 + App 源码路径断言」替代 |
| **真实浏览器键盘激活语义**（如 Enter/Space 触发原生 button） | happy-dom 不合成键盘激活（前序任务已实测并留痕）；本套件只断言结构前提与 click 通路 |
| **跨进程/跨会话设置持久化** | 只验证到「设置 JSON 往返 + Rust 白名单/merge 语义」与前端缓存；真机落盘由 dev 自测 |
| **`Ctrl+N` 已知冲突在真机上到底由谁接管**（菜单加速键 vs 编辑器 `Mod+N`） | 分析文档标注为「机制推断，未在 GUI 实测」，我未构造真机探针 |

---

## 8. 复跑指引

```
cd "/mnt/f/Work/KE Project/knowledge-editor"
git rev-parse --short HEAD                      # 期望 6703f5d，且 git status --porcelain 为空
sha256sum frontend/src/state/shortcuts.ts frontend/src/App.tsx frontend/src/components/layout/TabBar.tsx
cd frontend
npx tsc -b --noEmit                                            # 期望 exit 0
npx vitest run src/state/shortcuts.verify.test.ts src/components/layout/TabBar.verify.test.tsx   # 期望 72 passed
npx vitest run                                                 # 期望 48 files / 894 passed + 1 skipped
cd ../desktop/src-tauri && /mnt/f/Work/Dev/cargo/bin/cargo.exe test                              # 期望 20 passed
```

**验证产物**：本报告 + `frontend/src/state/shortcuts.verify.test.ts`（42 例）+ `frontend/src/components/layout/TabBar.verify.test.tsx`（30 例）。
验证者全程**未修改任何源码**（仅写入上述两个测试文件与本报告）。
