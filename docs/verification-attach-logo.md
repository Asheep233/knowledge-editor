# 独立验证报告：附件区改造（task-9 / task-11）+ Logo 替换（task-10）

- **验证者**：`verifier-attach`（独立对抗验证，非开发者自测复述）
- **验证时刻**：2026-09-15 19:50:24 → 19:51:50（+08:00），均在同一批次内完成
- **仓库**：`/mnt/f/Work/KE Project/knowledge-editor`（WSL），git HEAD `50e44df860b858b36f5bab5109b8190546ac9801`（`50e44df`）
- **工作区状态**（验证时）：` M frontend/src/components/layout/RightPanel.tsx`、`?? RightPanel.test.tsx`、`?? RightPanel.verify.test.tsx`

## 0. 所验证的修订（跑前/跑后各复算一次，一致即证明验证期间源码未被改动）

| 文件 | sha256 | 跑前 | 跑后 |
|---|---|---|---|
| `frontend/src/components/layout/RightPanel.tsx` | `9f7bad468ffe3fa3bd82477b5b18e0050171646c73cb777fc58121ac501835d4` | ✓ | ✓ |
| `frontend/src/components/layout/RightPanel.test.tsx`（开发者） | `26e32afeb06f1c83596f27fb227652a6098a90632b23f6e8dd2b1d18068b78dc` | ✓ | ✓ |
| `frontend/src/components/layout/RightPanel.verify.test.tsx`（本验证套件） | `2cc92645e88a7070361d2047ac9d0b37f18f027dbae6a63fd28279af8eab3edb` | ✓ | ✓ |

Lead 提供的冻结 sha 与我独立复算**完全一致**（`9f7bad46…` / `26e32afe…`），数据不采信转述。

> 说明：19:47 之前的 `b3ab8495…` 早期快照**不构成本报告结论**，已按要求作废（最终冻结值为 `9f7bad46…`）。B 节素材数据在 `50e44df` 重新生成横版素材后**全部重测**。

## 1. 结论摘要

| 工作流 | 判定 | 依据 |
|---|---|---|
| **A 附件区改造**（task-9 + task-11 收起语义收口） | **PASS** | 26/26 用例通过；tsc 0 错；全量 vitest 35 files / 449 passed + 1 skipped（≥ 基线） |
| **B Logo 替换**（`077285d` + `50e44df`） | **程序化检查全部 PASS** | 4 素材尺寸/alpha/留白/可复现性、tauri 图标集全量重生成、`lib.rs` 任务栏链、新旧差异证据齐备 |
| **B 目视可读性** | **不做结论，归主理人（Lead）** | 本报告只列数据（见 §3.7） |

**未发现 FAIL、未发现数据丢失、未发现只读不变量被破。** 唯一过程性发现是横版素材命名与真实尺寸不一致（800×200 文件实际 800×202），**已由 Lead 在 `50e44df` 修复并被我复验**（见 §3.8）。

---

# 2. A 节：附件区改造

## 2.1 环境与命令

```
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
npx tsc -b --noEmit
npx vitest run src/components/layout/RightPanel.verify.test.tsx --reporter=verbose
npx vitest run
```

**实际输出**（`tsc`，全文只有一行）：

```
EXIT=0
```

**实际输出**（验证套件，逐条）：

