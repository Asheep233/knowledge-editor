# 独立验证报告：发布前审查后端修复（B1 / B3 / M1 / M2 / M3 / M7 / M8）—— task-46

**结论：PASS**（独立套件 **61 passed + 1 skipped**，全量 **735 passed + 6 skipped / 0 failed**；5 个冻结 sha 跑前/跑后逐字一致；**未发现新绕过路径、未发现回归**）
**唯一平台限制**：M2/M3 的 Windows 真机大小写不敏感语义在 WSL/Linux 不可复现 → 标 `_win_only` 并给等价证据（谓词级单测 + 接线溯源 + Linux 保守行为），**不拿 Linux 结果冒充 Windows**。

- **验证者**：`verifier`（独立于 task-43 实现者 dev-attach；未修改任何被验证源码）
- **HEAD**：`70da983`
- **时刻**：run-start `2026-09-20T05:42:52Z` → run-end `2026-09-20T05:49:26Z`（UTC）
- **环境**：WSL2 / Python 3.14.4 / pytest 8.4.2
- **验证员产物**：`backend/tests/test_review_fixes_120.py`（**61 passed + 1 skip**，已把上任骨架的 42 处 `skip` 占位全部落地为实测断言并自推扩充）、本报告

## 0. 冻结修订（验证者自行复算，跑前 = 跑后）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `backend/app/services/markdown_io.py` | `32e72b65a7624ad8ac9482fd1cb235252b059c24a8118323e82ecc12f89af3be` |
| `backend/app/routers/fs.py` | `4b7cc1ff344848ba0ea4b64f9d60cf89fe219973c77879e8a85fdc270a470996` |
| `backend/app/routers/attachments.py` | `2cfa1393869f077b74234b53512ff93c3aac2a42a1983a7e41be35c3ffc56946` |
| `backend/app/main.py` | `930c38aea0a71d744108ab41905bf8c664a0e66ec7b10be4c010afdd74075127` |
| `backend/tests/test_review_pre2_fixes.py`（开发者） | `5cd4a56bc3c23999c8d00a29b7141560d40cf68ecd358c2bd2b66a8af7e937eb` |

> 与 Lead 给出的冻结值逐字一致；全部运行结束后再次复算，**5 个文件无一变化**。

## 1. 结论摘要（逐项）

| 审查项 | 结论 | 关键证据 | 归因 |
|---|---|---|---|
| **B1** `merge_frontmatter`/`set_meta` 保 BOM+CRLF | **PASS** | §3 四组合矩阵逐字节 + 真实 API sha256 + 反例 | **FIXED** |
| **B1 第二根因** `read_text` 折 CRLF | **PASS** | §3.4 读路径字节相等 + 原子写还原 + 索引 hash=字节 sha | **FIXED** |
| B1 副作用：索引 content_hash 变化 → 首次 reconcile | **PASS** | §3.6 升级场景模拟：陈旧 hash → reconcile 收敛且无重复行 | 无害（已核实） |
| **B3** rename 反斜杠穿越 | **PASS** | §4 8 变体 ×2 端点 400 + 工作区逐文件 sha 不变；resolve 级守卫真实命中 | **FIXED** |
| **M1** rename_doc 归一化顶层判定 | **PASS** | §5 `Articles/../Attachments/…` → 400、附件字节不变、引用链仍 409 | **FIXED** |
| **M2** 附件删除规范化 rel 比对 | **PASS** | §6 4 变体全 409 + 文件完好；孤儿仍可删；编码变体 400/409/404 均安全 | **FIXED**（Windows 大小写分支未能在 Linux 复现） |
| **M3** 附件顶层大小写不敏感 | **PASS（等价证据）** | §6.3 谓词单测 + 接线溯源 + Linux 保守行为；Windows 集成用例标 `_win_only` | **FIXED**（Windows 集成未验证） |
| **M7** KE_API_TOKEN 移除 | **PASS** | §7 源码无消费方 + 默认路径全通 + **子进程 KE_API_TOKEN=secret 实证 health/tree 200** | **FIXED** |
| **M8** 目录删除快照 + 容错 | **PASS** | §8 每篇快照可恢复 + 权限型失败 → 200+失败清单且其余继续删 + 无失败删不掉 409 + 全成功 204 | **FIXED** |
| 回归（fs/attachments/trash/history） | **PASS** | §2 全量 + 定向套件 0 failed | — |

