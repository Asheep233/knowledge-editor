# P5-T26 W02 证据：产品表单交接（title/tags 经 Broker → 宿主原子写 meta）— W 8/8 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建 + workshop 协议 guest）
- 工具：`tools/run_t26_form_probe.py`（真实产品 + 真实 SDK GuestClient 的 W02 探针包）；
  `core/packs/probe/w02_guest.ts` + `build_w02_probe.sh`
- 原始结果：`evidence/T26-W02-form-results.json` · 证据类型：**U（Core 状态机 6/6）+ W（产品 7/7）**

## 实测结果：8/8 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W02-1 安装签名包 | PASS |
| W-T26-W02-2 guest 握手（ui.shell/context.read） | PASS |
| **W-T26-W02-3 guest 经 Broker command.invoke 提交 title 成功** | PASS |
| **W-T26-W02-4 宿主后端原子写生效（frontmatter title 更新）** | PASS（`title: W02 交接标题`） |
| **W-T26-W02-4b guest 提交 tags 成功且后端落盘** | PASS（`tags: [w02, 交接]`） |
| **W-T26-W02-5 未知命令被拒绝（E_COMMAND_NOT_ALLOWED）** | PASS（宿主白名单） |
| W-T26-W02-6 会话 active | PASS |
| W-T26-W02-7 主进程存活（用户实例未运行 → N/A） | PASS |

## 实现

- 产品 host `ProductBrokerBackend.invokeCommand` → `createArticleMetaCommandHandler` 白名单：
  - 合法命令名（manifest 规则要求小写：`article.set-title` / `article.set-tags`）；
  - 路径校验（Articles/**.md、禁止 `..`）、标题/标签参数校验；
  - 宿主经后端 `PUT /api/articles/{rel}/meta` **原子写**，返回 `{relPath,title,tags}`；
  - 未知命令 → `E_COMMAND_NOT_ALLOWED`（Broker 包装为 E_INTERNAL 但原因保留）；
- Core `formHandoff`（U 6/6）：幂等/迟到丢弃/失败保留/旧连接失效/drain。
- 单测：productHostAdapter 9 例（含白名单/路径/未知命令）、formHandoff 6 例、tsc 0。

## 未完成（W02 剩余）

- 公式/重命名草稿的跨 UI 交接与对话框/候选启动失败/迟到命令/旧连接失效的完整语义（title/tags 已完成）；
- 提交后官方编辑器 UI/标签页状态同步（当前后端 meta 已更新，UI 刷新语义未验证）；
- IME 组字交接与官方表单集成（需真实 UI 交互 W）。
