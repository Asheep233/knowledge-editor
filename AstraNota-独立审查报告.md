# AstraNota（Knowledge Editor）独立全量审查报告

- **审查对象**：`https://github.com/Asheep233/knowledge-editor` @ `master` / `d8ffc1a`
- **代码基线版本**：`1.2.4`（`backend/app/__init__.py` 与 `frontend/src/version.ts` 一致）
- **审查方式**：代码级静态审查。高优先级结论均由审查人回读原始代码核实；同时使用 Agent Team（3 个并行只读子审查员：后端数据安全、前端交互、桌面壳/供应链）做广度覆盖。
- **审查重点**：前端交互功能正确性、后端数据安全。
- **重要局限**：本审查环境**未安装后端依赖**（无 `fastapi`），因此**未能运行项目自带的 pytest / vitest 套件**做动态验证。所有结论均为静态证据，并标注「已核实 / 待运行验证」。审查过程**未修改任何被审文件**。

---

## 一、总体结论

这是一个工程成熟度**明显高于平均水准**的本地优先（Local-first）应用：路径沙箱、zip-slip 防护、原子写入、符号链接防护、保存队列、切档代次守卫、自绘对话框等大量细节都做过专门加固，代码中能看到成体系的安全/正确性注释与回归测试命名。

但本次审查仍发现若干**真实缺陷**，集中在两条主线：

1. **后端本机 API 无任何认证**，且无 Origin/Referer 校验，存在 CSRF 与同机越权读取面（数据安全主线，最高优先）。
2. **前端文件树「文件夹重命名/移动」与「标签/激活文档路径」不同步**，以及**新建文档不入标签栏**、**跨档保存竞态**等，构成可触达的**内容丢失/串档**路径（前端交互主线）。

### 1.1 风险汇总

| 编号 | 领域 | 问题 | 严重度 | 核实状态 |
|---|---|---|---|---|
| SEC-1 | 后端 | 本机 API 无鉴权 + 无 Origin 校验 → CSRF/同机越权 | 高 | 已核实 |
| UI-1 | 前端 | 文件夹重命名/移动后子文档标签与激活路径不同步 → 保存 404 静默失败 | 高 | 已核实 |
| UI-2 | 前端 | `buildSaveFn` 的 `isCurrent` 在 `await` 前捕获 → 跨档内容污染 | 高（条件性） | 已核实代码路径 |
| SEC-2 | 后端 | `create_doc` 可经 `..` 把 `.md` 写到 Attachments/任意根目录（业务边界绕过） | 中 | 已核实 |
| UI-3 | 前端 | `PromptDialog` 全局单例，并发 `ask` 时先发起的 Promise 永久挂起 | 中 | 已核实 |
| UI-4 | 前端 | 外部删除当前文档不清理标签、不激活相邻 | 中 | 已核实 |
| UI-5 | 前端 | 「外部修改」弹窗跨文档滞留，重载会把用户切回旧文档并可能丢弃当前编辑 | 中 | 已核实 |
| UI-6 | 前端 | 新建文档未加入标签集合 | 中 | 已核实 |
| UI-7 | 前端 | `handleCloseWorkspace` 无 try/catch → 未处理 rejection（同类入口有） | 中 | 已核实 |
| SEC-3 | 后端 | 导入整包驻留内存，可 OOM | 中 | 已核实 |
| SEC-4 | 桌面 | NSIS 钩子读 HKCU `UninstallString` 并直接执行 + PowerShell 参数插值 | 中/高 | 已核实 |
| SEC-5 | 前端 | 公式渲染失败回退 `dangerouslySetInnerHTML(raw latex)`（XSS sink） | 中 | 已核实（触发条件待验证） |
| SEC-6 | 桌面 | `KE_CORS_ORIGINS` 环境变量可注入任意 CORS 源 | 中 | 已核实 |
| 其他 | 多领域 | 见第四节（低危/无障碍/文档漂移） | 低 | 混合 |

