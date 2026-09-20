# 回收站 MVP 验证报告

> 冻结修订：`ff7e9b8`（后端加固）+ `e6b902a`（前端）
> 日期：2026-09-15 · 契约：`docs/design-trash-mvp.md`

---

## 0. 独立性声明（如实标注，请勿当作完整独立验证）

| 项 | 说明 |
|---|---|
| 对抗用例**作者** | **`verifier-trash`（独立 agent）** —— 仅依据契约与可行性文档推导，**不 import 任何 trash 实现模块**；120 用例、按攻击面组织（C4 不变量 / C2 数据完整性 / C6 冲突 / 路径穿越 / 孤儿语义 / 幂等 / C1 / 契约一致性）|
| 对抗用例**执行者** | **Lead** —— `verifier-trash` 在第二段开始前**因 token 耗尽中断**，Lead 接手执行 |
| 独立性**降级说明** | 用例设计保持独立（作者未读实现），但**执行与判定由实现者本人完成**，且 Lead 修了套件中一处**测试框架 bug**（见 §2）。因此**不构成完整的独立验证**。真正独立的复核建议由新 agent 或主理人在 GUI 侧完成 |
| 修复者 | Lead（后端实现者本人）—— 即「开发者修自己被发现的问题」，无第三方复核 |

**结论仍可信的部分**：120 条对抗用例本身由独立方按契约推导，覆盖面（尤其穿越矩阵与 C4 不变量）远大于开发者自测；6 条红均为**可复现的真实缺陷**（非风格争议）。

---

## 1. 最终数字（全绿）

| 套件 | 结果 | 基线 | 变化 |
|---|---|---|---|
| `python3 -m pytest` | **450 passed + 2 skipped** | 314 + 2 | +136（`test_trash.py` 16 + `test_trash_verify.py` 120）|
| `npx tsc -b --noEmit` | **0 错** | 0 | — |
| `npx vitest run` | **31 files / 401 passed + 1 skipped** | 28 / 378 + 1 | +23（TrashPanel 13 + LeftSidebar 5 + api/trash 5）|
| `cargo test` | **13 passed** | 13 | — |
| `npm run build` | ✓ 10.32s，产物版本串仅 `1.1.8-pre.1` | — | — |
| 对抗套件单独跑 | **120 passed / 0 failed** | — | 由 6 红 → 0 红 |

---

## 2. 测试框架 bug（Lead 修复，非放宽断言）

`test_trash_verify.py::_diff_fp` 原实现**恒返回非空摘要字符串**（`f"added=… removed=… changed=…"`），
而 8 处断言写作 `assert _diff_fp(...) == ""` → **无论有无差异都必然失败**。
作者在其 docstring 已注明意图为「无差异时返回空串」，Lead 按其意图补上 `if not (added or removed or changed): return ""`。
**属修正实现与自身文档不符，不是放宽或删除断言**（断言集合与强度未变）。

---

## 3. 对抗验证发现的 6 处缺陷（全部确认为真并已修复）

| # | 缺陷 | 严重性 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | 去重上限（1000）耗尽 → `FileExistsError` 冒泡 **500** | 中 | router 只捕获 `ValueError`/`FileNotFoundError` | 捕获并返回 **409**（契约 §5 明确要求）|
| 2 | 路径参数名 `{entry_id}` 与契约 §3 字面 `{id}` 不一致 | 低 | 实现/契约文本漂移 | 改为 `{id}` + 同步快照基线 |
| 3 | **entry id 碰撞导致数据丢失** | **高** | `_new_entry_id()` 后直接写盘：同秒 + 随机源被固定/耗尽时，第二次删除落进同一 entry，同一 rel 被 `os.replace` **覆盖** | `mkdir(exist_ok=False)` **独占创建** + 换 id 重试；随机源固定时退到**计数扩展 id**；`_ENTRY_RE` `{4}` → `{4,16}` |
| 4 | `purge` 遇符号链接 entry → `shutil.rmtree` 抛 `OSError` → **500** | 中 | 未识别链接 | `_checked_entry`：`Trash` 根或 entry 为链接一律拒绝 |
| 5 | `restore` 对符号链接 entry 返回 **200**，可搬运工作区外文件 | **高** | `rglob` 会穿过链接目录 | 同 4；`_entry_files` 追加「解析后必须仍在 entry 内」的反逃逸判断 |
| 6 | 手工构造的 entry 可把文件恢复到 `Attachments/` 等非文档位置 | 中 | 恢复未做目标校验 | 恢复目标改用**与删除端点同款白名单** `markdown_io.is_doc_rel`（`Articles/`\|`Modules/` 下 `.md`/`.markdown`）|

契约文档同步新增硬约束 **C7**（符号链接拒绝）/ **C8**（恢复过文档白名单）/ **C9**（id 碰撞不丢数据）。

