# 独立验证报告：K3-I2 方案 A 启动自愈 —— task-23

**结论：PASS**（验证员套件 **19/19 passed**；全量 **630 passed + 2 skipped** = 597 基线 + 19 验证员 + 14 开发者；`test_openapi_snapshot.py` 3 passed；跑前/跑后 3 个冻结 sha 逐字一致；范围无越界；**未发现任何用户内容被删除或改写**）

- **验证者**：`verifier`（独立于 task-21 实现者 dev-attach；未修改任何被验证源码）
- **HEAD**：`96a34be`
- **时刻**：run-start `2026-09-17T03:36:00Z` → run-end `2026-09-17T03:37:33Z`（UTC）
- **环境**：WSL2 / Python 3.14.4 / pytest 8.4.2
- **验证员产物**：`backend/tests/test_self_heal_verify.py`（19 例）、本报告

## 0. 冻结修订（验证者自行复算，跑前 = 跑后）

| 文件 | sha256（跑前 = 跑后） |
|---|---|
| `backend/app/services/self_heal.py` | `88d533733a8c595e958459d9c1792513a17195d7062d91e1e89214c8d9d4eaa4` |
| `backend/app/main.py` | `f5f11a0e988c71efd24fb5114b8c7b0728cea164fea4989e0943b663d92c058f` |
| `backend/tests/test_self_heal.py`（开发者） | `326642fb9e273d37b8410cf70a45fa74dee4c38abd1c208cf02b500c5a42ce87` |

> 与 Lead 给出的冻结值逐字一致；全部用例跑完后再次复算，**3 个文件无一变化**。
> 范围核对见 §9（含并行任务的 `LeftSidebar.*` 与 `docs/verification-attach-collapse.md`，**非本任务、我未触碰**）。

## 1. 结论摘要

| 验证面 | 结论 | 证据 |
|---|---|---|
| 崩溃窗口真复现（不调自愈函数） | **PASS** | §3：A1–A4 + 手工前后 JSON |
| 歧义 fail-safe（0 / 2 候选一律不动 + 日志） | **PASS** | §4：B1–B3 |
| 幂等（第二次启动零变化） | **PASS** | §5：C1（sha + mtime_ns + DB 行 + GET 四重） |
| 非破坏性（孤儿快照保留 / 全工作区不变量） | **PASS** | §6：D1–D2 |
| 不阻断启动（内部异常 + 入口异常） | **PASS** | §7：E1 / **E1b（加固后升格为硬契约）** / E2 |
| 边界（空工作区 / 缺目录 / 损坏名 / 子目录 / `.markdown` / hash 优先） | **PASS** | §8：F1–F6 |
| 回归底线 | **PASS** | §2：630 passed + 2 skipped，只增不减 |

## 2. 回归底线（实测）

```
$ cd backend && python3 -m pytest tests/test_self_heal_verify.py -o addopts="" -q
19 passed in 4.09s

$ python3 -m pytest tests/test_self_heal.py -o addopts="" -q        # 开发者自测
14 passed

$ python3 -m pytest tests/test_openapi_snapshot.py -o addopts="" -q
3 passed in 2.34s

$ python3 -m pytest -o addopts="" -q                                # 全量
630 passed, 2 skipped in 34.08s
```
**计数对账**：`597（基线 passed）+ 19（验证员）+ 14（开发者）= 630`，skip 仍为 **2**；只增不减 ✓

## 3. 崩溃窗口真复现（最高优先）

**方法**：**不调用任何自愈函数**——启动前直接构造崩溃后磁盘状态（文档只在新路径 + `Drafts/recovery/` 草稿带旧路径 hash + 直接写 SQLite `recovery` 行指向旧路径），随后走**真实启动路径**：`app/main.py::lifespan` → `activate_workspace(config.WORKSPACE_ROOT)` → `run_startup_self_heal(...)`（测试把 `config.WORKSPACE_ROOT` 指向本用例工作区，跑完恢复）。

