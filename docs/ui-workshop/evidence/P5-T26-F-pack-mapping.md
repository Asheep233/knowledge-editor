# P5-T26 F 台账：pack 路径证据映射（task-32，2026-10-19）

> 规则：只把**能力确实可达且语义一致**的行填真实结果；不可达/语义不符一律 NOT_RUN 并写原因；**不得把「官方 UI 通过」映射成 pack 通过**。本任务不启动产品实例，仅引用既有 W 证据。

## 1. 证据来源（既有产品 W，全部 PASS）

| 证据文件 | 关键 W check | 覆盖能力 |
| --- | --- | --- |
| `P5-T26-G1G2-content-io.md` | W-T26-G1G2-4/5（snapshot=磁盘原文+hash）、-8/-9（真实落盘/回读）、-10/-11（CAS 冲突） | context.read 读正文 / context.write CAS 写 |
| `P5-T26-W02-form.md` | W-T26-W02-3/4（title）、-4b（tags）、-5（未知命令拒绝） | article.set-title/tags command.invoke 元数据写 |
| `P5-T26-G3G4-print-events.md` | -6/7/8（真实 PDF token/文件/%PDF/多 token）、-11（真实保存落盘）、-12/13（document-saved+revision 一致）、-14（context-changed）、-15（theme-changed） | print.snapshot、document-saved/context-changed/theme-changed 事件 |
| `P5-T26-G7-reference-packs.md` | W-G7-10（A 读快照 frontmatter+正文+diskHash）、-12（A 真实 PDF）、-14/15（A document-saved+自动刷新）、-20..22（B 读快照/提交 title/tags 落盘） | pack A 读/打印/事件；pack B 读/元数据写 |
| `P5-T26-pack-editor-cmd.md` v10 | W-T26-7..27（pack B 18 命令/doc.save）、W-T31-7..27（pack A 18 命令/doc.save） | 14 切换命令 + 4 动作（含 doc.save 真实落盘） |
| `P5-T26-W06-boundary.md` | W-T26-W06-3（fetch 阻断）、-6（越权 E_CAPABILITY） | guest 网络边界（→ 不可达判定依据） |

## 2. 可达行 → pack 路径（本次新增/更新）

| featureId | 域 | 能力 | 证据（文件/W check） | 结论 |
| --- | --- | --- | --- | --- |
| `CMD.doc.save` | F15 | doc.save 产品保存动作（guest command.invoke） | P5-T26-pack-editor-cmd.md v10：W-T31-27（pack A）/ W-T26-27（pack B）；磁盘 marker+mtime 断言 | PASS×2（真实落盘） |
| `W05` | P3/P4 | 协议快照/订阅（事件）/命令结果 | P5-T26-G1G2-content-io.md、P5-T26-G3G4-print-events.md、P5-T26-G7-reference-packs.md、P5-T26-W02-form.md、P5-T26-pack-editor-cmd.md | PASS×2 |
| `W02` | P3/P4 | UI 激活 + 表单交接（command.invoke 元数据写） | P5-T26-W02-form.md W-T26-W02-3/4/4b；P5-T26-G7-reference-packs.md W-G7-20..22 | PASS（pack B） |
| `F02` | F02 | F02 域（元数据写 + fs 操作） | P5-T26-W02-form.md；P5-T26-W06-boundary.md | packA NOT_RUN 原因更新 / packB 保持 PASS |
| `F07` | F07 | F07 域（手动/自动保存、恢复登记） | P5-T26-pack-editor-cmd.md v10 W-T26-27/W-T31-27；P5-T26-G3G4-print-events.md W-T26-G3G4-12；P5-T26-G7-reference-packs.md W-G7-14/15 | PARTIAL（新证据；原 NOT_RUN） |
| `F10` | F10 | F10 域（搜索/高亮/tags/索引） | P5-T26-W02-form.md W-T26-W02-4b | packA 原因更新；packB 保持既有 PASS（范围见映射表） |

## 3. 不可达行 → 如实 NOT_RUN（本次补原因，原空白）