---

## 二、后端数据安全

### SEC-1【高】本机 API 无认证 + 无来源校验（CSRF / 同机越权）

**状态：已核实。**

`backend/app/main.py` 明确移除了原 P2-16 的 token 校验，中间件只剩「未打开工作区 409」；`backend/app/config.py` 的 `API_TOKEN` 成为**全仓无引用的死配置**（已 grep 确认，仅测试引用）；同时 `main.py` 开启了 `allow_credentials=True`。全仓**无任何 Origin/Referer/CSRF 校验**。

```python
# backend/app/main.py:124-144 —— 只剩工作区 409，不再鉴权
if (getattr(app.state, "workspace_root", None) is None
    and path.startswith("/api/") and not path.startswith("/api/health")
    and not path.startswith("/api/workspace")):
    return JSONResponse(status_code=409, content={"detail": "未打开工作区"})
return await call_next(request)
```

```python
# backend/app/config.py:39-40 —— 死配置
API_TOKEN = os.environ.get("KE_API_TOKEN", "")
```

**为什么是真实风险：**

- **CSRF**：CORS 只阻止「跨源读响应」，不阻止「发请求」。`application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` 属于 CORS 简单请求，不触发预检；而 FastAPI 对 Pydantic body 直接解析 JSON，**不强制 Content-Type**。因此恶意网页可用 `text/plain` + JSON body 命中 `POST /api/workspace/open|create`、`/api/fs/move|doc`、`/api/attachments`、`/api/import/*` 等写端点。`PUT/DELETE` 会触发预检被拦，新端点多为「已存在 409」不会覆盖，但**内容注入与工作区切换成立**。
- **同机越权**：任意本机进程无需凭据即可读取全部笔记（`GET /api/articles/{id}`）。
- 已缓解的部分：`TrustedHostMiddleware` 阻断了 DNS rebinding，显式 `allow_origins` 阻断了跨源**读**——所以不是 Critical，但完全无鉴权仍不可接受。

**修复建议：**

1. 由 sidecar 启动时用 CSPRNG 生成随机 token（≥128bit）→ 环境变量注入后端 → Tauri IPC 交给前端 → 所有请求带自定义头 → 中间件对 `/api/*`（除 `/api/health`）强校验，并放行 `OPTIONS`。
2. 增加 Origin/Referer 白名单校验。
3. 无 Cookie 认证时把 `allow_credentials` 置 `False`。
4. 删除或接通死配置 `API_TOKEN`，修正误导性注释。

### SEC-2【中】`create_doc` 业务边界绕过

**状态：已核实。**

`backend/app/routers/fs.py` 的 `create_doc` 只调用了 `_guard_rel`，**没有**调用同文件里的 `_require_business_top`（对比 `create_dir` 调用过）。而 `_guard_rel → safe_rel_path` 只校验「在工作区内、不在受保护目录」，不拒绝 `..`：

```python
# backend/app/routers/fs.py:419-423
if sub:
    _guard_rel(root, f"{top}/{sub}")        # 只查包含性/受保护目录
...
rel = f"{top}/{sub}/{slug}.md" if sub else f"{top}/{slug}.md"   # 重新拼接原始 sub
full = root / rel
```

于是 `dir="Articles/../Attachments"` → `rel="Articles/../Attachments/x.md"`，OS 解析后落到 `Attachments/x.md`。**影响**：违反「文档只能在 Articles/Modules 下」的既定约束，可把 `.md` 注入附件区或任意根级目录（不越出工作区、不覆盖既有文件，故为中危）。已有测试只覆盖了 `Trash` 未覆盖 `Attachments`。**修复**：用 `_guard_rel` 返回的归一化 `full` 反算相对路径，并补 `_require_business_top(root, full)`。

### SEC-3【中】导入整包驻留内存（DoS）

**状态：已核实。**