## 2. 回归底线（实测）

```
$ cd backend && python3 -m pytest tests/test_review_fixes_120.py -o addopts="" -q
61 passed, 1 skipped in 4.68s          # 1 skip = Windows-only 集成用例（Linux 上标 _win_only）

$ python3 -m pytest tests/test_review_pre2_fixes.py -o addopts="" -q      # 开发者自测
35 passed, 3 skipped in 2.84s

$ python3 -m pytest --ignore=tests/test_review_fixes_120.py -o addopts="" -q
674 passed, 5 skipped in 29.70s

$ python3 -m pytest -o addopts="" -q                                       # 全量
735 passed, 6 skipped in 36.23s

$ python3 -m pytest tests/test_file_tree.py tests/test_attachments_mgmt.py tests/test_trash.py \
    tests/test_trash_hardening.py tests/test_hardening_f8_f4.py tests/test_v101_regressions.py \
    tests/test_delete_safety.py -o addopts="" -q
120 passed, 2 skipped in 10.05s
```
**计数对账（精确闭合）**：`674（除我之外）= 666（dev 基线）− 1（上任骨架的 sanity）+ 9（并行新增 test_trash_hardening.py）`；
`735 = 674 + 61（本验证套件）`；`skipped 6 = 47（dev 基线）− 42（占位 skip 移除）+ 1（我的 _win_only）`。
→ **passed 只增不减**（735 > 630 任务基线，> 666 dev 基线），**0 failed**；占位 skip 由 42 降为 0（本文件仅剩 1 个平台 skip）。

## 3. B1：字节级矩阵（最高优先）

### 3.1 `merge_frontmatter` / `set_meta` × {无BOM,BOM} × {LF,CRLF}（8 例）
断言：**原 BOM + 原 frontmatter 块换行风格 + 原 title 等键 + 新正文**，逐字节相等。
```
 ✓ no-bom-lf / bom-lf / no-bom-crlf / bom-crlf × merge_frontmatter
 ✓ no-bom-lf / bom-lf / no-bom-crlf / bom-crlf × set_meta
```
关键实测（BOM+CRLF，merge）：
```
实际 = '\ufeff---\r\nke_version: 1\r\ntitle: 我的文档\r\n---\r\n\r\n正文（编辑后）\r\n'
       ↑BOM    ↑块 CRLF 保留              ↑既有 title 插回        ↑载荷正文（LF）
```
`set_meta`（BOM+CRLF）实测：`'\ufeff---\r\ntitle: 新标题\r\nke_version: 1\r\n---\r\n\r\n正文第一行\r\n'` ——
**旧实现会丢 BOM、折块 CRLF、连 `---` 后的空行一起丢**（附录 A 真实旧模块执行对照）。

### 3.2 反例与结构边界（5 例，全绿）
- **无 BOM + LF 文档不得被改成 BOM/CRLF**：`merge_frontmatter` / `set_meta` 双路径 + **真实 API 双路径**（PUT `/articles` + PUT `/meta`）均断言 `not startswith(BOM)` 且 `b"\r\n" not in bytes` ✓
- 旧文无 frontmatter → 原样返回新内容（不补 BOM、不造块）✓
- 新文无 frontmatter → 旧块逐字节前置 + BOM 还原 ✓
- **混合换行**（块 CRLF + 正文 LF）实测输出（如实记录，不猜测）：
  ```
  '\ufeff---\r\nke_version: 1\r\ntitle: 混排\r\n---\r\n\r\n正文（编辑后）\n'
  ```
  → 块 CRLF 保持、正文随载荷 LF；**未引入新的块风格** ✓

