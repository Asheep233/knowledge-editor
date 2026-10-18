# P5-T26 A8 证据：Core 保存 flag 产品 UI（VITE_KE_CORE_SAVE=1）— W 9/9 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2（真实产品壳隔离测试构建 com.astranota.uiws.e2e）**
- 前置：dist 以 `VITE_KE_CORE_SAVE=1` 构建；隔离测试构建 + **当前源码打包的 sidecar 后端**
  （PyInstaller 构建，含 T12 `/api/context/*`）；隔离 `APPDATA` + `KE_WORKSPACE`
- 工具：`tools/run_t26_save_probe.py`（CDP 打开文章 → 真实 `SendInput` 编辑 → autosave 验证 →
  磁盘/后端日志/frontmatter 校验）
- 原始结果：`evidence/T26-A8-save-results.json` · 证据类型：**W（真实产品 UI/后端/文件系统）**

## 实测结果：9/9 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-A8-1 flag 构建产品启动 + 隔离工作区主 UI 就绪 | PASS |
| W-T26-A8-2 打开文章并加载编辑器（ProseMirror） | PASS |
| W-T26-A8-3 真实 SendInput 编辑插入标记（A8MARK） | PASS |
| **W-T26-A8-4 保存落盘（autosave；磁盘含标记）** | PASS |
| **W-T26-A8-5 保存经 Core 上下文链（后端日志 `/api/context/write`）** | PASS |
| W-T26-A8-6 无保存错误 | PASS |
| W-T26-A8-7 主进程存活 | PASS |
| W-T26-A8-8 用户运行中的 AstraNota 未受影响 | PASS |
| **W-T26-A8-9 保存保留 frontmatter 元信息（title）** | PASS（`ke_version: 1` + `title: hello`） |

## 排查过程发现的真实缺陷（均已修复）

1. **Core 桥未使用产品后端 base URL**：`coreSaveRuntime` 默认桥 baseUrl 为空 → 请求打到 Tauri
   资源域。已修复为 `resolveCoreApiBase()`（`window.__KE_API_BASE__`）+ 单测。
2. **sidecar 版本不匹配**：初跑用 D:\AstraNota 旧打包后端（无 `/api/context/*`）→ `POST /api/context/open`
   404。测试 build 改用**当前源码 PyInstaller 打包 sidecar**（发布时同理必须同步后端产物）。
3. **上下文写入丢失 frontmatter 元信息**：`/api/context/write` 未做 merge，正文写入会丢 `title/tags`
   （真实数据丢失风险）。已修复为与旧链 `PUT /api/articles/{id}` 相同的 frontmatter 合并语义，
   新增后端测试 `test_context_write_preserves_frontmatter_meta`（通过）。

## 结论

- T26 计划 **A8 完成**：Core 保存 flag 在真实产品 UI 中可用（编辑器 autosave → Core 上下文写 →
  `/api/context/write`），且 frontmatter 元信息不丢；默认 flag 关闭、行为可回退。
- 附带完成 T14 的 flag-on 产品级保存验证（真实 UI），剩余 T14：切档/外部改盘/恢复点专项与 Windows
  实机字节回归（T14 e2e 12/12 已提供后端字节一致性）。