| 用例 | 断言 | 结果 |
|---|---|---|
| A1 完整崩溃态 | 草稿改名到规范名、旧草稿消失、**内容逐字节不变（sha256）**、`GET /recovery` 唯一一条且 doc_path/draft_path 同步、**记录 id 保留**、DB 行同步 | ✓ |
| A2 仅文件态（无 DB 记录） | 仍重挂到规范名，GET 在新路径可取，旧占位记录不出现 | ✓ |
| A3 反向残缺（记录指旧路径、草稿已新 hash） | 硬断言：零内容损失 + 启动可用（记录侧兜底 `reconcile_recovery_records` 的修正作观察项） | ✓ |
| A4 hash 命中（已规范） | 路径/字节/**mtime_ns** 全不动（幂等基线） | ✓ |

**手工前后对照（验证员实测，非转述）**：
```
=== 自愈前（磁盘 + DB）===
  draft 文件: ['report-7a4bb084.draft.md']
  DB 记录   : [{"id": 1, "doc_path": "Articles/report.md",
                "draft_path": "Drafts/recovery/report-7a4bb084.draft.md",
                "saved_at": "2026-09-17T03:37:41+00:00", "session_id": "sess-x"}]
  新路径文档: True | 旧路径文档: False

=== 自愈后 GET /api/drafts/recovery ===
  {"count": 1, "items": [{"id": 1, "doc_path": "Articles/归档/report.md",
    "draft_path": "Drafts/recovery/report-254a7df3.draft.md",
    "saved_at": "2026-09-17T03:37:41+00:00", "session_id": "sess-x"}]}

=== 自愈后（磁盘 + DB）===
  draft 文件: ['report-254a7df3.draft.md']        # 旧 hash 名 → 新 hash 名
  DB 记录   : id / saved_at / session_id 全部保留，doc_path 已同步为新路径
```
> 设计取舍记录（Lead 已认可）：**「换名类」崩溃窗口**（如 `a.md → b.md`，stem 改变）按「唯一 stem 匹配」规则**不可自愈**（0 候选 → 不动，fail-safe）——由 B1 覆盖，按设计取舍记录，**不算缺陷**。

## 4. 歧义必须 fail-safe

| 用例 | 构造 | 断言 | 结果 |
|---|---|---|---|
| B1 | 0 候选（草稿 stem 无任何现存文档；含「换名窗口」场景） | 草稿原样保留（不删不改名）、无规范名新文件、**全量快照零变化**、有 WARNING 日志、不误挂到无关文档 | ✓ |
| B2 | 双候选 `Articles/foo.md` + `Modules/foo.md` | 不改名到**任一**候选、快照零变化、WARNING 日志 | ✓ |
| B3 | 同名但仅在 `Attachments/files/report.md` 与 `Trash/.../Articles/report.md` | 不挂（口径仅 `Articles/`+`Modules/`）、快照零变化 | ✓ |

## 5. 幂等

**C1**：连跑两次真实启动，第二次前后比较四重指标——全量 `rel→sha256`、逐文件 `mtime_ns`、DB `recovery` 行、`GET /api/drafts/recovery` 结果 → **完全一致**（第二次零变化）。✓

## 6. 非破坏性（任何用户内容不得被删/改写）

- **D1**：孤儿 `Drafts/backup/Articles/gone.md/20260101-000000.md` → 启动后**仍在**且内容 sha 不变（「只统计不删除」落实）✓
- **D2 全工作区不变量**：启动前后文件增删集合必须**恰好** = `{新草稿}`（新增）/ `{旧草稿}`（删除），其余文件（含另一篇文档、另一份孤儿快照）一律**内容不变**；实测完全吻合 ✓

## 7. 不阻断启动（含 E1b 加固前后对照）

| 用例 | 注入点 | 断言 | 结果 |
|---|---|---|---|
| E1 | **内部步骤**（`heal_recovery_drafts`/`count_backup_orphans`/`reconcile_recovery_records`） | `/api/health` 200、`/api/tree` 200；**判别性**：注入生效 ⇒ 崩溃态保持未愈 | ✓ |
| **E1b** | **总入口整体替换为抛异常函数** | 应用仍能启动、`/api/health` 200、`/api/tree` 200（**硬断言 `survived is True`**）；判别性：崩溃态未愈 | ✓（加固后） |
| E2 | — | openapi 无自愈相关新端点（`/api/health` 除外） | ✓ |

**E1b 加固前 vs 加固后（Lead 采纳后升格为硬契约，前后对照）**：
```
task-23 第一段（加固前 main.py，仅观察记录）：
  [ke-verify] E1b 观察：入口注入后启动失败（RuntimeError: verifier-injected entry failure）→ 调用点无兜底
本冻结版（main.py 调用点已 try/except Exception → logger.exception）：
  E1b PASS —— 入口整体抛异常时应用照常启动（survived is True），崩溃态保持未愈（注入确实生效）
```
冻结版 `main.py:79-88`（注释 + `try: run_startup_self_heal(...)` + `except Exception: logger.exception(...)`）已具备调用点兜底，与入口自身的内部 try/except 形成双保险。

## 8. 边界

| 用例 | 构造 | 结果 |
|---|---|---|
| F1 空工作区 | 无文档无草稿 | 启动 OK、`GET /recovery` 空、快照零变化 ✓ |
| F2 缺 `Drafts/recovery/` | 启动前删除该目录 | 启动 OK、不凭空产生草稿 ✓ |
| F3 损坏草稿名 | `broken.md` / `no-hash.draft.md` / `x-zzzzzzzz.draft.md` / hash 位数不足 | 4 个文件全部原样保留、快照零变化 ✓ |
| F4 子目录候选 | `Articles/Sub/nested.md` + 旧 hash 草稿 | 唯一 stem → 重挂到 `Articles/Sub/nested.md` ✓ |
| F5 `.markdown` 候选 | `Modules/mod.markdown` | 重挂 ✓ |
| F6 hash 命中优先 | 草稿 hash 命中 `Articles/same.md`，另有同 stem 的 `Modules/same.md` | **不动**（不误改挂）✓ |

## 9. 范围核对与「验证员自曝的假设修正」

```
$ git status --porcelain
 M backend/app/main.py                                  # task-21（dev）
 M frontend/src/components/layout/LeftSidebar.test.tsx  # 并行任务（非本任务，未触碰）
 M frontend/src/components/layout/LeftSidebar.tsx
 M frontend/src/components/layout/LeftSidebar.verify.test.tsx
?? backend/app/services/self_heal.py                    # task-21（dev）
?? backend/tests/test_self_heal.py                      # task-21（dev）
?? backend/tests/test_self_heal_verify.py               # 验证员产物
?? docs/verification-attach-collapse.md                 # 并行任务的验证报告（非本任务）
```

**我在第一段自曝并修正的两处自身假设错误**（透明度留痕，Lead 已确认改法正确）：
1. **触发点**：自愈挂在 `main.py::lifespan`、作用于 `config.WORKSPACE_ROOT`；我最初 `TestClient + activate_workspace(ws)` 的 boot 根本没打到测试工作区（造成一批假红）。现改为启动前把 `config.WORKSPACE_ROOT` 指向本用例工作区，走**真实 lifespan 路径**。
2. **stem 语义**：自愈按「唯一 stem 匹配」；我原先用 `a.md → b.md`（换名）构造崩溃窗口，按设计就该「0 候选 → 不动」。现改为**同 stem 的真实移动窗口**（`Articles/x.md → Articles/归档/x.md`），并把换名窗口作为 fail-safe 用例 B1 显式锁定。
3. 另修正 2 个自测 bug（F3 漏写夹具文件、B1 用规范名当"旧名"）与 1 处用例拆分（异常注入拆为 E1 内部 / E1b 入口）。

## 10. 归因

| 项 | 归因 |
|---|---|
| 崩溃窗口收敛（草稿重挂 + 记录迁移） | 本任务新实现，**按规格工作**（A1–A4 全绿，内容零改写） |
| 歧义 fail-safe / 幂等 / 非破坏性 | 本任务新实现，全部符合规格（B/C/D 全绿） |
| 启动韧性调用点兜底 | **第一段由我作为纵深观察提出 → Lead 采纳并加固** → 本轮升格为硬契约并实测通过（E1b 前后对照） |
| 用户内容删除/改写 | **未发现任何一例**（D2 全工作区不变量逐文件 sha 比对） |
| 换名窗口不可自愈 | 设计取舍（唯一 stem 匹配），任务书已认可，非缺陷 |

## 11. 未验证项（明确声明，无推测结论）

| 项 | 原因 |
|---|---|
| 真实进程崩溃注入（rename 中途 kill -9） | 未做信号级崩溃注入；本报告用「启动前直接构造崩溃后状态」等价复现（正是 task-23 要求的方法） |
| 真实 sidecar/桌面（Tauri）启动链 | 测试经 `TestClient` lifespan（与生产同一 lifespan 代码路径），未启动真实 sidecar 进程 |
| 大规模工作区性能（数千草稿/备份目录） | 未做性能测量；仅验证正确性 |
| 跨文件系统差异（Windows/NTFS rename 语义、大小写不敏感） | 本环境 WSL2 + ext4 |
| 启动自愈与 watcher/前端并发 | 未构造并发场景 |
| dev 自测 14 例的逐条断言强度 | 我只独立复核其通过性，未逐条审其判据（不在验证对象内） |

## 12. 复现命令

```bash
cd "/mnt/f/Work/KE Project/knowledge-editor/backend"
python3 -m pytest tests/test_self_heal_verify.py -o addopts="" -q     # 19 passed
python3 -m pytest tests/test_self_heal.py -o addopts="" -q            # 14 passed（开发者）
python3 -m pytest tests/test_openapi_snapshot.py -o addopts="" -q     # 3 passed
python3 -m pytest -o addopts="" -q                                    # 630 passed, 2 skipped
sha256sum app/services/self_heal.py app/main.py tests/test_self_heal.py
```