### 3.3 真实 API 端到端（含前后 sha256）
```
[ke-verify] B1 PUT /articles: before=f377c4733be290fe… after=2269a0ac1707c4aa…（期望 2269a0ac1707c4aa…）
[ke-verify] B1 PUT /meta 落盘 sha256=cc06c4981fef00caac9f1987a2b384641aea43dbe6387d37354be3180693fd8f
```
- 构造：磁盘先写 `BOM + CRLF + title + ke_version` 的文档 → PUT 载荷模拟 WYSIWYG（frontmatter 仅 `ke_version`）→ 断言落盘字节 = `BOM + CRLF 块（含 title）+ 新正文`；返回体与磁盘一致 ✓
- **连续保存两次**：第二次 sha256 与第一次相同（损坏不重演）✓
- **PUT /meta**：BOM / 块 CRLF / 正文逐字节不变，仅 title 更新 ✓

### 3.4 第二根因：`read_text` 读路径逐字节（2 例）
```
 ✓ read_text(BOM+CRLF 文件) == 原始字节解码；对照 Path.read_text() 确实折 CRLF（差异真实存在）
 ✓ atomic_write(read_text(x)) 字节还原 == 原文件
```
本仓库内不存在「读时折行、写时无法还原」的残余路径（`read_text` 之外无其它 Markdown 读取入口参与保存链）。

### 3.5 判别性（非空测试）
按**修复前算法**（块重建 `splitlines()` + `"\n".join()`）复现 → `BOM 丢 + 块 CRLF 折成 LF`；新实现两者皆保 → 旧/新可区分（否则判 FAIL）✓

### 3.6 索引副作用复核（升级场景模拟）
```
 ✓ 索引 content_hash == 磁盘字节 sha256（逐字节读后二者同源）
 ✓ 全量 rebuild 幂等（前后一致，无重复行）
 ✓ 升级模拟：把 hash 改成「旧读法（折 CRLF）」结果 → 首次 reconcile 收敛回字节 hash；
   文档行仍恰好 1 行（无重复/丢失）→ 与 dev 备注一致：**首次 reconcile 重建一次，无害**
```

## 4. B3：穿越族（rename_dir / rename_doc）

参数化 8 个危险名 × 2 端点，全部 **400/409 + 工作区文件集合与逐文件 sha256 完全一致**：
```
..\..\evil / ..\..\..\evil / a\b / \evil / ..\evil\..\x / ../evil / .. / .
```
- **resolve 级守卫真实命中**（不是被字符串校验顺带拦下）：构造 `Articles/link` → 区外目录的符号链接、`Articles/dangling` → 区外悬空路径，把目录改名为**单组件名** `link`/`dangling`：
  ```
  [ke-verify] B3 符号链接守卫（指向区外已存在目录）-> 400 新名称越出工作区
  [ke-verify] B3 符号链接守卫（指向区外悬空路径）-> 400 新名称越出工作区
  ```
  且工作区外目标目录保持为空、悬空目标未被创建 ✓
- 目标已存在 → 409 且被撞文件字节不变、源文件保留 ✓
- 业务顶层目录（`Articles`）改名仍拒 ✓
- POSIX 合法名（CJK/空格）改名仍 200 ✓；**边界如实记录**：拒绝的是「**新名称**含 `\`」；磁盘上既有含 `\` 的字面名仍可被改为合法名（200）——代码注释已声明「全平台拒绝新名中的 `\`」为有意为之

## 5. M1：rename_doc 归一化顶层判定

```
 ✓ PUT /api/fs/doc {"path":"Articles/../Attachments/files/被引用.pdf","new_name":"改掉"} → 400
   请求前后工作区逐文件 sha256 完全一致；附件字节不变；随后 DELETE 该附件仍 409（引用链完好）
 ✓ 合法 `Articles/sub/../x.md` 归一化改名 → 200（不误伤）