```
 ✓ ... > A-1 > 默认收起：附件条目不在 DOM，表头仍显示「附件」+ 数量 37ms
 ✓ ... > A-1 > 有孤儿附件时，收起态必须仍可见提示（信号不能丢） 15ms
 ✓ ... > A-1 > 无孤儿时收起态表头不出现孤儿噪声 17ms
 ✓ ... > A-1 > 两态成对（主理人裁决）：收起=只剩表头（删除入口消失/仅剩信号）；展开=孤儿区块+删除入口 24ms
 ✓ ... > A-1 > 表头点击 = 展开；再点 = 收起（列表条目随之消失） 25ms
 ✓ ... > A-2 > 3 篇文档引用同一附件 → 详情必须列出全部 3 条（不是只列 [0]） 35ms
 ✓ ... > A-2 > 详情内每一条引用都能跳到对应文档（onOpenArticle 收到正确 docRel） 34ms
 ✓ ... > A-2 > 点附件行本身 = 就地展开，不得直接把用户跳走 19ms
 ✓ ... > A-2 > 未引用附件：显示「未被…引用」+ 自身详情（rel_path / 大小 / 修改时间） 16ms
 ✓ ... > A-2 > 同一行点两次 = 展开再收起（详情消失，列表不塌） 20ms
 ✓ ... > A-2 > 点不同行 = 切换详情，上一个的展开态不得残留 26ms
 ✓ ... > A-2 > 引用列表顺序与 referenced_by 一致（不得乱序/丢条目） 26ms
 ✓ ... > A-2 > DOM 合法性：不产生嵌套交互元素（button 内不得再嵌 button/a） 34ms
 ✓ ... > A-3 > 打开/展开/跳转/收起全流程：无任何写请求，且无 alert 38ms
 ✓ ... > A-3 > 展开/收起是纯前端状态：不重复请求 listAttachments / listOrphans 25ms
 ✓ ... > A-3 > 非空证明：写请求替身确实可被调用（避免「零调用」是替身失效造成的假绿） 22ms
 ✓ ... > A-3 > 取消孤儿删除 → 不得发起 deleteAttachment（读-取消不写） 18ms
 ✓ ... > A-3 > 不触发编辑器事务：附件交互后编辑器容器未被触碰 31ms
 ✓ ... > A-4 > 刷新按钮 / 已引用-未引用徽章 / 孤儿删除按钮 / 底部说明文案仍在 14ms
 ✓ ... > A-5 > 附件 0 条：收起与展开均正常 28ms
 ✓ ... > A-5 > 附件 0 条但有孤儿：收起态表头仍须保留孤儿信号 12ms
 ✓ ... > A-5 > 50 条引用不得被截断（防「显示前 N 条」的隐性上限） 32ms
 ✓ ... > A-5 > 重开列表后仍至多一行处于展开态（收起了列表再展开不产生多行残留） 39ms
 ✓ ... > A-5 > referenced_by 为空数组：按未引用处理（不跳转 + 显示未引用） 15ms
 ✓ ... > A-5 > 超长路径 / 文件名不破版（渲染成功且行内保留截断样式） 13ms
 ✓ ... > A-5 > 切换文档（article.id 变化）后重新加载列表且不崩 19ms

 Test Files  1 passed (1)
      Tests  26 passed (26)
EXIT=0
```

**回归底线（全量）**：

```
 Test Files  35 passed (35)
      Tests  449 passed | 1 skipped (450)
EXIT=0
```

计数推导：基线 33 files / 411 passed + 1 skipped → 本轮新增 2 个文件（开发者 `RightPanel.test.tsx` 12 条 + 本验证套件 26 条）= **449 = 411 + 12 + 26**，skipped 仍为 1（`editor/perf-bench.test.ts` 的既有 skip，非本次引入）。**零回归、只增不减。**

## 2.2 用例清单与判定（A）

用例由验证者**独立推导**（对抗面优先），非验收标准复写。

### A-1 折叠语义与孤儿信号保留

| # | 断言（对抗意图） | 判定 |
|---|---|---|
| A1-1 | 默认收起：附件条目**不在 DOM**；表头仍可点且显示「附件 N」（N=2） | PASS |
| A1-2 | 有孤儿时**收起态**表头必须有可见信号（判据放宽：文案含「孤儿」/ 警示符 / amber\|warning\|rose\|alert 样式或 `data-orphan`/`aria-label=*孤儿*` 任一） | PASS |
| A1-3 | 无孤儿时表头**不得**出现孤儿噪声（防「永远显示警示」的假信号） | PASS |
| A1-4 | **两态成对**（主理人裁决后新增）：收起态 = 信号可见 + 删除入口不存在 + 无列表行；展开态 = 孤儿区块 + 删除按钮 + 列表行回来 | PASS |
| A1-5 | 表头点击 = 展开；再点 = 收起（列表条目随之消失） | PASS |

### A-2 详情正确性（本次核心修复）