`backend/app/routers/import_export.py` 会把最多 512MB 的 zip **整体读入内存**再解压，Markdown 导入上限 50MB，且无并发限制：

```python
# backend/app/routers/import_export.py:229-244
MAX_ZIP_SIZE = 512 * 1024 * 1024
async def _read_limited(file, limit):
    chunks = []
    ...
    return b"".join(chunks)     # 整包驻留内存
```

**修复**：zip 落盘后逐条 `zipfile` 读取；引入并发/速率限制；单文件上限与注释对齐（注释称 512MB，实际单文件可至 1GB）。

### 2.4 其余后端结论（低危）

- **[低]** `list_files(prefix=…)` 的 LIKE 未转义通配符（`backend/app/store/db.py:300-318`），含 `_`/`%` 的目录名移动时会误删相邻索引行（仅索引，可重建）。
- **[低/待验证]** `/docs`、`/openapi.json` 不受工作区中间件保护；`health` 回显绝对路径；`markdown_io.py:307` 等惰性正则在大输入下可能退化（ReDoS，需实测）。
- **[低]** 附件内联类型集合含 `.pdf`（`.svg/.html` 已强制 `attachment`，良好）。

### 2.5 后端「做得好」

- 沙箱核心 `safe_rel_path`（`markdown_io.py:478-490`）与三个白名单 `is_doc_rel / is_attachment_rel / is_recovery_draft_rel`（`markdown_io.py:493-521`）有效；
- zip-slip 防护、staged 原子提交/回滚、大小限额；
- SQL 全参数化 + FTS 参数化 + 语法错误降级 + `_escape_like`；
- 原子写入（临时文件 + `fsync` + `os.replace`，含 BOM/CRLF 保真）；
- 符号链接 / junction 跳过，删除只移除链接本体；
- 附件上传 `O_EXCL` 独占、NFC 去重、`.svg/.html` 强制 `Content-Disposition: attachment`；
- 回收站 entry id 严格正则 + 拒绝符号链接 + 恢复冲突改名不覆盖；
- **未发现**硬编码密钥、`eval/exec/pickle/yaml` 反序列化。

---

## 三、前端交互功能

### UI-1【高】文件夹重命名/移动后，子文档标签与激活路径不同步

**状态：已核实。**

`frontend/src/components/layout/LeftSidebar.tsx` 的 `handleRename` / `handleMove` 对**文件夹**也会 `notify({type:'rename'|'move', from: folderPath, to: newFolderPath})`。App 的处理：

```ts
// frontend/src/App.tsx:642-646
} else if ((m.type === 'rename' || m.type === 'move') && m.from && m.to) {
  setTabs((prev) => replaceTab(prev, m.from!, m.to!))
  if (m.from === article.id) await requestOpenArticle(m.to)
}
```

而 `replaceTab`（`frontend/src/components/layout/TabBar.tsx:50-55`）只做**精确 id 匹配**。因此 `Articles/Sub` 改名后，`Articles/Sub/a.md` 这类子文档的标签 id 与 `article.id` 都不更新（`m.from === article.id` 为 false）。此前 `handleBeforeFsMutation` 只保证变更前 flush，变更后不修正路径。

**影响**：移动文件夹后激活文档仍指向旧路径，之后任意编辑触发自动保存 → `PUT` 旧路径 404，且 404 提示被 `isCurrent` 门控（`EditorArea.tsx:433`）可能不提示；标签点击打开不存在的文件（又静默失败，见 UI-9）。

**修复**：对文件夹 `from/to` 做**前缀替换**（`t.id === from || t.id.startsWith(from + '/')`），并同步修正 `article.id/path`。

### UI-2【高·条件性】跨档保存竞态可污染当前编辑器

**状态：已核实代码路径。**

`frontend/src/components/layout/EditorArea.tsx:353-411`：`isCurrent` 在 `await` 之前（第 358 行）捕获，第 398 行仍用它做门控，随后 `setKeContent`：