| featureId | 域 | 能力 | 证据（文件/W check） | 结论 |
| --- | --- | --- | --- | --- |
| `API.fs.put._dir` | F02 | 后端 fs 写入 API | P5-T26-W06-boundary.md W-T26-W06-3/6 | NOT_RUN（能力不可达） |
| `API.fs.put._doc` | F02 | 后端文档写入 API | P5-T26-W06-boundary.md W-T26-W06-3 | NOT_RUN（能力不可达） |
| `API.fs.post._move` | F02 | 后端移动 API | P5-T26-W06-boundary.md W-T26-W06-3 | NOT_RUN（能力不可达） |
| `API.fs.get._events` | F02 | 后端文件事件 API | P5-T26-W06-boundary.md；P5-T26-G3G4-print-events.md W-T26-G3G4-12/14/15 | NOT_RUN（能力不可达） |
| `API.modules.get.root` | F06 | 后端模块列表 API | P5-T26-W06-boundary.md；P5-T26-pack-editor-cmd.md（18 命令不含 module） | NOT_RUN（能力不可达） |
| `API.modules.get._{module_path:path}` | F06 | 后端模块内容 API | P5-T26-W06-boundary.md | NOT_RUN（能力不可达） |
| `API.drafts.post._recovery_restore` | F07 | 后端草稿恢复 API | P5-T26-W06-boundary.md；P5-T26-pack-editor-cmd.md v10 | NOT_RUN（能力不可达） |
| `API.index.post._rebuild` | F10 | 后端索引重建 API | P5-T26-W06-boundary.md | NOT_RUN（能力不可达） |
| `API.tags.get.root` | F10 | 后端 tags 列表 API | P5-T26-W06-boundary.md；P5-T26-W02-form.md | NOT_RUN（能力不可达，读路径） |
| `API.tags.get._{tag_name}` | F10 | 后端 tags 查询 API | P5-T26-W06-boundary.md | NOT_RUN（能力不可达） |

## 4. 域级行语义核对

- **F02**：pack B 经 article.set-title 写 frontmatter（元数据切片，既有 PASS）；文件/目录新建/改名/移动/删除无受控协议 → 域行 PARTIAL 语义，pack A 不覆盖（NOT_RUN 原因已更新）。
- **F06**：pack A/B 既有 PASS 的覆盖范围 = `context.snapshot` 读 basic.md 的 **KE 信息块/公式原文（只读）**；渲染/交互/视频/未知标记 UI 面不经 pack → 既有 PASS 仅代表「原文可读」切片。
- **F07**：pack A/B 可用 `doc.save` 触发产品真实保存（磁盘断言）+ pack A 实测收到 document-saved 事件 → **PARTIAL**（自动保存注册/草稿恢复无通道）。
- **F10**：pack B 既有 PASS 仅覆盖 **tags 写入**（article.set-tags）；搜索/高亮/索引重建不可达 → 既有 PASS 范围见备注。pack A 无 tags/搜索通道。
- **F12**：pack A/B 既有 PASS 的覆盖范围 = `context.snapshot` 返回**正文原字符串（含 frontmatter，256KB 大文档可读）**；源码模式 UI/BOM/CRLF 处理/HTML 呈现不经 pack。
- **F14**：pack A 既有 PASS = `print.snapshot` → 真实 PDF（隔离目录 %PDF>1000B）；pack B 未声明 print.request → NOT_RUN（能力面）。

## 5. 统计（按域：packA PASS / packB PASS / PARTIAL / NOT_RUN 行）

| 域 | 行数 | packA PASS | packB PASS | packA PARTIAL | packB PARTIAL | packA NOT_RUN | packB NOT_RUN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| F01 | 10 | 0 | 0 | 0 | 0 | 10 | 10 |
| F02 | 6 | 0 | 1 | 0 | 0 | 6 | 1 |
| F03 | 42 | 18 | 18 | 1 | 1 | 23 | 23 |
| F04 | 1 | 0 | 0 | 0 | 0 | 1 | 1 |
| F05 | 1 | 0 | 0 | 1 | 0 | 0 | 1 |
| F06 | 3 | 1 | 1 | 0 | 0 | 2 | 0 |
| F07 | 3 | 0 | 0 | 1 | 1 | 2 | 1 |
| F08 | 4 | 0 | 0 | 0 | 0 | 4 | 4 |
| F09 | 5 | 0 | 0 | 0 | 0 | 5 | 5 |
| F10 | 5 | 0 | 1 | 0 | 0 | 5 | 1 |
| F11 | 3 | 0 | 0 | 0 | 0 | 3 | 3 |
| F12 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| F13 | 6 | 0 | 0 | 0 | 0 | 6 | 6 |
| F14 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| F15 | 19 | 2 | 1 | 0 | 0 | 17 | 18 |
| F16 | 11 | 0 | 0 | 0 | 0 | 11 | 11 |
| P3/P4 | 9 | 1 | 2 | 0 | 0 | 8 | 7 |
| **合计** | **130** | **24** | **25** | **3** | **2** | **103** | **93** |

## 6. 未映射原因汇总

- **网络边界/无受控协议**：/api/fs/*、/api/modules/*、/api/drafts/*、/api/index/*、/api/tags/* 等 10 行（原空白）→ NOT_RUN+w06 原因；
- **语义只部分覆盖**：F07（保存切片可达，自动保存/恢复不可达）→ PARTIAL；F06/F12/F14 既有 PASS 仅覆盖「只读原文/真实 PDF」切片（备注说明，不扩大解释）；
- **不在 pack 能力面**：F01 工作区 API、F08 历史、F09 附件、F11 回收站、F13 导出、F15 设置 UI 等官方 UI/后端 API 行保持 NOT_RUN；
- **不得映射**：官方 UI 通过（官方 baseline PASS）不等于 pack 通过；本表只引用 guest 协议实测证据。