| # | 断言 | 判定 |
|---|---|---|
| A2-1 | **3 篇文档引用同一附件 → 详情含全部 3 条**（旧实现只跳 `referenced_by[0]`，本次要修的核心） | PASS |
| A2-2 | 3 条引用**逐条可跳转**，`onOpenArticle` 收到正确 docRel 且**恰好调用 3 次**（不多不少） | PASS |
| A2-3 | 点附件行本身**不得跳走**（否则用户永远看不到详情）——旧行为是行点击即跳转，属高危回归点 | PASS |
| A2-4 | 未引用附件：显示「未被(任何文档)引用」+ **rel_path 全路径** + 格式化大小（3.0 KB）+ 修改时间（2026） | PASS |
| A2-5 | 同一行点两次 = 展开再收起；且**不得连带收起整个列表** | PASS |
| A2-6 | 切换行 = 上一个详情**不残留**（不得同时展开两行） | PASS |
| A2-7 | 引用列表**顺序与 `referenced_by` 一致**（构造 C→A→B，断言 DOM 中出现次序） | PASS |
| A2-8 | **DOM 合法性**：无 `button button` / `button a` / `a button` 嵌套交互元素（防止把详情塞进行按钮） | PASS |

### A-3 只读不变量（最高价值）

| # | 断言 | 判定 |
|---|---|---|
| A3-1 | 打开/展开/跳转/收起**全流程**：`saveArticle`、`updateArticleMeta`、`restoreHistory` 等 **27 个写函数替身零调用**；且**裸 `fetch` 零调用**（防绕过 `api/client` 的写请求）；且无 `alert` | PASS |
| A3-2 | 展开/收起是纯前端状态：**不重复请求** `listAttachments` / `listOrphans`（各恰好 1 次） | PASS |
| A3-3 | **非空证明**（防「零调用」是替身失效造成的假绿）：确认删除孤儿时 `deleteAttachment` 确实被调用 1 次且参数为孤儿路径 | PASS |
| A3-4 | 取消孤儿删除 → `deleteAttachment` **不得**被调用（读-取消不写） | PASS |
| A3-5 | 不触发编辑器事务：`vi.mock('editor/index')` 绊线（依赖图触达即整文件失败）+ 交互后 `.ke-editor-prose` 未被触碰 | PASS |

**A3-1 的写函数清单**（来源 `src/api/client.ts` 全量导出，人工核对）：`createArticle / saveArticle / deleteArticle / createWorkspace / openWorkspace / closeWorkspace / recordRecentDocument / clearRecentDocuments / createFolder / renameFolder / deleteFolder / createDocIn / renameDoc / movePath / updateArticleMeta / deleteAttachment / uploadAttachment / importMarkdown / importPackage / rebuildIndex / restoreHistory / registerRecovery / discardRecovery / restoreRecovery / restoreTrash / purgeTrash / clearTrash`。

**静态佐证**（`grep -n "fetch\|XMLHttpRequest\|sendBeacon\|editor/" RightPanel.tsx`）实际输出：

```
(无匹配)
```

即组件既无裸 `fetch`、无 XHR、也不 import 任何 `editor/**`；其数据面只有 `listAttachments / listOrphans / deleteAttachment / updateArticleMeta` 四个导入（后两者只在显式用户动作下触发）。

### A-4 既有信息未丢

| # | 断言 | 判定 |
|---|---|---|
| A4-1 | 刷新按钮（`aria-label/title="添加附件"`）、`已引用`/`未引用` 徽章、孤儿删除按钮、底部文案「孤儿附件仅支持手动删除，不随笔记回滚。」**全部仍在** | PASS |

### A-5 边界

| # | 断言 | 判定 |
|---|---|---|
| A5-1 | 附件 0 条：表头「附件 0」、展开显示「暂无附件」、再收起后空态文案随列表一并收起 | PASS |
| A5-2 | 附件 0 条 + 有孤儿：收起态仍保留孤儿信号（零附件不得吞掉信号） | PASS |
| A5-3 | **50 条引用不得被截断**（防隐性上限），实际渲染 50 条且末条在 DOM | PASS |
| A5-4 | 收起列表再展开后**至多一行展开**，且 `aria-expanded` 与详情面板状态自洽 | PASS |
| A5-5 | `referenced_by: []` → 按未引用处理（显示未引用 + 不跳转） | PASS |
| A5-6 | 超长文件名（20×4 字 + 深目录）不破版：条目可渲染且行内保留 `truncate` 截断类 | PASS（见 §5 未验证项：无布局引擎） |
| A5-7 | 切换文档（`article.id` 变化）→ 列表重新拉取（`listAttachments` 2 次）、不崩、零写请求 | PASS |

