# 独立验证报告：设置页左栏高亮修复（task-37 / task-38）

- **验证者**：`verifier-attach`（独立对抗验证；不复述开发者自测）
- **验证时刻**：2026-09-19 23:53:36 → 23:54:31（+08:00），单批次完成
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），**git HEAD `305e4297ad771a5736fff21eea2119ad9a9623b9`（`305e429`）**，`git status --porcelain` 仅 `?? SettingsPanel.verify.test.tsx`（本验证套件）
- **验证对象**：task-37「设置页左栏高亮失效」修复 + 追加修复（不可滚动反例 + 点击防闪）

## 0. 所验证的 sha（跑前/跑后各复算一次，完全一致）

| 文件 | sha256 |
|---|---|
| `components/settings/SettingsPanel.tsx`（冻结） | `226bdb921daff25e5bad773baa892f8ea099716ed6fb1db7726fa6eab531815c` |
| `components/settings/SettingsPanel.test.tsx`（冻结） | `322fd69b929c6bb78408bc71e6e8c0edb2004e37765679773309a699e9c4f7e3` |
| `components/settings/SettingsPanel.verify.test.tsx`（本验证套件，16 例） | `32fa168f0c4b289680983b29c23a5dd9283a0b6fd4e62d4975e7833cd432dbd3` |
| `state/shortcuts.ts`（对照：未被改动） | `9577e3e3d27a9785df200bdaf2d999cd1fb0392ddaeab8b2d094a7f172163317` |
| `App.tsx`（对照：未被改动） | `2f69cad6a5e2d2fad4179fe9da13bde15e22033ed97359859e2f49dd2983da72` |
| `components/layout/EditorArea.tsx`（对照：未被改动） | `8fa8cba677ca035e557b3fbbd64d6c7cc84f8b1f0cd1c279a563168b227a3ac5` |

Lead 给的冻结 sha 与我独立复算**逐字节一致**；三个「不得被改」的文件 sha 与 task-33 冻结态一致（`git status` 亦无改动）。

## 1. 结论摘要

| 项 | 判定 | 依据 |
|---|---|---|
| 四态（顶部/各段/触底/回顶回落）+ 点击四项 | **PASS** | V-1.1–3、V-1.7；回顶回落（原缺陷现象）已修 |
| **触底例外 load-bearing** | **PASS** | V-1.4：末段未越过参考线时靠例外点亮；并断言「无例外则为快捷键」对照 |
| 极窄窗口（视口 200px、内容 5200px） | **PASS** | V-1.5：四态仍正确，不会「永远高亮末段」 |
| **不可滚动（内容不足一屏）** | **PASS（本次修复）** | V-1.6 + V-5b.15：初始「常规」、点击四组跟随、scroll 不干扰 |
| 根因回归判别性 | **PASS** | V-2.8 克隆/重挂后按新节点高亮；V-2.9 本地复刻旧「缓存节点」算法在同构造下恒为「维护」 |
| 加载态 `ready` | **PASS** | V-3.10 加载期不注册/不抛错/高亮默认；V-3.11 ready 后**无需滚动事件**立即按当前位置同步 |
| `aria-current`（新增无障碍） | **PASS** | V-4.12：唯一且随滚动/点击跟随 |
| 点击防闪（700ms 有界抑制） | **PASS** | V-5.13 中途不闪回 + 到期复核 + 到期后跟随恢复；V-5.14 窗口有界、不永久滞留 |
| 其它功能区不回归 | **PASS** | V-6.16：四组内容仍在、主题切换仍走 `saveSettings` |
| 回归底线 | **PASS** | `tsc` exit 0；全量 **50 files / 920 passed + 1 skipped / 0 failed**（≥ 49 files / 900 passed） |

**本轮未发现残留 FAIL。** 我在上一轮（修复前）发现的 **FAIL①「不可滚动 → 高亮恒末段」** 已被 dev 修复并经我独立复验通过；**观察项②「点击后短暂闪烁」** 亦已按 Lead 裁决实现有界抑制并复验通过（详见 §4）。