```ts
const isCurrent = articleRef.current?.id === docId      // L358 陈旧快照
...
if (isCurrent && latest && ed) {                        // L398 用陈旧值
  ...
  setKeContent(ed, savedNorm)                            // 把 A 的内容写进此刻显示 B 的编辑器
  editorDocIdRef.current = docId
}
```

若 A 保存发起后用户在 `await saveArticle` 期间切到 B，且回包内容与本地归一化结果不一致（BOM/CRLF/服务端改写——正是 F15 分支设计场景），就会把 A 正文覆盖到 B 的编辑器。

**修复**：分支内重读实时态——`articleRef.current?.id === docId && editorDocIdRef.current === docId` 才 `setKeContent`。

### UI-3【中】`PromptDialog` 单例导致并发 `ask` 时 Promise 永久挂起

**状态：已核实。**

`frontend/src/components/common/PromptDialog.tsx:44-82` 用模块级 `activeDialog` / `setterRef`。若两处并发 `askPrompt/askConfirm`（如快速双击「新建文档」），后一次会覆盖 `activeDialog` 及 React state，**先发起的 `resolve` 永远不被调用**，其异步流程静默卡死。

**修复**：请求队列，或第二次请求直接返回取消；关闭时清空 `activeDialog`。

### UI-4【中】外部删除当前文档不清理标签、不激活相邻

**状态：已核实。**

`frontend/src/App.tsx:285-290` 的外部删除分支只 `setArticle(null)+alert`，而内部删除路径（`App.tsx:630-641`）会关闭标签并激活相邻。两条路径语义分叉，外部删除后标签仍指向已删文件。

**修复**：抽出统一的「关闭激活文档并激活相邻」函数，两条路径共用。

### UI-5【中】「外部修改」弹窗跨文档滞留

**状态：已核实。**

`extModal` 只在 fs 轮询里设置（`frontend/src/App.tsx:283-284`），切档不清理；`handleReloadExternal` 直接用 `extModal.rel` 调 `openArticle(rel)`（`App.tsx:458-469`）。用户在 A 弹窗后切到 B 继续编辑，点「重新加载」会**切回 A** 并可能丢弃 B 的编辑。

**修复**：文档切换时清空 `extModal`，或在 handler 内校验 `extModal.rel === articleIdRef.current`。

### UI-6【中】新建文档未加入标签集合

**状态：已核实。**

`frontend/src/App.tsx:590-595` 只 `setArticle(created)`，缺少正常打开路径里的 `setTabs(openTab(...))`。首次新建时 `tabs.length===0`，TabBar 整行不渲染；新建文档从标签体系消失。

**修复**：补 `setTabs(prev => openTab(prev, created))`。

### UI-7【中】`handleCloseWorkspace` 未捕获错误

**状态：已核实。**

`frontend/src/App.tsx:560-575` 第 573 行 `await closeWorkspace()` 无 try/catch，调用点也是 `void handleCloseWorkspace()`；后端 down 时抛未处理 rejection、界面无提示。同类入口 `switchWorkspace` / `handleNewArticle` 都有 try/catch，唯此处缺失。

### UI-8【中】公式渲染失败回退直接注入原始 LaTeX（XSS sink）

**状态：已核实 sink；触发条件待运行验证。**

`frontend/src/components/editor/nodeviews/MathNodeView.tsx:70-81` 与 `:101`：

```tsx
try { html = katex.renderToString(latex || '\\;', { throwOnError: false, output: 'html' }) }
catch { renderFailed = true }
...
dangerouslySetInnerHTML={{ __html: renderFailed ? latex : html }}
```

正常分支 KaTeX 会转义；`catch` 分支把**文档可控的原始 LaTeX** 当 HTML 注入。因 `throwOnError:false`，KaTeX 通常把语法错误渲染为红字而不抛，触发面较窄，但该 sink 本身应修复。

**修复**：回退分支改为渲染**转义文本**（如 `<code>` 的 textContent）。