## 2.3 套件非空性（自证不是"永远绿灯"）

1. **正向对照**：A3-3 证明写请求替身**确实可被调用**（`deleteAttachment` 被调用 1 次），因此 A3-1 的「零调用」不是替身失效。
2. **折叠/详情类断言对实现有硬性要求**（必须有可点击表头、必须列出全部引用、必须选中态可切换），无此实现的组件不可能通过。
3. 诚实声明：**未对 `57d1e6a` 的旧实现做归档对照跑**。原因：文件级归档对照需要替换仓库内 `RightPanel.tsx`（或 git worktree 改动 `.git` 元数据 + 重建 node_modules 软链），超出本任务写入边界（❌ 不得改任何源码），故不做、不推测。
   过程留痕：19:39 对中间修订的一次完整跑得到 `7 failed | 13 passed`，其中 1 条为**脚手架缺陷**（`update()` 未同步 mock 返回值，已修复），其余为当时实现尚未满足的折叠/详情断言——该批数据仅作过程记录，**不作最终结论**。

## 2.4 关键静态事实（供复查）

- 收起 gate：孤儿区块（含删除按钮与说明）已整体移入 `attachOpen && (…)`，收起态**不渲染该区块任何 DOM**（gate 起于 `RightPanel.tsx:370`，孤儿区块 `:464-491` 位于 gate 内）。
- 表头折叠按钮：`data-testid="attachments-toggle"`、`aria-expanded`、`aria-label` 展开/收起附件列表；孤儿徽章 `data-testid="orphan-badge"` 位于折叠按钮内部（点徽章即展开）。
- 附件详情：`data-attachment-detail`、`data-ref-count`、每条引用 `data-ref-doc`。

---

# 3. B 节：Logo 替换

## 3.1 方法

- 图像分析：`python3` + Pillow 12.3.0（alpha bbox、内容占比、像素 MAD）。
- PNG 协议层校验：自写 chunk/CRC/IDAT 解析（`zlib`），独立于 Pillow 解码路径。
- 旧版对照：`git show 57d1e6a:<path>`（替换前的基线提交），与新工作区逐字节/逐像素比较。
- 可复现性：把 `scripts/make-brand-assets.py` **复制到 `/tmp` 并把 ASSETS 指向 `/tmp`** 后运行 —— **未触碰仓库任何文件**，再与仓库产物做字节比较。

## 3.2 四个前端素材：旧 → 新（全部为实测，不采信转述）

| 素材 | 旧(57d1e6a) | 新(50e44df) | 判定 |
|---|---|---|---|
| `astranota-icon-light-256.png` | `f46e7b18…` RGBA 256×256 bbox(0,0,256,256) 100% | `6d9ecf99…` RGBA 256×256 bbox(0,32,256,223) **74.61%** | PASS |
| `astranota-icon-dark-256.png` | `f46e7b18…`（**与 light 完全相同**） | `5efe1319…` RGBA 256×256 bbox 同上 | PASS |
| `astranota-horizontal-light-800x200.png` | `c7842f89…` **RGB 无 alpha** 800×200 | `75312c56…` RGBA **800×200** bbox(4,0,796,200) **99.00%** | PASS |
| `astranota-horizontal-dark-800x200.png` | `b9454f9d…` RGBA **800×227** bbox(27,6,774,222) 88.85% | `e3ee1a95…` RGBA **800×200** bbox(4,0,796,200) **99.00%** | PASS |

- **尺寸符合预期**：icon 256×256、横版 800×200，**与文件名声明一致**（旧 dark 800×227 / 旧 light 无 alpha 的问题已消除）。
- **有 alpha**：4/4 均为 RGBA（旧 light 为 RGB，无 alpha）。
- **透明留白已裁掉（量化）**：
  - 横版：alpha bbox 覆盖画布 **99.00%**，四周仅剩 4px/0px 的等比 letterbox 边（因内容宽高比 3.96:1 ≠ 4:1，`fit_into` 保证不拉伸）；旧 dark 仅 88.85%。
  - icon：bbox **(0,32,256,223)**，横向 0 边距、纵向上下各 32/33px。**这不是未裁切，而是数学必然**：新素材内容宽高比 1.3403:1（宽 > 高），而消费端是 `size-8` + `size-full` 的正方形槽位（`LeftSidebar.tsx:515-517`），方形画布 + 等比内容才能不变形；若裁成 256×191 再塞进 `size-full` 会被 CSS 拉伸。
