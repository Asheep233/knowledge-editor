# 独立验证报告：移动路径 4 项修复（F9b / F9c / F11 / F12）—— task-16

**结论：PASS**（93/93 独立用例、全量回归 597 passed + 2 skipped、openapi 快照无变化、冻结修订全程未被改动）

- **验证者**：`verifier`（独立于 task-15 实现者 dev-attach；未修改任何源码）
- **验证时刻**：run-start `2026-09-16T15:46:53Z` → run-end `2026-09-16T15:49:55Z`（UTC）
- **环境**：WSL2 / Python 3.14.4 / pytest 8.4.2 / Node 24.19.0（前端为只读代码核验）
- **验证员产物**：`backend/tests/test_move_fixes_verify.py`（93 例）、本报告

## 0. 冻结修订（验证者自行复算，跑前/跑后一致）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `backend/app/routers/fs.py` | `2cfa3c5d3dab787e9e6e3c3811e98f9859c858bce298f1b2f7138b674548242a` |
| `backend/app/services/app_config.py` | `56bd0a5bfbcefd2d25338940c11ca243e0978b6cc8c845843c6f55b901e5d383` |
| `backend/app/store/db.py` | `9759a95359c21f8ea1d09261b0919e3dd134b18147250684729f16cee34c3d67` |
| `backend/app/routers/drafts.py` | `b9bbc3252c0f4f3a4dfdd18302d70af35bd0611877c35eec7f66c3e650ba665c` |
| `backend/tests/test_move_fixes.py`（开发者） | `ead6d92ffc22d6527e11c999ec6190f09db75a7f12baf4b4f71ba00667762410` |

> 与 Lead 给出的冻结 sha 逐字一致；全部运行结束后再次复算，5 个文件哈希**无一变化** → 本报告结论确实针对该冻结修订。

---

## 1. 结论摘要

| 验证面 | 结论 | 关键证据 |
|---|---|---|
| F9c 净化（非法字符/保留名/首尾空白尾点/超长/CJK/控制字符/NUL） | **PASS** | §3.1；29 例参数化全绿 |
| F9c 归一化不越界（`Articles/..`、`./`、深遍历、跨区、Drafts/Trash） | **PASS** | §3.2；14 例 |
| F8 不回归（feasibility 原样用例） | **PASS** | §3.3；400 + 文件在原处 + 零副作用 |
| P2-15 引用保护不回归 | **PASS** | §3.4；4 例（含「未引用附件仍可移动」反向断言） |
| F9b 已存在目录/文件的错误码与文案 + 无副作用 | **PASS** | §3.5；含 Lead 指定的顺序语义核验 |
| F11 最近列表迁移（顺序/title/去重/上限 20/失败不动/持久化） | **PASS** | §3.6；含 app_config.json 磁盘核验 |
| F12 recovery 草稿迁移（逐字节/旧不残留/失败不动/白名单/restore/目录移动/兜底） | **PASS** | §3.7；含 SQLite 行级核验 |
| 不变量（原子 rename/受保护根/404/openapi） | **PASS** | §3.8 |
| 回归底线 | **PASS** | §2 |

---

## 2. 回归底线（实测）

```
$ cd backend && python3 -m pytest tests/test_move_fixes_verify.py -o addopts="" -q
93 passed in 2.61s

$ python3 -m pytest -o addopts="" -q
597 passed, 2 skipped in 13.99s

$ python3 -m pytest --ignore=tests/test_move_fixes.py --ignore=tests/test_move_fixes_verify.py -o addopts="" -q
462 passed, 2 skipped in 10.96s          # 既有基线：与任务书 462+2 完全一致

$ python3 -m pytest tests/test_move_fixes.py -o addopts="" -q
42 passed in 1.42s                        # 开发者自测文件（独立跑一次）

$ python3 -m pytest tests/test_openapi_snapshot.py -o addopts="" -q
3 passed in 0.49s                         # 无新端点，快照未变
```

**计数对账**：`462（既有基线）+ 42（dev）+ 93（独立验证）= 597 passed + 2 skipped = 599 collected`，
**只增不减**，无既有用例被删除或跳过。

---

## 3. 逐组实测结果

### 3.1 F9c 净化面（29 例全绿）

参数化覆盖：`Articles/非法:名*.md`、`尖<括>号.md`、`问号?.md`、`竖线|名.md`、`引号"名.md`、
`反斜杠\名.md`、CON/NUL/PRN/AUX/COM1/LPT1/con、`尾点.md.`、`尾空格.md `、` 前导空格.md`、
`.hidden.md`、`我的 报告 v2.md`（精确等值）、150 CJK、295/300 字符、`\x01\x07`/TAB/换行、
`....md`/`...`/`.md`/`..md`/`.. .md`、NUL（src+dst）。

