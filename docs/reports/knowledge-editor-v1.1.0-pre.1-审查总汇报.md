# Knowledge Editor v1.1.0-pre.1 两阶段审查总汇报

> 审查对象：v1.0.2a（`4732c5c`）→ v1.1.0-pre.1（`ab4ca1d`）UI/UX 重构
> 审查方式：第一轮（高召回、证据驱动）→ 第二阶段 K3（对抗式 / 架构级）
> 汇总日期：2026-09-05

***

## 一、结论摘要

| 阶段     | 判定                | 关键结论                                        |
| ------ | ----------------- | ------------------------------------------- |
| 第一轮    | 可发布（无 P0/P1）      | P0=0、P1=0、P2=2、P3=1；硬约束 6 项全 PASS           |
| K3（最终） | **需修复后发布（低修复成本）** | 唯一阻断项 = 版本源漂移；核心数据/保存/导出/方言兼容全 PASS，无 P0/P1 |

**一句话结论**：不存在阻止正式 1.1.0 发布的功能性或数据完整性问题；唯一阻断项是版本源三处漂移（`desktop/package.json` 等），属发布前一次性对齐的低工作量修复。

**两阶段机制有效性的实证**：第一轮把「版本全链一致」误报为 PASS，K3 独立实测纠正——`desktop/package.json = 1.0.2`、`desktop/package-lock.json = 1.0.0` 未随 1.1.0-pre.1 升级。这正是 K3 对抗式校验的价值。

***

## 二、阻断项（正式发布前必须修复，1 项）

### RC-VERSION — 版本源三处漂移

- **文件**：`desktop/package.json:4`（=1.0.2）、`desktop/package-lock.json:3`（=1.0.0）、`WorkspacePicker.tsx:28`（重复常量 `'v1.1.0-pre.1'`，带 v 前缀且与 `version.ts` 解耦）

- **根因**：版本号缺少单一事实源，多文件人工同步；`WorkspacePicker` 重复维护常量保证未来再次漂移

- **影响**：正式发布将重打 NSIS 并做运行时版本校验，「全链一致」宣称不实；若 CI/打包链读取 `desktop/package.json` 将注入错误版本元数据

- **修复**：同步 desktop 两个 package 文件至 1.1.0；`WorkspacePicker` 改 `import { APP_VERSION } from '../../version'`，展示层统一 `v${APP_VERSION}`。工作量：小

***

## 三、建议顺手修（真实缺陷，成本极低，非阻断）

| ID    | 问题                                                                | 文件:行                                                                           | 修复                                             |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| F1    | 表格尺寸选择网格滑动高亮失效（`bg-primary-soft0` 类名拼写错误，无义类）                     | `EditorToolbar.tsx:152`                                                        | 改 `bg-primary-soft`                            |
| F2    | focus 环未用 `--ring`（多数控件缺 `ring-ring`，回退 currentColor）             | 多处（LeftSidebar/RightPanel/EditorArea/SettingsPanel/EditorToolbar/NoteNodeView） | 补 `focus-visible:ring-ring` 或全局默认 ring 色       |
| K3-V3 | 前后端 slugify 在 Windows 保留名带扩展名场景行为分歧（`con.txt` 前端不拦、后端 `_con.txt`） | `frontend/src/utils/slug.ts:13` vs `markdown_io.py:55-56`                      | 前端保留名检测对齐后端 `split(".",1)[0]`，补 `slug.test.ts` |

***

## 四、排 1.1.x（功能安全，延后，不阻断）

| ID    | 问题                                                         | 根因                              | 影响                 |
| ----- | ---------------------------------------------------------- | ------------------------------- | ------------------ |
| K3-I1 | indexer 增量更新不刷新扫描签名，reconcile 退化为永久全量重建                    | `_SIGNATURE_KEY` 仅 rebuild() 写入 | 启动性能退化 + B1 边界过期索引 |
| K3-I2 | rename/move 非原子、无 fsync，崩溃窗口内文件名与索引不一致                     | 写路径一致性只在正文保存落实                  | 极端崩溃下标题改名半完成       |
| K3-T1 | applyTheme 每次调用累积注册 matchMedia change 监听器                  | 函数体内 addEventListener 无去重       | 内存泄漏累积、系统切换重复执行    |
| B1    | reconcile 签名判据（size+mtime\_ns）在「等长+同 tick」时漏更索引 + flaky 测试 | `indexer.py:141-152`            | 搜索结果过期、测试偶发失败      |

***

## 五、硬约束与数据契约核对

### 硬约束（6 项）

| 项                                    | 第一轮                      | K3 复核                         |
| ------------------------------------ | ------------------------ | ----------------------------- |
| ① 三种导出 diff = 0                      | PASS（0 行 diff，14 passed） | 维持                            |
| ② ke-module display:none 无边界         | PASS（0 改动）               | 维持                            |
| ③ 可编辑标题链路（handleTitleBlur + slug.ts） | PASS（附测试缺口）              | 维持（缺口升级为 K3-V3）               |
| ④ 构建产物 dist-build                    | PASS                     | 维持                            |
| ⑤ sidecar /api/health 版本             | PASS                     | 维持                            |
| ⑥ APP\_VERSION 全链一致                  | PASS                     | **REJECTED（误报）**，见 RC-VERSION |

### 数据契约与兼容性（K3 专项）

| 专项                            | 判定                   |
| ----------------------------- | -------------------- |
| Markdown 方言（ke-\* 序列化-反序列化闭环） | PASS                 |
| API 契约                        | PASS                 |
| Settings 契约                   | PASS                 |
| 版本一致性                         | **FAIL**（RC-VERSION） |

***

## 六、待主理人决策（K3 已给默认建议）

1. **O4 自定义强调色覆盖** **`--sidebar-primary`**：用户设自定义色后侧栏主色跟随主 CTA、失去独立分层。默认深色 #0065fd 路径不受影响。→ K3 默认：接受为预期即可关闭。
2. **B1 / K3-I1 是否接受进 1.1.0**：reconcile「功能安全但启动必全量重建」。→ K3 默认：接受，hash 入签名排 1.1.x。
3. **F1 / F2 是否随 1.1.0 一起修**：F1 是真实可见功能退化（一行类名）。→ K3 默认：顺手修。

***

## 七、下一步行动（正式 v1.1.0 发布）

1. 修 RC-VERSION（同步 desktop 版本 + WorkspacePicker 去重）。
2. 全栈版本统一到正式 `1.1.0`（去掉 `-pre.1`）：backend `__version__`、`frontend/src/version.ts`、前后端 `package.json`、`tauri.conf.json`、`Cargo.toml`/`Cargo.lock`、`desktop/package.json`/`desktop/package-lock.json` 七处对齐。
3. 顺手修 F1 / F2 / K3-V3。
4. 回归验证：vitest / tsc / build（`dist-build/`）/ backend pytest / 导出专项全绿；硬约束仍 PASS。
5. 重打 NSIS + sidecar，运行时版本校验通过（`/api/health` = 1.1.0）；Windows 真机补验 cargo test 与 CDP 视觉复核 F1/F2。
6. 发布正式 Release；K3-I1 / K3-I2 / K3-T1 / B1 写入 1.1.x backlog。