- **旧素材对照**：旧 icon 为 256×256、alpha bbox 占满整个画布（内容 100%），新 icon 为透明底裸标记（内容占 74.61%）。Lead 在 `077285d` 提交信息中把旧素材描述为「带圆角底板的方形图标」——**该视觉描述属 Lead 的判断，本报告只复现了 bbox 数据**；目视取舍归 Lead。

## 3.3 原始素材（`F:\Work\KE Project\AN Logo`）作为裁切依据

| 源文件（实测） | 模式/尺寸 | alpha bbox | 内容占比 |
|---|---|---|---|
| `浅色icon透明底0908.png` | RGBA 3334×3334 | (749, 982, 2584, 2351) | 22.60% |
| `深色icon透明底0908.png` | RGBA 3334×3334 | (749, 982, 2584, 2351) | 22.60% |
| `浅色横版透明底0908.png` | RGBA 3334×3334 | (259, 1311, 3074, 2022) | 18.01% |
| `深色横版透明底0908.png` | RGBA 3334×3334 | (183, 1369, 2998, 2080) | 18.01% |

即素材前提「3334×3334 方形画布 + 大量透明留白，内容仅占 18%~23%」**经独立复测成立**；最终产物内容占比 99.00%（横版）/ 74.61%（icon 方形画布）→ 留白已按预期处理。

## 3.4 派生脚本可复现性（5/5 字节级一致）

命令（**只读仓库，产物落 /tmp**）：

```
cp scripts/make-brand-assets.py /tmp/brandcheck2/derive.py      # 复制，不改仓库
# 仅把副本里的 ASSETS 常量指向 /tmp/brandcheck2/out/assets
python3 /tmp/brandcheck2/derive.py "/mnt/f/Work/KE Project/AN Logo" --out /tmp/brandcheck2/out/unified
sha256sum 对比 复现产物 vs 仓库产物
```

实际输出：

```
  ✓ astranota-icon-light-256.png            256x256  内容占比  74.6%  (新建)
  ✓ astranota-icon-dark-256.png             256x256  内容占比  74.6%  (新建)
  ✓ astranota-horizontal-light-800x200.png  800x200  内容占比  99.0%  (新建)
  ✓ astranota-horizontal-dark-800x200.png   800x200  内容占比  99.0%  (新建)
  ✓ (tauri icon 源) astra-icon-1024.png     1024x1024 内容占比  63.2%  (新建)

  IDENTICAL astranota-icon-light-256.png  6d9ecf995db99492…（完整 sha256 见下表）
  IDENTICAL astranota-icon-dark-256.png   5efe131945e8a391…
  IDENTICAL astranota-horizontal-light-800x200.png  75312c56f28356b3…
  IDENTICAL astranota-horizontal-dark-800x200.png   e3ee1a95f46563d4…
  IDENTICAL astra-icon-1024.png           371b8a68438545e05b7ba2cfce062864eeb54f342009a8dd0738bc075cf1a3e0
```

完整 sha256（新产物，可与 §3.2 表对照复算）：

```
6d9ecf995db99492072934f67c86c4974919b20b833635b171ae9631d0802440  astranota-icon-light-256.png
5efe131945e8a391326fc7d596592bec1c5d7f316541364496faa6590c1b2691  astranota-icon-dark-256.png
75312c56f28356b3018c7a684c16dbae3770937022602f5a5b49a881465eeba7  astranota-horizontal-light-800x200.png
e3ee1a95f46563d445a02d4a16903a280eb29b9813badd4922117ab102b34a3d  astranota-horizontal-dark-800x200.png
```

**结论**：仓库中 5 个品牌产物与脚本输出**逐字节相同**，不存在手工改图/脚本与产物漂移。

## 3.5 `desktop/src-tauri/icons/` 图标集（已重生成、尺寸齐全）