## 2. 实际命令与实际输出

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/components/settings/SettingsPanel.verify.test.tsx --reporter=verbose
npx vitest run
```

| 命令 | 实际输出 |
|---|---|
| `npx tsc -b --noEmit` | `EXIT=0`（零输出） |
| 本验证套件 | `Test Files 1 passed (1)` / `Tests 16 passed (16)` / `EXIT=0`（含两条各约 0.89s 的 700ms 窗口用例） |
| `npx vitest run`（全量） | `Test Files 50 passed (50)` / `Tests 920 passed | 1 skipped (921)` / `EXIT=0` |

skip 恒为 1（`src/editor/perf-bench.test.ts` 既有 skip）。

## 3. 用例清单（16 例，按攻击面分组）

| # | 组 | 用例 | 判定 |
|---|---|---|---|
| 1 | V-1 四态 | 顶部 `scrollTop=0` → 「常规」 | PASS |
| 2 | V-1 | 滚到各段 → 「外观」/「快捷键」 | PASS |
| 3 | V-1 | 触底 → 「维护」；**回顶 → 回落「常规」**（原缺陷现象） | PASS |
| 4 | V-1 | 触底且末段**未越过**参考线 → 仍「维护」（例外 load-bearing + 无例外对照） | PASS |
| 5 | V-1 | **极窄窗口**（视口 200 / 内容 5200）四态正确，无「永远末段」 | PASS |
| 6 | V-1 | **不可滚动**（`scrollHeight === clientHeight`）→ 必须「常规」 | PASS（修复前 FAIL） |
| 7 | V-1 | 不可滚动时点击「常规」→ 「常规」 | PASS |
| 8 | V-2 判别性 | 四组节点**整体克隆替换**后仍按新节点位置高亮 | PASS |
| 9 | V-2 | 对照：本地复刻「缓存旧节点」算法 → 同构造下**恒为「维护」**（用例非空） | PASS |
| 10 | V-3 加载态 | `ready=false`：加载态、无分组节点、滚动不抛错不改高亮 | PASS |
| 11 | V-3 | `ready=true` 后**无需 scroll 事件**立即按当前位置同步 | PASS |
| 12 | V-4 无障碍 | `aria-current="page"` 唯一，随滚动/点击跟随 | PASS |
| 13 | V-5 防闪 | 点击「维护」：中途 scroll 不闪回；到期复核仍「维护」；**到期后跟随恢复** | PASS |
| 14 | V-5 | 窗口有界：抑制期内滚到别处 → 到期复核纠正为真实位置（不永久滞留） | PASS |
| 15 | V-5b | 不可滚动时初始「常规」+ 点击四组全跟随 + scroll 不干扰 | PASS |
| 16 | V-6 不回归 | 四组内容仍在 + 主题切换仍走 `saveSettings` | PASS |

**验证方法（须声明的边界）**：happy-dom **无布局引擎**，`getBoundingClientRect`/`clientHeight`/`scrollHeight` 全为 0。本套件用**受控几何**：容器顶部固定 48、参考线 = 48 + 24（与源码 `ACTIVE_LINE_OFFSET = 24` 一致）；四组相对容器顶部按 **Lead 真机实测** `[128, 592, 989, 3389]` 注入；`scrollTop/clientHeight/scrollHeight` 由测试注入并派发真实 `scroll` 事件驱动。**即：几何输入来自真机实测，但四态本身是在受控几何下验证的，不是我在 GUI 上跑出来的**（见 §5 未验证项）。

## 4. 缺陷发现 → 修复 → 复验留痕

### 4.1 FAIL①「不可滚动时高亮恒为末段」（我提出 → dev 修 → 我复验）

- **我的反例**：`scrollHeight === clientHeight`（内容恰好一屏、无滚动空间）且 `scrollTop=0` 时，`atBottom = scrollTop + clientHeight >= scrollHeight - 2` **恒真** → `current` 被强制为末段「维护」；且此时滚不动，没有任何滚动事件能纠正。
- **最小复现（组件级）**：几何 `{general:128, appearance:400, shortcuts:700, maintenance:950}`、`clientHeight = scrollHeight = 1200`、`scrollTop=0` → 打开设置，期望「常规」，实测「维护」（当时断言输出：`expected '维护' to be '常规'`）。
- **dev 修法**：引入 `scrollable = scrollHeight - clientHeight > 2`；**不可滚动时直接跳过滚动联动**（连参考线计算也跳过，高亮交给点击/初始值），`atBottom` 再加 `scrollable &&` 双保险。
- **我的复验**：用例 6（不可滚动 → 常规）+ 用例 15（不可滚动 + 点击四组全部跟随 + 反复 scroll 不改高亮）→ **PASS**；同时用例 3/4/5 证明**可滚动时触底例外仍生效**（没有为了修这条把例外删掉）。

### 4.2 观察项②「点击后短暂闪烁」（我记录 → Lead 裁决 → dev 实现有界抑制 → 我复验）

- **修复前实测序列**（我的采样）：点击「维护」后，平滑滚动中途的 scroll 事件会把高亮覆盖为中间分组（`维护 → 快捷键 → 维护`）。
- **dev 实现**：点击后开启 **700ms 有界抑制窗口**（忽略滚动驱动的高亮更新）+ 到期**强制复核一次**。
- **我的独立复现**：用例 13 —— 点击后按 `scrollTop = 300/700/1200/1800/2400/2800` 连续采样，序列**恒为「维护」**（不再闪回）；等待 850ms（>700ms）后复核仍为「维护」（此时滚动停在底部）；随后 `scrollTop=300` → 高亮恢复跟随为「常规」（**窗口有界、不永久滞留**）。用例 14 —— 抑制期内滚到 1200 时保持「维护」，到期复核纠正为「快捷键」。
- **取舍说明**：抑制窗口内用户主动用滚轮/滚动条滚动会被短暂忽略（≤700ms），到期即恢复跟随 —— 属可接受的取舍，且已被我以「到期复核纠正」用例覆盖。

## 5. 归因与未验证项

**归因**

| 类别 | 项目 | 说明 |
|---|---|---|
| 本次修复（已复验） | 不可滚动 → 高亮恒末段 | 由我提出反例、dev 修复；根因 = 触底例外在 `scrollHeight === clientHeight` 时恒真 |
| 本次追加（已复验） | 点击后短暂闪烁 → 700ms 有界抑制 | Lead 裁决「可接受但可优化」；到期强制复核保证不永久滞留 |
| 本次修复（原缺陷） | 缓存 DOM 节点导致 detached/rect 全 0 → 恒「维护」且回顶不回落 | 四态 + 克隆用例 + 旧算法对照共同证明修复有效且用例有判别性 |
| 既有（非本次） | 全量 1 个 skipped | `editor/perf-bench.test.ts` 既有 skip |
| 范围核对 | `shortcuts.ts` / `App.tsx` / `EditorArea.tsx` 未被改动 | sha 与 task-33 冻结态一致；`git status` 仅本验证套件未跟踪 |

**未验证项（如实列出，不含推测）**

| 项 | 原因 |
|---|---|
| **真机 / 打包版 GUI 四态** | 我**未启动 GUI、未跑 CDP**（主理人处于暂停打包状态，启动桌面应用会打开窗口干扰其环境）。四态的几何输入取自 Lead 的真机实测数据，但四态本身在受控几何下验证；dev 用打包版 exe + CDP 的真机复验**属其自测**，非我复现 |
| **真实滚动动画的时序**（平滑滚动 300–500ms 内 scroll 事件的真实频率/数量） | happy-dom 无渲染循环；我用离散采样点模拟中途事件（300/700/1200…）。抑制窗口 700ms 与真实动画时长的匹配度未在真机测量 |
| **真实布局下的极窄窗口/4K 缩放** | 几何为注入值；`clientHeight/scrollHeight` 的真实取值依赖窗口尺寸与缩放，未在真机扫描多种分辨率 |
| **字体/主题/无障碍读屏的真实表现** | `aria-current` 只做 DOM 语义断言，未跑读屏或对比度工具 |
| **设置页其它功能的完整回归** | 我只断言了四组内容存在 + 主题切换仍走 `saveSettings`；表单细节由 dev 的 `SettingsPanel.test.tsx`（10 例）与全量套件覆盖 |

## 6. 复跑指引

```
cd "/mnt/f/Work/KE Project/knowledge-editor"
git rev-parse --short HEAD                       # 期望 305e429
sha256sum frontend/src/components/settings/SettingsPanel.tsx frontend/src/components/settings/SettingsPanel.test.tsx
cd frontend
npx tsc -b --noEmit                              # 期望 exit 0
npx vitest run src/components/settings/SettingsPanel.verify.test.tsx   # 期望 16 passed
npx vitest run                                   # 期望 50 files / 920 passed + 1 skipped
```

**验证产物**：本报告 + `frontend/src/components/settings/SettingsPanel.verify.test.tsx`（16 例）。
验证者全程**未修改任何源码**（`SettingsPanel.tsx` / `SettingsPanel.test.tsx` 均未触碰）。