每条硬断言（`_assert_move_ok` / `_assert_move_rejected`）：
- 200（或预期 4xx）+ 响应 `to` **等于实际落盘路径**；
- 内容 sha256 不变、**inode 不变**（证明是同顶层原子 rename，非 copy+delete）；
- 工作区全量快照 diff 恰好 `-src +to`（无 `.tmp` 等意外落盘）；
- 落盘名契约：无 `<>:"/\|?*`/控制字符、非隐藏、无尾点/尾空格、非 Windows 保留名、≤255 字节、**仍以 `.md`/`.markdown` 结尾**。

关键实测（早期报的 4 类 7 红全部转绿）：
```
'Articles/控制\x01字符\x07.md'      -> 200 落盘 '控制 字符.md'          （净化语义保留）
'Articles/....md' / '.md' / '..md' -> 200 落盘 'untitled.md' / 'md.md'  （不再只剩 'md'，且不以点开头）
'Articles/.. .md'                   -> 200 落盘 'untitled.md'           （不再是隐藏文件 '.md.md'）
'Articles/尾空格.md '               -> 200 落盘 '尾空格.md'             （不再是 '尾空格.md.md '）
dst/src 含 \u0000                   -> 400「非法路径：含 NUL 字符」      （不再抛 ValueError → 500）
```
另有：目录段不得被净化（`Articles/we:ird/新名.md` 逐字保留目录名）；净化后撞既有文件 → 409 且既有文件字节不变。

### 3.2 归一化不得越出顶层（14 例全绿）

实测拒绝输出（节选）：
```
'Articles/../../../../etc/passwd.md' -> 400 非法路径: Articles/../../../../etc/passwd.md
'Articles/../绕过.md'                -> 400 目标必须位于 Articles/Modules/Attachments 下
'Articles/../Modules/绕过.md'        -> 400 仅允许在同一顶层目录内移动
'Articles/sub/../../Modules/绕过.md' -> 400 仅允许在同一顶层目录内移动
'Articles/./../Modules/绕过.md'      -> 400 仅允许在同一顶层目录内移动
'Articles/../Drafts/绕过.md'         -> 400 受保护目录，禁止操作: Drafts
'Articles/../Trash/绕过.md'          -> 400 受保护目录，禁止操作: Trash
'Articles/../Modules/CON.md'         -> 400 仅允许在同一顶层目录内移动
```
全部 400 + 零落盘副作用 + 源文件未动。合法侧 `Articles/./新名.md`、`Articles/子/../新名.md`、
`Articles//新名.md`、`Modules/../Articles/新名.md` 均归一化后正常落盘且 `to` 为归一化路径。

### 3.3 F8 原样用例（PASS）
```
src='Articles/绕过用例A.md'  dst='Articles/../Modules/绕过用例A.md'
-> 400 仅允许在同一顶层目录内移动；文件仍在 Articles/；Modules/ 下无新文件；前后快照相等
```

### 3.4 P2-15（4 例全绿）
被引用附件移动 → 409（引用链不变）；含被引用附件的目录移动 → 409；**未被引用的附件仍可移动 → 200**（防过度保护）；附件跨顶层 → 400。

### 3.5 F9b + Lead 指定顺序语义（全绿）

```
[ke-verify] F9b 已存在目录          -> 409 目标是已存在的文件夹：Articles/子目录，请在目标路径里带上文件名（例如：Articles/目标文件夹/文件名.md）
[ke-verify] F9b 已存在目录(尾斜杠)   -> 409 目标是已存在的文件夹：Articles/目标夹，请在目标路径里带上文件名（例如：…）
[ke-verify] dst='Articles/.'        -> 400 目标必须位于 Articles/Modules/Attachments 下   （仍按 F8 语义，未被改成文件夹提示）
```
**顺序语义核验（Lead 关注点 1）**：`dst="Articles/子目录"`（已存在目录）**没有被补成 `子目录.md`** 悄悄成功——硬断言 `not (ws/"Articles/子目录.md").exists()` + 快照相等（若被补名落盘，快照必然变化）；`dst="Articles/."` 归一化为顶层目录本身 → 400。两项均与 Lead 描述一致。

### 3.6 F11 最近列表（8 例全绿）