---

## 4. 覆盖的攻击面（120 用例摘要）

- **C4 不变量**：tree 全 JSON 无 `"Trash"` 子串；FTS 搜正文/标题/tag/entry 名 count=0、恢复后 ≥1；
  `/api/articles` 与 `/api/tags` 无残留；Trash 内伪造 Attachments 形态文件不进 list/orphans；
  `store.list_files()` 无 Trash 行且 `/api/index/rebuild` 后仍无（模拟重启 reconcile）；
  删除/恢复过程与**外部手工拖入**均不产生 watcher 事件
- **C2 数据完整性**：逐字节往返 —— frontmatter / **CRLF** / **UTF-8 BOM** / CJK+空格文件名 / 嵌套子目录 /
  无尾换行 / **0 字节空文件** / `ke-attach` 标记 / **非法 UTF-8 二进制 .md** / `#&'+%` 特殊字符名；
  断言 sha256 + 字节 + size + mtime_ns + **inode 不变**（「原子 rename vs copy+delete」的行为代理）
- **C6 冲突**：不覆盖（原文件 sha256 不变）+ `renamed:true` + 后缀递增；`.markdown`/`.MD` 保真；
  Modules 嵌套路径；目标是目录；1000 次上限 → 409 且不覆盖、entry 仍可恢复
- **路径穿越**：24 种 bad id × restore/purge 双向 + 工作区与父目录全量指纹比对 + 金丝雀目录；
  符号链接 entry / entry 内链接 / Articles 下链接文档 → 不得删除链接目标
- **孤儿附件数据安全**：删除文档后附件不进 orphans、`referenced_by` 含 `Trash/...`、DELETE 附件 409 且磁盘仍在；
  **purge 后才允许成为孤儿并可删**（语义闭环）；活文档 + Trash 双引用时 purge 后仍受保护
- **幂等/异常**：二次 restore/purge、不存在 id、空快照清空、二次清空、异常多文件 entry、
  手工 entry 恢复进受保护目录 → 4xx
- **C1**：结构断言 `Trash ∈ fs._FORBIDDEN_ROOT`（**「显式声明」与「偶然 400」行为上不可区分，故必须两条都断言**）+ fs 全端点行为矩阵
- **契约一致性**：载荷键严格 == `{count,items}`、item 严格 5 字段、entry 名正则、`deleted_at` 由 id 前 15 位派生、
  `GET /api/trash` **不创建** `Trash/`（惰性）、20 次快速删除 entry 唯一、新增路径恰为契约三条 + 方法 51 + 仅新增 `RestoreBody`
- **快照审查**：内嵌 phase-1 冻结的 36 路径 / 47 方法 / 24 schema 副本，断言**基线零删除零改动**

---

## 5. 未验证 / 未覆盖（诚实声明）

- **无完整独立复核**：见 §0。`test_trash_verify.py` 的 6 红由 Lead 修复后由 Lead 复跑转绿，**无第三方确认**。
- **未出独立报告**：`verifier-trash` 未产出 `docs/verification-trash.md`（本文件由 Lead 代写）。
- **未做 GUI 验收**：回收站面板的实际渲染/手感未经主理人确认（侧栏「回收站」点开 → 列表/恢复/彻底删除/清空）。
- **Windows 真机未验证**：全部证据来自 WSL/Linux（pytest + TestClient）。NTFS 上 `os.replace` 与符号链接语义**未在真机确认**。
- **未压测**：数千条 entry 的 `GET /api/trash` 与 `Trash/` 目录遍历成本未量化。
- **未覆盖**：并发删除同一文档、多进程同时写 `Trash/`、`Trash/` 被外部工具批量修改后的行为。
- **范围外**（契约 §8 明确排除）：自动清理/保留策略、保留天数设置项、文件夹与附件的回收站、
  回收站内容预览、恢复撤销、任何正文引用重写。

---

## 6. 独立复跑与最终判定（`verifier-trash` 本人执行 · 2026-09-20 · HEAD `fff59cd`/`1cde79b`）

> 本节由**用例作者本人**在**当前 HEAD** 上执行，用于闭合 §0/§5 记录的「执行独立性降级」缺口：
> **用例设计 + 执行 + 判定现在同属非开发者一方**，且**不 import 任何 trash 实现模块**。

### 6.1 冻结锚点（跑前/跑后一致）
| 项 | sha256 |
|---|---|
| HEAD | `fff59cd`（后 `1cde79b` docs-only）；回收站后端文件自 `ff7e9b8` 起未再变动 |
| `backend/app/services/trash.py` | `c647cc15609b47e67c688caf3810de3c38fc5fdec16016c5da8aa55064f0fda5` |
| `backend/app/routers/trash.py` | `56ebbddac67cf3286e08ff719f37acceef59212ed2946ea4cc5b8cd16c469998` |
| `backend/tests/test_trash_verify.py`（本套件） | `73427719e8ae3a4215f84a5ed159fdf531a262edcf08dcdaa13c95d5eda44aee` |