```

## 6. M2 / M3：附件引用保护

### 6.1 M2 变体（被引用附件不得被删）
4 种等价输入全部 **409** + 文件仍在 + 字节不变：
`plain` / `Attachments/files//x.pdf` / `Attachments/files/./x.pdf` / `Attachments/files/../files/x.pdf`
编码/反斜杠变体实测：
```
[ke-verify] M2 编码/反斜杠变体实测状态: [('Attachments/files/%2e%2e/files/编码.pdf', 400),
                                        ('Attachments/files%2F编码.pdf', 409),
                                        ('Attachments%5Cfiles%5C编码.pdf', 404)]
```
→ 无一删除被引用附件 ✓

### 6.2 正向对照（保护不得扩大化）
孤儿附件经 `//` 变体删除 → **200 且文件消失** ✓

### 6.3 M3 等价证据（Linux 可测部分）
```
 ✓ 谓词单测：Attachments/x / attachments/x / ATTACHMENTS/a/b → True；
             Articles/x → False；Attachments（顶层自身）→ False；Attachments1/x → False（前缀不误伤）
 ✓ 接线溯源：fs.py 中 `_is_under_attachments(` 出现 ≥3 处；旧的 `startswith(DIR_ATTACHMENTS + "/")` 已无残留
 ✓ Linux 保守行为：真实存在的小写 `attachments/files`（无引用）仍可删（保护不阻断正常操作）
```
`test_m3_delete_dir_case_variant_top_windows` 标 `@_win_only`（Linux 上 skip，计入 1 skipped）；
**Windows 真机的大小写不敏感 FS 行为未验证**（见 §11）。

## 7. M7：KE_API_TOKEN 移除

```
 ✓ 源码级：除 config.py 常量定义外，app/** 无 KE_API_TOKEN/API_TOKEN/x-ke-token/X-KE-Token 消费方；
          main.py 中间件不再含 token 校验分支
 ✓ 默认路径：health 200；OPTIONS /api/tree（带 Origin+Request-Method）→ 2xx 且含
          access-control-allow-origin；GET /api/tree 200；文档 创建/GET/PUT 全通
 ✓ 子进程实证（真实设 KE_API_TOKEN=secret 的解释器）：
          {"token_env": "secret", "health": 200, "tree": 200}   ← 修复前该环境变量会 401 砖掉应用
```

## 8. M8：目录删除快照 + 容错

| 用例 | 实测 |
|---|---|
| 目录内 2 篇 .md → DELETE 目录 | **204**；每篇都有 history 快照；`/api/history/restore` 恢复后**字节 == 原文** ✓ |
| **per-file 失败**（真实权限错误：子目录 chmod 0555，等价 Windows 文件锁） | **200** + `{"removed": …, "failed":[{"path":"Articles/混合/锁住/keep.md","error":…}]}`；其余文件继续删除；失败文件仍存在且字节不变；**失败文件也已有删除前快照** ✓ |
| 无 per-file 失败但目录删不掉（并发写入：扫描期隐藏文件） | **409**（未被 200 吞掉），幽灵文件未被误删 ✓ |
| 全部成功 | **204**（既有契约不变）✓ |
| 目录内含被引用附件 | **409** 且目录/文件全部原地不动（P2-15 不回归）✓ |
| 文档级删除 | **204** + 快照 + **进回收站**（不回归）✓ |
| 空目录删除 | **204** ✓ |

## 9. 范围核对

```
$ git status --porcelain | grep -E "backend|docs/verification-review"
?? backend/tests/test_review_fixes_120.py          # 验证员产物（唯一新增）
```
被验证的 5 个文件哈希全程未变（§0）；其余工作树改动均属并行任务（frontend/desktop 等），**我未触碰**。

## 10. 归因汇总

| 项 | 归因 | 说明 |
|---|---|---|
| B1 / B1 第二根因 | **FIXED** | 真实旧模块执行对照见附录 A：四组合全部 BOM=False/块 CRLF=False → 修复后 BOM/块风格按原样保留 |
| B3 / M1 / M2 / M3 / M7 / M8 | **FIXED** | 审查报告给出了「修复前」实测；本轮我独立复验「修复后」全部通过（含 8×2 穿越变体零副作用） |
| REGRESSION | **未发现** | 全量 0 failed；定向 fs/attachments/trash/history 套件 120 passed；文档级删除/孤儿删除/全成功 204 契约不变 |
| 唯一边界变化 | **有意为之（已声明）** | rename 新名含 `\` 全平台拒绝（POSIX 字面名场景）；代码注释与审查报告均声明 |

## 11. 未验证项（明确声明，无推测结论）

| 项 | 原因 |
|---|---|
| **M2/M3 的 Windows 真机大小写不敏感行为** | WSL/Linux 文件系统大小写敏感，`USED.PNG` 命中 `used.png` 的语义不可复现；已给谓词级单测 + 接线溯源 + `_win_only` 集成用例（Linux skip），未执行 Windows 真机 |
| Windows 文件锁导致的真实 per-file 失败 | 用 POSIX 权限失败（chmod 0555）作为**等价**失败注入；未在 Windows 上构造锁文件 |
| B2 / B4（桌面退出握手、工作区切换 discardPending） | 属 frontend/desktop 范围，不在本任务（后端修复）验证对象内 |
| 并发目录删除 / watcher 并发竞争 | 未构造并发场景 |
| 超大目录（数千文件）删除性能与快照耗时 | 未做性能测量；仅验证正确性 |
| 修复提交外的并行工作树改动 | 未纳入本次验证（哈希未覆盖） |

## 12. 复现命令

```bash
cd "/mnt/f/Work/KE Project/knowledge-editor/backend"
python3 -m pytest tests/test_review_fixes_120.py -o addopts="" -q        # 61 passed + 1 skipped
python3 -m pytest tests/test_review_pre2_fixes.py -o addopts="" -q      # 35 passed + 3 skipped
python3 -m pytest -o addopts="" -q                                      # 735 passed + 6 skipped
python3 -m pytest tests/test_review_fixes_120.py -o addopts="" -q -s    # 含 B1/守卫/M2 实测打印
```

## 附录 A：修复前 vs 修复后（**真实旧模块执行**对照）

方法：`git show dc4f99e^:backend/app/services/markdown_io.py` 落盘为临时包 `pkg.services.markdown_io`（附 `pkg.config` 常量 shim），与修复后模块对**同一输入**执行比较。

| 组合（BOM / EOL） | 修复前 (BOM, 块CRLF, 正文CRLF) | 修复后 (BOM, 块CRLF, 正文CRLF) |
|---|---|---|
| 无 BOM / LF | (False, False, False) | (False, False, False) |
| 无 BOM / CRLF | (False, False, False) | (False, **True**, False) |
| BOM / LF | (**False**, False, False) | (**True**, False, False) |
| BOM / CRLF | (**False**, **False**, False) | (**True**, **True**, False) |

```
修复前 merge（BOM+CRLF）: '---\nke_version: 1\ntitle: 我的文档\n---\n\n正文（编辑后）\n'      ← BOM 丢、块折 LF
修复后 merge（BOM+CRLF）: '\ufeff---\r\nke_version: 1\r\ntitle: 我的文档\r\n---\r\n\r\n正文（编辑后）\n'
修复前 set_meta（BOM+CRLF）: '---\ntitle: 新标题\nke_version: 1\n---\n正文第一行\r\n'          ← 连 --- 后空行也丢
修复后 set_meta（BOM+CRLF）: '\ufeff---\r\ntitle: 新标题\r\nke_version: 1\r\n---\r\n\r\n正文第一行\r\n'
```
（正文列在两者均为 False 属预期：本次载荷以 LF 构造，正文风格随前端载荷；契约只要求**原 BOM + 原块风格 + 新正文**。）
