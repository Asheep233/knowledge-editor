# AstraNota v1.3.0-rc.1（Release Candidate 1）

> **发布候选版**：正式版仍为 `v1.2.18`（Latest）。`v1.3.0-rc.1` 是 1.3.0 的首个 RC：
> Focus UI 全面对齐 + 2026-10 真机审查处置 + 性能优化第 1 轮（Codex 独立审查→实施→独立复测 PASS）。
> 预发布性质不变：安装包**未签名**；已知规模边界与大文档保护见“已知限制”。

## 相对 v1.3.0-pre.9 的变化

- **无产品代码变更**（pre.9 已包含全部性能第 1 轮修复与 PDF 一致性修复）；本版仅版本号、发布说明与验收归档，作为 1.3.0 的 RC 候选。
- pre.9 的 PDF 一致性修复已由 codex-agent **独立复测 PASS**（详见下）；第 1 轮四项全部 PASS。

## 本版包含（1.3.0 全量）

- **Focus UI 全面对齐**：浮动侧栏/纸面/命令条、知识库·搜索·模块·资料·回收站整页、⌘K 命令面板、设置独立页、文档信息浮层、历史 sheet、专注模式、启动器；
- **历史真机审查修复**：源码模式编辑区高度、导出 PDF 卡顿、插入按钮裁切、`\tag` 公式叠字、关窗挂起加固（8s watchdog）、跨工作区最近文档隔离、启动看门狗、保存状态显示、右侧滚动条、公式编辑框焦点隔离；
- **性能优化第 1 轮（四项，Codex 独立审查 → 本仓库实施 → Codex 独立复测 PASS）**：
  1. **R1-1 PDF 量测离屏**：关闭 PDF 时零主题/样式量测；预.8 复测首 dirty p95 1MiB 640.3→27.3ms、5MiB 3248.1→80.9ms（8s 口径 196.6→14.3 / 953.4→46.5ms）；
  2. **R1-table 表格 tokenizer 早拒绝**：原生 1MiB 同字节 parse 改善 27.46% / 42.81%；
  3. **R1-S 源码 no-op 复用驻留 PM**：20MiB 源码无编辑返回 parse=0、最大 13.74s；保存后最大 13.87s；
  4. **R1-D2 PDF 预览/导出资源就绪守卫**：5 个新 WebView profile ×（首 preview+2 export）= 15 份 PDF 全部 434 页、规范化全文 SHA 全同，0 回退/reject/孤儿；readiness 20/20 正常（首等待中位/p95=19/21ms）。

## 发布资产

| 资产 | 大小 | sha256 |
|---|---|---|
| `AstraNota_1.3.0-rc.1_x64-setup.exe` | 51,153,193 B | `278c690e79359049ba3c339840c88f982a9faabdb0da8fb06bcedb7c9ac54bf5` |
| `knowledgeeditor-backend-x86_64-pc-windows-msvc.exe`（侧车） | 46,248,666 B | `6cd5fcb51478a6456b7f6d6f7de76c7de5a242151219625163af31d907d65045` |
| `manifest.sha256`（79 个产物） | 9,930 B | `69401ce51872554744ad91a4bcf992797cda918c251373a8126164dfd8ebcd4f` |
| `versions.json` | 16,026 B | `a096619b4ceddb57fb6772ad671c617e8f5f698522c52f364f5cab90f2ec0825` |

安装包版本信息：ProductVersion = FileVersion = `1.3.0-rc.1`（NSIS x64，未签名）。

## 验证

| 项 | 结果 |
|---|---|
| 前端类型检查 / 构建 | `tsc -b` 0 错；`vite build` exit 0（产物版本 `1.3.0-rc.1`） |
| 前端全量测试 | **153/153 文件、2083 passed + 1 skipped**、EXIT=0 |
| 视觉验收 | 17 张截图、**195/195 断言 PASS**、0 DIFF |
| 性能第 1 轮复测 | 编辑器三项 PASS（pre.8 独立复测）；R1-D2 PDF 一致性 PASS（pre.9 专项独立复测） |
| 侧车版本一致性 | 随机端口拉起 sidecar → `/api/health.version = 1.3.0-rc.1` 与源码一致 ✔ |

## 已知限制（RC 不覆盖，正式版前需处理/确认）

1. **安装包未签名**（需 Authenticode 证书）；
2. **125%/150% 显示缩放与多显示器**未做真机补验（本机 200% 单屏已覆盖）；
3. **附件上传/预览/引用删除、模块插入端到端**未在真机补验（需人工在场）；
4. **10k 文档首次激活**仍未支持：同步索引 + 30s 健康握手限制（第 2 轮异步索引）；
5. **20MiB 默认排版首开约 2 分钟**（未加源码优先/大文档保护，第 2 轮）；
6. 富媒体图片保真/慢资源超时未验收（fixture SVG URI 无效）；
7. 系统打印 fallback、PWA/browser 态未做真机验收（RC 主场景为 Windows 桌面）。

## 升级/回滚
- 可直接覆盖安装 pre.1–pre.9 / 1.2.x（文档格式/工作区结构无变化）。
- 回滚：重新安装 `v1.2.18`（Latest）。

## 验收参考
- 性能第 1 轮审查/方案：`F:\Work\KE Project\perf-review-2026-11-01\{REPORT,PLAN}.md`
- pre.8 复测：`F:\Work\KE Project\perf-retest-2026-11-02\REPORT.md`
- pre.9 PDF 专项复测（PASS）：`F:\Work\KE Project\perf-retest-pre9-2026-11-03\REPORT.md`
- 仓库实现说明：`docs/focus-ui/PERF-ROUND1.md`、`docs/focus-ui/evidence/perf-round1/`