### 6.2 实际命令与实际输出
```text
$ cd backend && python3 -m pytest -o addopts="" -q -p no:warnings tests/test_trash_verify.py --tb=line
120 passed in 4.15s        # HEAD 946bb02

$ cd backend && python3 -m pytest -o addopts="" -q -p no:warnings tests/test_trash_verify.py --tb=line
120 passed in 7.81s        # HEAD 090726f

# F-1…F-5 失败模式锚点（6 例）
$ python3 -m pytest ... -k "dedup_cap or symlink_entry or symlink_dir_inside or handmade_entry or entry_id_collision or path_param_naming"
6 passed, 114 deselected in 2.41s

# 全量后端
$ python3 -m pytest -o addopts="" -q -p no:warnings
735 passed, 6 skipped in 36.07s   # HEAD 945179f
735 passed, 6 skipped in 30.71s   # HEAD 090726f
735 passed, 6 skipped in 38.33s   # HEAD 1cde79b（最终；741 collected，含 task-46 的 62 例）
```

> 注：§1 表中的 `450 passed + 2 skipped` 是 `ff7e9b8` 时代的**历史数字**（当时仓库规模）；
> 当前 HEAD 的实测为 **735 passed + 6 skipped**（含本套件 120 例与 task-46 的 62 例），较立项基线 314+2 只增不减。
**判定：PASS（120/120；F-1…F-6 全部转 PASS）。**

### 6.3 「套件有牙齿」的控制组证据
在 `/tmp` 后端副本（`ctl2`，11:06:07 快照，**早于修复** `ff7e9b8` 11:18:24）上跑同一套件：
```text
6 failed, 114 passed in 8.22s
 - 去重上限耗尽：未捕获 FileExistsError（F-1）
 - purge 符号链接 entry：未捕获 OSError（F-2）
 - 符号链接 entry restore：200（F-3）
 - 手工 entry `Attachments/evil.md`：恢复成功 200（F-4）
 - 路径模板 `{entry_id}` ≠ 契约 `{id}`（F-6）
 - 同秒两次删除 → 实际 1 个 entry（F-5）
```
6 条红与 §3 表中 6 处缺陷**一一对应** → 断言确实能捕获真实缺陷，非空转。

### 6.4 假红留痕（方法学教训，Lead 要求）
| 快照 | 拷贝时刻 | 状态 | 与修复的关系 |
|---|---|---|---|
| `/tmp/ke-verify-ctl` | 09-15 **11:03:38** | `trash.py` 6161 B，0 处加固（MVP 初版） | **早于** `ff7e9b8`（11:18:24） |
| `/tmp/ke-verify-ctl2` | 09-15 **11:06:07** | 6788 B，仅 `_PROTECTED_TOP`；无 `is_doc_rel` / 无撞号检查 / 无 409 映射 | **早于** `ff7e9b8` |
| 当前工作树 | 2026-09-20 | 已含 `ff7e9b8` 全部加固 | 120/120 PASS |
**教训**：验证快照必须钉 commit + sha + 时刻，否则「已修」会被报成「现网缺陷」（我最初 6 条红的根因）。

### 6.5 低优先级观察（非 FAIL）
`backend/tests/test_openapi_snapshot.py` 文件头注释（:9）仍写 `DELETE /api/trash/{entry_id}`，
而 `SNAPSHOT_PATHS`（:47）已是 `/api/trash/{id}` —— 注释与基线文本不一致，建议同步。

### 6.6 本节的未验证项（沿用并补充 §5）
- **Windows/NTFS 真机语义**仍未验证：全部证据来自 WSL/Linux（pytest + TestClient）；
  `os.symlink`/junction、大小写不敏感 FS 下的恢复冲突（`X.MD` vs `x.md`）需真机另测。
- **崩溃/断电时序**未验证：C3 原子性仅以 **inode 不变** 作行为代理（rename 保留 inode）。
- **多进程并发删除**未压测：撞号用例是「冻结时间 + 冻结 token」的确定性构造，非自然概率复现。
- **GUI 端到端**未验证（回收站面板点选）：由 task-7 侧测试与 Lead 真机验收覆盖。
- **性能曲线**未量化：数千条 entry 的 `GET /api/trash` 遍历成本未测。

**最终判定（本节）：PASS。** 归属：F-1…F-6 均**本功能引入**、已修复并被本节独立复跑确认；
C1…C6 不变量与契约一致性实测通过；既有系统行为无回归（全量 `735 passed + 6 skipped`，基线 314+2）。