### UI-9【中/低】打开文档失败无任何用户反馈

**状态：已核实。**

`frontend/src/App.tsx:316-318` 仅 `console.error`。后端 down / 404 / 409 时点击文档「没反应」，用户无从判断。

**修复**：状态条或提示框展示并可重试。

### 3.10 其余前端结论

- **[中·已核实]** 多文件拖拽插入点修复函数 `shouldInsertDroppedFiles` **未接线**（仅测试引用），`frontend/src/editor/index.ts:257-278` 仍固定 `pos` → 多文件同点插入、上传期间切档插入错位。
- **[中·已核实]** `clearRecentDocuments()` 无 catch（`LeftSidebar.tsx:722`）；`FootnoteDialog` 写 localStorage 无 try/catch（`EditorToolbar.tsx:221`）。
- **[中]** 源码模式内容 ref 为全局单槽（`EditorArea.tsx:459-463`），异常时序下可能跨档写入（正常入口都有前置 flush，故为潜在）。
- **[中]** FS 轮询无在途去重/序号（`App.tsx:255-271`），慢响应可回退 `eventCursor` 造成重复事件。
- **[中]** RightPanel 表单在 `article.title/tags` 变化时重置，静默丢弃未保存的属性编辑（`RightPanel.tsx:71-76`）。
- **[低]** 无障碍：文件树行是 `div+onClick` 无键盘支持、TabBar 无方向键导航、多个模态缺 `role/aria-modal/Esc/焦点陷阱`、部分输入框缺 label。
- **[低·已核实]** `Ctrl+K/Ctrl+S` 未做 IME(`isComposing`) 检查；回收站冲突改名后不自动重开。

### 3.11 前端「做得好」

- 保存队列 single-flight + latest-wins（`saveQueue.ts:50-104`）；
- `discardPending` 语义统一；
- 切档内容来源裁决与延迟载入代次守卫（`docSwitch.ts:65-200`）；
- 有界年龄恢复点登记（`draftDebounce.ts`）；
- 打开请求序号守卫（`requestSeq.ts`）；
- 自绘对话框规避 Tauri `window.confirm` 恒真陷阱；
- 快捷键分发器 IME / 保留键处理完整；
- 事件监听成对清理；
- 加载失败不静默（有「加载失败 + 重试」）。

---

## 四、桌面壳 / 供应链

### SEC-4【中/高】NSIS 钩子命令执行/注入

**状态：已核实。**

`desktop/src-tauri/nsis/legacy-migration.nsh:11-27` 从 **HKCU**（普通用户可写）读 `UninstallString` 并 `ExecWait '"$0" /S'` 直接执行；`InstallLocation` 还被字符串拼进 PowerShell `-Command`（引号可逃逸）：

```nsis
ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
ReadRegStr $1 HKCU "...\KnowledgeEditor" "InstallLocation"
...
ExecWait 'powershell.exe -noprofile -c "Get-Process knowledgeeditor ... | Where-Object { $_.Path -like \"$1*\" } | Stop-Process -Force ...; exit"'
ExecWait '"$0" /S'
```

若安装器以提升权限运行则构成本地提权。**修复**：只信任 HKLM/固定卸载器、注册表值绝不拼进命令行、路径做白名单规范化。（提权与否取决于未显式声明的 `installMode`，待打包产物核验。）

### SEC-6【中】CORS 源注入

**状态：已核实。**

`desktop/src-tauri/src/sidecar.rs:298-305` 把 `KE_CORS_ORIGINS` 直接并入白名单，并在 `:324` 注入后端；任何能设置该环境变量的手段即可把 `https://evil.example` 加进白名单（叠加 SEC-1 危害放大）。

**修复**：release 硬编码 white-list，忽略环境变量；dev 端口仅 `debug_assertions` 加。

### 4.3 其他桌面/供应链结论