```
[ke-verify] F11 去重后 = ['Articles/去重文档-新.md']
```
覆盖：rel_path 同步 + 顺序（`[C, B', A]`）与 title 保留 + 旧路径无残留；未记录文档移动 → 他人不变；
旧/新路径同时在列 → 去重为 1 条；25 条 → 上限 20，移动头项后仍 20 且其余顺序不变；
跨区失败 400 / 目标已存在 409 → 最近列表逐字节不变；
**持久化核验**：直接读 `app_config.json`，新 rel_path 已落盘、旧路径不存在、title 保持。

### 3.7 F12 recovery 草稿迁移（8 例全绿，最高优先）

用内容 `\ufeff---\r\nke_version: 1\r\ntitle: "草稿标题"\r\n---\r\n\r\n# 未保存的中文内容\r\n\r\n<!-- ke-attach: {…含 } 括号…} -->` 验证：
- **逐字节不变**：迁移前后 `read_bytes()` 全等（BOM+CRLF+CJK+ke-* 标记）；
- 新草稿名 = `{新 stem}-{sha1(新 完整相对路径)[:8]}.draft.md`（验证员独立计算，未 import 被测实现），旧草稿不存在；
- `GET /api/drafts/recovery` 恰好 1 条、`doc_path` 为新路径、`draft_path` 在新目录内；
- **SQLite 行级核验**：`store.get_recovery(旧) is None`、`store.get_recovery(新).draft_path == 新草稿`；
- `Drafts/recovery` 下草稿文件数恰好 1；白名单不变量（无 `..`、前缀正确、文件存在）；
- restore 仍可用：写回新路径、记录清空、草稿删除；
- 无草稿 no-op；移动失败（400/409）→ 草稿与记录**逐字节/逐字段不变**；
- DB 记录丢失（`store.clear_recovery`）后目录扫描仍能反查**新**路径；
- **F9c×F12**：`dst="Articles/净化:草稿*.md"` → 实际路径 `Articles/净化 草稿.md`，草稿迁移到 `Drafts/recovery/净化 草稿-a19f8e42.draft.md`（跟随**实际**路径而非用户输入串）；
- **目录移动**：`Articles/目录甲` → `Articles/目录乙`，内含文档草稿迁移为新 hash、旧草稿不残留、记录指向新路径；
- 无关文档的草稿/记录不受牵连。

### 3.8 不变量（5 例全绿）
Drafts/Trash/.knowledgeeditor 三根 inbound/outbound 全 400 + `Trash` 不可建/删；src 不存在 404；
无 `.tmp-*` 残留；`/api/fs/move` 仍恰好 1 个 POST 且无子端点（openapi 快照 3 passed）。

---

## 4. Lead 关注点 2：扩展名收敛到源文件类型（新语义，独立构造）

```
[ke-verify] 扩展名收敛观察表
                 doc | 输入         'Articles/报告.PDF'    -> 200 'Articles/报告.md'
                 doc | 输入         'Articles/新名.MD'     -> 200 'Articles/新名.md'
                 doc | 输入         'Articles/新名.tar.md' -> 200 'Articles/新名.tar.md'
    doc(.markdown 源) | 输入         'Articles/观2.md'      -> 200 'Articles/观2.markdown'
          attachment | 输入 'Attachments/images/photo.jpg' -> 409 None
```
另有：文档 `dst="Articles/新名"`（无扩展名）→ `Articles/新名.md`；附件无扩展名 dst → 补源扩展名 `.pdf`；
附件 `新名.png` → 收敛为 `新名.pdf`；源本身无扩展名 → 不拼接；目录移动**不**加后缀（`Articles/目录甲` → `Articles/目录乙`）；
`新名.txt` 收敛成 `新名.md` 后撞既有文件 → 409 且既有文件不变。

**判断（如实，不美化）**：
1. **该语义是必要的**：它正是修掉我早期报的 E1/E2（尾空格双后缀、纯点名丢扩展名）那类「文档不再以 .md 结尾 → 从树/索引消失」缺陷的收口手段；我独立复现的反例（修复前 `....md` → `md`）证实若不收敛就会产生不可见文档。
2. **反例 1（可用性，非数据安全）**：用户显式写 `报告.PDF` / `新名.txt` 会得到 `报告.md` / `新名.md`——**用户输入的扩展名被静默转换**。判据：响应 `to` 是权威实际路径，且前端 `handleMove` 用 `${target}/${node.name}` 构造 dst（只换目录、保留源文件名，见 `LeftSidebar.tsx:431-436`），**UI 路径上不可达**；只有直接调 API/脚本才可能遇到。→ **WARN**，建议（非阻塞）：响应 `to` 与输入不一致时前端提示新名字，或在 API 文档注明收敛语义。
3. **反例 2（能力收缩）**：附件 `photo.jpeg` → 目标 `photo.jpg` 会收敛回 `photo.jpeg`，即**无法再通过 move 改变附件扩展名**（同目录同主名时收敛回源路径 → 409「目标已存在」；换目录则仍为 `.jpeg`）。修复前允许（原样 rename）。属移动语义收紧、**无数据丢失**、UI 不可达（同上）→ **WARN**。
4. 未发现会让用户「改名改出意外名字」的**破坏性**反例：所有 200 的 `to` 都与磁盘一致、文档恒以 `.md/.markdown` 结尾、附件恒保持源类型。

