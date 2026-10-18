# P2-T14 证据：EditorArea flag 接线（ADR-002 步骤 2）— 全量前端 126 files/1769 passed

- 日期：2026-10-19 · 代码：
  - `frontend/src/core/session/coreSaveRuntime.ts`：EditorArea 运行时入口
    - `coreSaveEnabled()`：`VITE_KE_CORE_SAVE === '1'`（**默认关闭 → 旧保存链零行为变化**）；
    - `saveViaCore(relPath, content, signal?)`：每文档缓存产品 `SaveFn`（内部持有 coordinator/revision），
      保存前经 content provider 交付最新内容；
    - 测试注入/切库重置：`__setCoreBridgeFactoryForTests` / `resetCoreSaveRuntimeForTests`。
  - `frontend/src/components/layout/EditorArea.tsx`：WYSIWYG 保存路径 flag 分支
    - 先算 `written = applyDocTraits(md, traitsFor(docId))`（BOM/CRLF traits 保留）；
    - `coreSaveEnabled() && stillCurrent() && article.path` → `saveViaCore`（Core 链，**不双写**）；
    - 否则走 `saveArticle`（旧链，行为不变）；非当前文档的延迟保存继续旧链；
    - Core 路径不覆盖 App 的 article meta（`onSaved(id, undefined)`），避免 `{content}` 形状污染状态。
  - `frontend/src/editor/docTraits-wiring.test.ts`：D1 源码守卫更新为「written 先行 + 旧链/Core 分支都使用
    written」，防止回归成直接写编辑器 LF 内容。
  - `coreSaveRuntime.test.ts` 4 例（flag 默认关闭/每文档 SaveFn 缓存/内容 provider/重置后重建）。
- 证据类型：**U（单元 + 源码守卫）+ 全量前端回归**；flag 开启路径的自动化 UI e2e/Windows 实机验收未做
  （桥本身已有真实后端 e2e 11/11，见 `P2-T14-core-save-bridge.md`）

## 验证结果

```text
$ npx tsc -b --noEmit
exit 0
$ npx vitest run src/core/session
Tests  41 passed (41)      # 含 coreSaveRuntime 4 例
$ npx vitest run --maxWorkers=2      # 全量前端（EditorArea 改动后）
Test Files  126 passed (126)
     Tests  1769 passed | 1 skipped (1770)
```

| 用例 | 验证 |
| --- | --- |
| flag 默认关闭 | `VITE_KE_CORE_SAVE` 未设置 → false（旧链） |
| 每文档 SaveFn 缓存 | 同一 relPath 只建一次；内容 provider 每次取最新内容 |
| 多文档 | 各自创建 SaveFn |
| reset/切库 | 清空桥与缓存后重建 |
| D1 源码守卫 | traits 还原后的 `written` 同时用于旧链/Core 分支；flag 判定存在 |

## 结论

- ADR-002 步骤 2 完成：EditorArea 的 WYSIWYG 保存可在 flag 下切换到 Core（禁止双写、traits/恢复点/
  源码通道保持原逻辑），默认关闭零行为变化，全量前端回归绿。
- 尚未完成（ADR-002 步骤 3 / T14 收尾）：
  1. **字节一致性验证**：同一编辑在 flag on/off 下产出文件字节一致（canonical 规则内）；
  2. flag 开启路径的真实 UI e2e（保存/切档/外部改盘/恢复点）与 **Windows/WebView2 实机保存 W**；
  3. 通过验收门槛后，才能评估 flag 默认开启与源码通道/导出迁移。