- **[中] 供应链**：安装包签名默认可选（无证书即跳过，`scripts/build.ps1:122-127`）、时间戳走 HTTP；CI 的 desktop 任务 `continue-on-error: true`（`.github/workflows/ci.yml:84-87`）；GitHub Actions 未固定 commit SHA；PyInstaller 启用 UPX 且 `console=True`。侧车二进制**无运行时完整性校验**（构建期 `manifest.sha256` 无消费方）。
- **[低] 权限**：`core:default` 权限面偏大（含 devtools / `image:from_path` / menu / tray）；`dialog:default` 无 scope。
- **[低] CSP**：`connect-src`/`img-src` 放开本机任意端口、缺 `object-src`/`base-uri`/`form-action`。
- **[低]** 关窗握手二次触发（如连按两次 Ctrl+Q）会跳过前端 flush。
- **[低]** `APPDATA` 缺失时数据目录回退到 `"."`；`tools/gen-manifest.py` 硬编码绝对路径；NSIS 存在漂移的死副本。

### 4.4 桌面「做得好」

- sidecar 启动**不经 shell、无命令行参数**（仅 env 传参，避免路径/空格/引号注入）；
- `taskkill/tasklist/powershell/explorer` 均用参数数组且只插值 `u32` PID；
- 进程身份校验 + PID 复用防护；
- 有界退出清理（规避 PowerShell 阻塞主线程假死）；
- 健康握手校验 version；
- Tauri 安全基线（无 `remote` 能力、无 shell/fs/http 权限、`script-src 'self'`）；
- `settings.rs` 路径固定、字段白名单净化、原子写；
- 后端 Host 白名单防 DNS rebinding。

---

## 五、一致性与可测试性

- **[低·已核实] 版本/文档漂移**：代码版本为 `1.2.4`（`backend/app/__init__.py:34` 与 `frontend/src/version.ts:4` 一致），但 `README.md` 仍宣传「正式版 v1.1.9 / 预发布 v1.2.0-pre.2」。README 与 `config.py:39` 关于「token 已生成并注入」的注释均与实现不符，建议校正以免误导。
- **可测试性**：项目自带大量针对上述区域的测试（`test_delete_safety`、`test_import_export_safety`、`test_review_fixes_120`、`test_trash_verify` 等）。本审查环境缺依赖无法运行；建议在带 `backend/requirements.txt` 的环境执行 `python -m pytest backend/tests -q` 与前端 `npm run test` 复核，尤其针对 SEC-1/SEC-2/UI-1/UI-2 补用例。

---

## 六、建议修复优先级

1. **立即**：恢复本机 API 鉴权 + Origin 校验（SEC-1）；修文件夹重命名/移动的路径同步（UI-1）；修 `buildSaveFn` 陈旧 `isCurrent`（UI-2）。
2. **短期**：`create_doc` 业务边界（SEC-2）；`PromptDialog` 队列化（UI-3）；外部删除/外部修改弹窗的跨档一致性（UI-4/UI-5）；新建入标签（UI-6）；`handleCloseWorkspace` 错误处理（UI-7）；公式回退转义（UI-8）。
3. **中期**：NSIS 钩子加固与签名强制（SEC-4 / 供应链）；CORS 硬编码（SEC-6）；拖拽插入点接线、源码 ref 按 docId、轮询去重、导入流式化；无障碍补全；文档/版本漂移校正。

---

## 七、审查声明与局限

- 本报告为**只读静态审查**结论，未修改被审仓库任何文件。
- **未能运行**项目测试套件（环境缺 Python/Node 依赖），因此不含动态验证结果。
- 凡标注「待运行验证」的项目（SEC-1 的 CSRF 端点实测、UI-2 的时序复现、UI-8 的触发构造、SEC-4 的 `installMode` 确认）建议在真实环境用可复现脚本二次验证后再最终定级。
- 未标注「待验证」的条目均已由审查人对照原始代码或全仓检索核实。
