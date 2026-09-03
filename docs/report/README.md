# 报告归档（docs/report/）

本目录集中归档 KnowledgeEditor 的缺陷审计与版本交付报告（与 `docs/` 下的阶段开发报告 **phase*/v0x-journey** 分开存放）。

| 文件 | 内容 |
|---|---|
| `knowledge-editor-fix-checklist.md` | 9 份独立审计报告整合的缺陷清单（P0×4 / P1×17 / P2×20 / P3×21 / P4×13），含修复动作与验收标准 |
| `knowledge-editor-fix-report.md` | v1.0.1 修复批次报告（75 项逐条实现、回归测试、验证结果） |
| `knowledge-editor-v1.0.1-verification-report.md` | v1.0.1 验证与收尾报告（Rust 编译、桌面冒烟、P1-16 溯源消除、遗留项 P3-2/P3-4/P4-7/P4-2、发布最终化、人工点检清单） |
| `knowledge-editor-v1.0.2-report.md` | v1.0.2 报告（新增「导出为普通 .md」功能的降级规则、测试、边界说明、提交/标签状态） |

维护约定：每个版本发布/功能批次完成后，在此目录追加对应报告并同步 CHANGELOG_DEV.md。