- 15 个桌面 PNG：mtime 全部 `2026-09-15 19:37:20/21`，sha256 全部较基线变化，尺寸齐全且与文件名一致：
  `32×32`、`64×64`、`128×128`、`128×128@2x`(256²)、`Square30/44/71/89/107/142/150/284/310`、`StoreLogo`(50²)、`icon.png`(512²)。
- `icon.ico`：`f87c3b76…`（旧 `767e1bbb…`），ICO 头 `00 00 01 00`，**6 个图层** `(16,16,32bpp)(24,24)(32,32)(48,48)(64,64)(256,256)` —— 含 256² 大图。
- `icon.icns`：`27134731…`（旧 `e66d4448…`），magic `icns`，132168 bytes。
- **移动端目录也已同步重生成**（非遗留旧图）：`icons/ios/**` + `icons/android/**` 共 **33 个 PNG，全部 mtime 2026-09-15 19:37，全部可解码**，尺寸分布符合 iOS/Android 规范（20…1024）。
- **PNG 协议层校验**：19 个 PNG（4 素材 + 15 桌面图标）全部 `chunks=3 / CRC OK / IDAT 可 inflate / IEND 存在`，color_type=6（8bit RGBA）——非仅靠 Pillow 解码。

## 3.6 `lib.rs` 任务栏图标链

```
$ grep -n "include_bytes" desktop/src-tauri/src/lib.rs
42:                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
```

| 目标文件 | 旧(57d1e6a) | 新 | 判定 |
|---|---|---|---|
| `desktop/src-tauri/icons/128x128@2x.png` | `ec01435f…` RGBA 256×256 bbox 100% | `b1aba9b3…` RGBA 256×256 bbox (8,38,248,218) 65.92% | **已更新** ✓ |

mtime `2026-09-15 19:37:21`，且该文件是 `Tauri` 窗口/任务栏图标源。`lib.rs` 无需改动（路径未变）。

**"tauri icon 无需重跑"的核验**：派生输入 `Logo/unified/astra-icon-1024.png` sha256 = `371b8a68…`，与横版修复前我记录的完全一致（横版分支不参与该产物），`desktop/src-tauri/icons/**` 全部 mtime 仍为 19:37 且 sha 未变 → **输入未变，输出无需重生成**（该结论只覆盖"是否需要重跑"，不含目视效果）。

`astra-icon-1024.png`：1024×1024 RGBA，alpha bbox (41,160,983,863)，内容占比 63.2%，内容宽高比 1.3400（与新 icon 素材 1.3403 一致）。

## 3.7 图标集与"新版素材"的一致性（程序化证明，非读图）

把每个图标裁到内容边界 → 归一化 128×128 → 与新旧变体逐像素算 MAD（0 = 完全一致）：

| 图标 | MAD vs 新版 light | MAD vs 新版 dark | 判定 |
|---|---|---|---|
| `128x128@2x.png` | **0.2** | 59.5 | 新版 light 艺术 |
| `128x128.png` | 0.8 | 60.0 | 新版 light |
| `32x32.png` | 3.1 | 62.0 | 新版 light |
| `64x64.png` | 1.8 | 60.8 | 新版 light |
| `icon.png` | 0.2 | 59.5 | 新版 light |
| `Square284/310/150/142/107/89/71/44/30Logo.png` | 0.2–3.0 | 59.5–61.5 | 新版 light |
| `StoreLogo.png` | 2.2 | 60.7 | 新版 light |

**结论（数据）**：15/15 图标均来自**新版**素材（MAD ≤ 3.1），而非旧图标；且均使用 **light 变体（深色字形，墨色 alpha 加权平均亮度 6.0；dark 变体为 248.0）**。`128x128@2x.png` 内容占画布 65.92%。

> **目视可读性判断（深色任务栏/主题下深字图标是否合适、65.92% 占比是否过小）归主理人（Lead）**。本报告不据此下结论、不给建议性判定。

## 3.8 过程性发现（已修复，留痕）

| 发现 | 证据 | 归因 | 状态 |
|---|---|---|---|
| `astranota-horizontal-{light,dark}-800x200.png` 命名与真实尺寸不符（实为 **800×202**） | 修复前实测 `800x202`，bbox 占满画布；源码使用方为 `h-12 w-auto` / `h-[76px] w-auto`（按比例渲染，无畸变） | 本次 logo 替换引入（`077285d` 的 `resize_width(im, 800)` 使高度随源比例浮动） | **已修复**：`50e44df` 改为 `fit_into(im, 800, 200)`，现为 800×200，**复验 PASS**（§3.2） |

