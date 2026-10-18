# P2-T14 证据：字节一致性 — 旧链 HTTP vs Core 上下文写盘（真实后端 12/12 PASS）

- 日期：2026-10-19 · 代码：
  - `docs/ui-workshop/core/session/t14_byte_consistency.ts` + `run_t14_byte_consistency.sh`
    （隔离 uvicorn + 临时工作区，真实 `/api/articles` 与 `/api/context/*`）
  - 场景：LF 普通文档；**CRLF + UTF-8 BOM** 文档（traits 还原场景）
  - 每个场景：旧链创建(POST)/保存(PUT，frontmatter 合并语义) → 磁盘字节 A；
    Core 打开上下文 → 保存(PUT 等价 `/api/context/write`，同一 final 字符串) → 磁盘字节 B；
    比较 A/B 是否完全一致 + 落盘内容是否等于写入内容
- 原始结果：`evidence/T14-byte-consistency-results.json` · 证据类型：**A（真实后端 e2e）**

## 实测结果：**12/12 PASS**

| 场景 | 检查 | 结果 |
| --- | --- | --- |
| LF 普通文档 | 旧链创建/保存、Core 上下文/保存 | PASS |
| LF 普通文档 | **旧链与 Core 落盘字节完全一致** | PASS |
| LF 普通文档 | 落盘内容 = 写入内容（无损） | PASS |
| CRLF+BOM | 旧链创建/保存（frontmatter 合并） | PASS |
| CRLF+BOM | **旧链与 Core 落盘字节完全一致** | PASS |
| CRLF+BOM | 落盘内容 = 写入内容（CRLF/BOM 未被改写） | PASS |

## 结论

- ADR-002 验收门槛中的「**保存字节一致性**」达成：同一次编辑器写出的 `written` 字符串经旧链与
  Core 两条保存通道落盘**逐字节一致**，且 frontmatter 合并不改写正文、CRLF/BOM 不被破坏。
- 剩余（T14 收尾）：flag 开启路径的真实 UI e2e（保存/切档/外部改盘/恢复点）与
  **Windows/WebView2 实机保存 W**；通过后才评估 `VITE_KE_CORE_SAVE` 默认开启。
