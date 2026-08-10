# Phase 3E.4 报告：导入安全性增强

日期：2026-08-09

## 一、修改内容

仅修改后端导入链路（`backend/app/routers/import_export.py`），前端无改动（API 契约与错误语义保持不变）。

| 模块 | 变更 |
| --- | --- |
| `_new_import_dir` | 新增：创建临时导入区 `.knowledgeeditor/tmp/import_{token}/` |
| `_validate_ke_nodes` | 新增：导入前校验所有 `ke-*` 节点 JSON 可解析（未知 kind 仍由 GenericFallback 兜底） |
| `_extract_refs` / `_validate_refs` | 新增：提取 md 中附件引用并校验安全性（无穿越、包内存在；网络/绝对路径保持原样放行） |
| `_unique_attachment_rel` | 由内联逻辑提取：唯一名生成，50 次冲突返回 None（冲突策略失败路径） |
| `_commit_staged` | 新增：原子提交——同盘 `os.replace`，已存在且内容一致则复用跳过，失败回滚已提交文件并清理空目录 |
| `_import_article_from_staged` | 新增：先提交后统一刷新 SQLite 索引 |
| `import_markdown` / `import_package` | 重构：解包/读取 → 校验 → staged 暂存 → 原子提交，`finally` 清理临时区 |

## 二、导入流程变化

**旧流程**（3E）：
```
读取 → 直接写入 workspace 目标 → 逐文件更新索引
（中途失败会留下半完成文档 / 已复制附件 / 部分索引）
```

**新流程**（3E.4）：
```
导入文件
   ↓
解包/读取到 .knowledgeeditor/tmp/import_{token}/pkg/
   ↓
校验（全部通过才继续）：
  · Markdown UTF-8 可读
  · frontmatter 可解析
  · ke-* 节点 JSON 可处理（非法 JSON 拒绝）
  · 附件引用安全：无 .. / 绝对路径穿越
  · 附件引用存在性：包内引用的附件必须真实存在
  · 冲突策略确定：原名 / 复用（sha256 一致）/ 唯一名（50 次尝试）
   ↓ 任一失败 → 删除临时区，workspace 零改动，索引零更新
staged 暂存（临时区内构建 workspace 相对布局）
   ↓
原子提交（os.replace 同盘 rename）
   ↓ 中途失败 → 回滚已提交文件，恢复原状
统一刷新 SQLite 索引（提交全部成功之后）
   ↓
finally 清理临时导入区
```

关键保证：

1. **禁止直接写入目标**：所有解包、校验、暂存都在 `.knowledgeeditor/tmp/import_{token}/` 内完成，提交前不触碰 `Articles/`、`Attachments/`。
2. **已存在文件永不被覆盖**：内容一致复用跳过；内容不同走唯一名；`_commit_staged` 若遇到「目标存在且内容不同」视为提交失败并回滚。
3. **准原子提交**：临时区与 workspace 同盘，`os.replace` 单文件原子；多文件整体通过「失败回滚已提交清单 + 空目录链清理」实现，回滚后 workspace 与导入前一致。
4. **索引最后刷新**：`indexer.update_file` 仅在全部提交成功后调用，失败路径不会产生错误索引。

## 三、新增测试

`backend/tests/test_import_export_safety.py`（7 项），每个失败场景均验证「workspace 快照不变 / 临时区无残留 / SQLite files 行数不变」：

| 测试 | 覆盖场景 |
| --- | --- |
| `test_import_markdown_corrupted_encoding` | Markdown 损坏（非 UTF-8）→ 400 |
| `test_import_package_bad_ke_json` | ke-* 节点 JSON 非法 → 400 |
| `test_import_package_missing_attachment` | md 引用包内缺失附件 → 400 |
| `test_import_package_illegal_ref` | 附件引用路径穿越（`..`）→ 400 |
| `test_import_package_copy_failure_rolls_back` | 复制失败（monkeypatch 模拟磁盘错误）→ 抛出，零残留 |
| `test_import_package_conflict_failure` | 冲突处理失败（唯一名 50 次全冲突）→ 409 |
| `test_import_package_success_cleans_tmp_and_indexes` | 正向：成功导入后临时区清理、索引恰好 +2（文章 + 附件） |

## 四、测试结果

| 验证项 | 结果 |
| --- | --- |
| 后端 pytest 全套（24 项，含 3E.4 新增 7 项） | 24/24 通过 |
| 前端 vitest 全套（38 项，本轮无改动） | 38/38 通过（无回归） |

3E.3 的端到端闭环测试（导出 → 移除 → 导入 → 打开 → 二次导出零漂移）与附件冲突规则测试在重构后全部保持通过，确认安全性改造未破坏既有格式与行为。

## 五、当前风险

1. **多文件提交非事务性**：回滚基于「记录已提交清单」实现，若回滚过程中删除也失败（极端 I/O 错误），会残留已提交文件；回滚不做重试。
2. **引用校验覆盖面**：仅校验 ke-attach / ke-video / 标准图片引用；ke-module `params` 或手写非 `Attachments/` 前缀的相对引用不校验（保持原样，Phase 4 范围）。
3. **临时区在 workspace 内**：`.knowledgeeditor/tmp/` 位于 workspace 内，索引器若扫描全目录可能把 tmp 文件误索引——当前索引器按 `Articles/`、`Attachments/`、`Modules/` 等白名单目录扫描，tmp 不在其中，无此风险；但未来新增目录白名单时需注意排除。
4. **zip 总大小无上限**：单文件限 512MB，但压缩包总体积无限制，超大 zip 会临时占用磁盘（导入后自动清理）。
5. **冲突失败返回 409**：唯一名 50 次全冲突（极端情况）报「附件冲突处理失败」，用户需手工处理；未提供自动重试。