---

# 4. 归因汇总（本次引入 vs 既有）

| 类别 | 项目 | 说明 |
|---|---|---|
| 本次引入（已修） | 横版素材尺寸与命名不一致 | `077285d` → `50e44df` 修复，复验 PASS |
| 本次引入（无缺陷） | 附件区默认收起 + 详情展开 | 26/26 PASS，零写请求不变量成立 |
| 既有（非本次） | `editor/perf-bench.test.ts` 的 1 个 skipped | 基线即存在（411+1 → 449+1），未变化 |
| 既有（非本次） | 旧 light 横版素材无 alpha、旧 dark 尺寸 800×227、icon light/dark 同哈希 | 替换前状态，本次已全部消除 |
| 既有（非本次，未改动） | `referenced_by` 由后端 `attachment_refs_in()` 返回 `set` 逐文档去重 | 故同一文档重复引用不会产生重复条目/重复 React key（`backend/app/services/markdown_io.py:336`、`references.py:58`） |

# 5. 未验证项声明（如实列出，不含推测）

| 项 | 原因 |
|---|---|
| **logo 目视效果**（字形/深浅主题观感、taskbar 深浅底可读性、65.92% 占比是否偏小） | 任务明确：**目视判断归主理人**，验证者不使用读图代替判断；本报告只提供 sha256/尺寸/bbox/占比/MAD 程序化证据 |
| **Rust 编译与任务栏实际渲染** | 未运行 `cargo`/packaging（环境与写入边界外）。已做的是文件级证据：目标文件存在、sha 已更新、PNG 结构/CRC 合法、256×256 RGBA、艺术来源一致性 MAD 0.2 |
| **`tauri icon` 由我重跑核对产物** | 该命令会写入 `desktop/src-tauri/icons/**`（超出写入边界）。替代证据：派生输入 `astra-icon-1024.png` sha 未变 + 图标集 mtime/sha 未变 + 15/15 与新版素材一致 |
| **真实浏览器/桌面环境的像素布局（超长文件名是否真的溢出、徽章是否被裁）** | happy-dom **无布局引擎**；A5-6 只能校验 `truncate` 样式类存在，不能证明真实不溢出 |
| **真实后端 `referenced_by` 端到端**（3 篇文档引用同一附件的真实扫描） | A 节为前端组件级验证，`listAttachments/listOrphans` 使用替身；已读代码确认去重语义，但未跑真实工作区集成 |
| **组件绕过 `api/client` 的 XHR/WebSocket 写请求** | 已覆盖 `api/client` 27 个写函数 + 裸 `fetch` 绊线 + 静态 grep 无 `XMLHttpRequest`；未对 WebSocket/`sendBeacon` 做运行时拦截 |
| **旧实现（57d1e6a）归档对照跑** | 需替换仓库源码文件或改 `.git` worktree，超出写入边界（见 §2.3） |

# 6. 复跑指引

```
# A（在最终冻结 sha 上）
cd "/mnt/f/Work/KE Project/knowledge-editor/frontend"
sha256sum src/components/layout/RightPanel.tsx          # 期望 9f7bad468ffe3fa3…
npx tsc -b --noEmit                                      # 期望 exit 0
npx vitest run src/components/layout/RightPanel.verify.test.tsx   # 期望 26 passed
npx vitest run                                           # 期望 35 files / 449 passed + 1 skipped

# B
cd "/mnt/f/Work/KE Project/knowledge-editor"
sha256sum frontend/src/assets/astranota/*.png desktop/src-tauri/icons/128x128@2x.png
python3 /tmp/brandcheck2/derive.py "/mnt/f/Work/KE Project/AN Logo" --out /tmp/brandcheck2/out/unified
```

**验证产物**：本报告 + `frontend/src/components/layout/RightPanel.verify.test.tsx`（26 用例，独立于开发者的 `RightPanel.test.tsx`）。
验证者全程**未修改任何源码**（`frontend/src/**` 其它文件、`backend/**`、`desktop/**` 均未触碰）。