---

## 5. 修复前 vs 修复后对照

| 探针 | 修复前（工作树 `3f97f1a`，验证者实测） | 冻结修订 `2cfa3c5d`（实测） |
|---|---|---|
| `dst` 含 `\u0000` | **未捕获** `ValueError: lstat: embedded null character in path`（uvicorn 下 500） | **400「非法路径：含 NUL 字符」** |
| `dst="Articles/非法:名*.md"` | 200，落盘原名 `非法:名*.md`（F9c：完全不走净化） | 200，落盘 `非法 名 .md` |
| `dst="Articles/文档.md "` / `Articles/....md` | （无净化）原样落盘，含尾空格 / 无扩展名 | `文档.md` / `untitled.md`（仍为 .md 文档） |
| `dst="Articles/子目录"`（已存在目录） | 409「目标已存在: Articles/子目录」（误导） | 409「目标是已存在的文件夹…请带上文件名」 |
| 移动后 `/api/workspace/recent-documents` | 仍为旧 `Articles/基线文档.md`（旧路径 GET 404） | 新路径 + title/顺序保留 + 已落盘 app_config.json |
| 登记草稿后移动 | 记录仍 `Articles/草稿文档.md`、草稿文件名未变（孤儿） | 记录与草稿文件同步迁移、内容逐字节不变、restore 可用 |
| `dst="Articles/../Modules/绕过.md"` | 400（F8 已修） | 400（不回归） |

**归因**：上表前 3 行属**既有缺陷**（F9/F9c 家族，非本轮引入）；第 4–6 行是本轮修的 F9b/F11/F12；
「扩展名收敛到源类型」是**本轮新引入的行为**（设计意图，见 §4 判断）；未发现本轮引入的回归。

---

## 6. 判据完整性声明

- 早期报的 4 类 7 红全部保留为硬断言并转绿；**原有 79 例判据未删改、未削弱**（仅新增 14 例：扩展名收敛/顺序核验 12 + 对照表 1 + app_config 持久化 1）→ 93 例。
- 未因实现变化调整任何既有断言；若未来实现再变导致既有断言失败，属实现偏离冻结语义，应报 FAIL 而非改断言。

## 7. 未验证项（明确列出，无推测结论）

| 项 | 原因 |
|---|---|
| Windows 真机行为（NTFS rename 语义、Windows 保留名在真实 Windows FS 的落盘、路径长度上限） | 本环境为 WSL2 + ext4 `tmp_path`；保留名断言基于统一净化策略的**输出命名**，非 Windows FS 实测 |
| 前端 UI 端到端移动 | 只读核验了 `LeftSidebar.handleMove`（`dst=${target}/${node.name}`）与 `movePath` 调用点；未启动桌面/浏览器运行时，未做真实点击链路 |
| 「用户手打异扩展名」的用户可见性 | 结论基于代码路径（UI 只传目录、保留源文件名）推断 UI 不可达；未做 UI 实测 |
| 跨进程重启后读取迁移结果 | 已核验 `app_config.json` 与 SQLite 行级落盘；未新起进程重新加载验证 |
| 并发移动同一文档 / 移动与保存并发 | 未构造并发用例（移动为同步 rename + 同步同步链） |
| 目录内**多篇**文档各带草稿的批量迁移 | 仅测「目录移动 + 目录内 1 篇带草稿文档」；多份草稿的循环逻辑未单独覆盖 |

---

## 8. 复现命令

```bash
cd "/mnt/f/Work/KE Project/knowledge-editor/backend"
python3 -m pytest tests/test_move_fixes_verify.py -o addopts="" -q      # 93 passed
python3 -m pytest tests/test_move_fixes.py -o addopts="" -q             # 42 passed（开发者）
python3 -m pytest -o addopts="" -q                                      # 597 passed, 2 skipped
python3 -m pytest tests/test_openapi_snapshot.py -o addopts="" -q       # 3 passed
sha256sum app/routers/fs.py app/services/app_config.py app/store/db.py app/routers/drafts.py tests/test_move_fixes.py
```
