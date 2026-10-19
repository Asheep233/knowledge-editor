# P5-T26 G1/G2：guest 内容读通道 + 真实写通道（隔离产品 W 证据）

- 生成时间：2026-10-19T17:29:38+0800
- 分支/环境：`feat/ui-workshop`（本地，未 push/Release）；Windows 隔离产品构建
- 测试构建：`C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe`（sha256=`c849241bc9dd6be31cae8f3b7ac6c386b7c3431dcbec4d706f7725e86577be8f`，mtime=`2026-10-19T16:43:26`）
- guest 包：`com.probe.t26io`（capabilities=`["ui.shell","context.read","context.write"]`，签名 keyId=k1，trusted）
- 隔离工作区：`C:\ke-tmp\uiws-t26-guest-io\workspace`；隔离 APPDATA：`C:\ke-tmp\uiws-t26-guest-io\appdata`；测试文档：`Articles/io.md`
- 场景：guest 经真实协议线 → `context.snapshot` 读正文 → `context.write` 写新正文 → 回读 → 旧 revision 再写（CAS 冲突）

## 结论

**PASS**：14/14 checks 通过。本证据只覆盖下列 checks；未覆盖/未执行的部分见「限制与残余风险」。

## Checks

| # | check | 结果 | 关键值 |
| --- | --- | --- | --- |
| 1 | W-T26-G1G2-1 安装声明 context.write 的签名包（Rust ALLOWED_CAPS 放行） | PASS | `{"ok": true, "value": {"active": "1.0.0", "previous": null, "updatedAt": "SystemTime { intervals: 134368757756700535 }"}}` |
| 2 | W-T26-G1G2-2 会话 active（guest 经真实协议线启用） | PASS | `{"capabilities": ["ui.shell", "context.read", "context.write"], "lastError": null, "packId": "com.probe.t26io", "state": "active", "updatedAt": "SystemTime { intervals: 134368757762388910 }"}` |
| 3 | W-T26-G1G2-3 握手能力协商含 context.read + context.write（G2 能力可授予） | PASS | `{"acceptedFeatures": ["context.read", "context.write"]}` |
| 4 | W-T26-G1G2-4 context.snapshot 返回正文（G1），且等于磁盘原文 | PASS | `{"phase": "guest-io-done", "error": null, "contentLen": 37, "revision": 0}` |
| 5 | W-T26-G1G2-5 contentBytes/diskHash 与磁盘原文一致（revision 绑定可信） | PASS | `{"contentBytes": 37, "expectBytes": 37, "diskHash": "f1a6be4d47a7e9e904d166f35329dba87b806fd17cebc93a10ea749a711898d0"}` |
| 6 | W-T26-G1G2-6 context.write 真实完成：status=completed、revision=快照+1、fileDurable=true（不伪造） | PASS | `{"write1": {"requestId": "guest-io-w1", "status": "completed", "revision": 1, "accepted": true, "recoveryDurable": true, "fileDurable": true}, "snapshot1Revision": 0}` |
| 7 | W-T26-G1G2-7 write#1 requestId 原样回传（幂等键） | PASS | `{"requestId": "guest-io-w1"}` |
| 8 | W-T26-G1G2-8 磁盘真实落盘 = guest 写入正文（假桩不可能通过） | PASS | `{"diskLen": 45, "head": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n"}` |
| 9 | W-T26-G1G2-9 再次 snapshot 读到新正文且 revision 递增（G1 回读） | PASS | `{"snapshot2": {"revision": 1, "contentLen": 45, "hasContent": true, "diskHash": "54c56efc8a085a2e8a67c2806e1cab579166cebe52be0dc58097e22ac1e005c9"}}` |
| 10 | W-T26-G1G2-10 旧 revision 再写 → conflict/kind=revision + currentRevision（CAS 生效） | PASS | `{"write2": {"requestId": "guest-io-w2", "status": "conflict", "kind": "revision", "currentRevision": 1}, "snapshot2Revision": 1}` |
| 11 | W-T26-G1G2-11 冲突写未覆盖磁盘（无 CONFLICT 标记，仍为 write#1 正文） | PASS | `{"head": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n"}` |
| 12 | W-T26-G1G2-12 会话能力含 context.write（能力矩阵变化已生效） | PASS | `{"capabilities": ["ui.shell", "context.read", "context.write"]}` |
| 13 | W-T26-G1G2-13 主进程存活 | PASS | `null` |
| 14 | W-T26-G1G2-14 用户实例未运行 → N/A（隔离测试未触碰用户数据） | PASS | `{"user_pid": "N/A (not running)"}` |

## 关键实测值

```json
{
  "isolation_residual_banner": true,
  "initial_content": "---\ntitle: io\n---\n\nT26 G1G2 original\n",
  "write_content": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n",
  "snapshot1": {
    "relPath": "Articles/io.md",
    "revision": 0,
    "diskHash": "f1a6be4d47a7e9e904d166f35329dba87b806fd17cebc93a10ea749a711898d0",
    "content": "---\ntitle: io\n---\n\nT26 G1G2 original\n",
    "contentBytes": 37,
    "hasContent": true,
    "contentLen": 37
  },
  "write1": {
    "requestId": "guest-io-w1",
    "status": "completed",
    "revision": 1,
    "accepted": true,
    "recoveryDurable": true,
    "fileDurable": true
  },
  "snapshot2": {
    "relPath": "Articles/io.md",
    "revision": 1,
    "diskHash": "54c56efc8a085a2e8a67c2806e1cab579166cebe52be0dc58097e22ac1e005c9",
    "content": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n",
    "contentBytes": 45,
    "hasContent": true,
    "contentLen": 45
  },
  "write2": {
    "requestId": "guest-io-w2",
    "status": "conflict",
    "kind": "revision",
    "currentRevision": 1
  },
  "disk_after_write": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n",
  "disk_after_conflict": "---\ntitle: io\n---\n\nT26 G1G2 written by guest\n",
  "session_capabilities": [
    "ui.shell",
    "context.read",
    "context.write"
  ],
  "accepted_features": [
    "context.read",
    "context.write"
  ]
}
```

## 能力矩阵变化（T26 G1/G2 后）

| 层 | 变化 |
| --- | --- |
| 协议方法 `context.snapshot` | result 新增**可选** `content?`/`contentBytes?`（additive，未升 protocolVersion；旧客户端忽略） |
| 协议方法 `context.write` | 产品桥由**假完成桩**改为真实 `POST /api/context/write`（completed/conflict/stale/failed 如实返回） |
| 前端 manifest 允许能力 | `+ context.write`（`frontend/src/core/packs/manifest.ts`） |
| 前端信任等级 | `context.write` → trusted/builtin 授予；community **不授予**（`trustPolicy.ts`） |
| 安装预览风险 | `context.write` = **high** 风险（`installPolicy.ts`） |
| Rust 安装门禁 | `ALLOWED_CAPS` `+ context.write`（`desktop/src-tauri/src/pack_store.rs`） |
| 产品 Broker 后端 | snapshot 内容读走既有 `GET /api/articles/{rel}`（未改 backend）；write 走 `HttpTransport` 既有语义 |

## 限制与残余风险（如实记录）

- **G1 与后端零改动**：正文复用既有只读文档 API `GET /api/articles/{rel}`（返回完整原文含 BOM/frontmatter/CRLF），`/api/context/snapshot` 后端未改；snapshot 与正文读取是两次 HTTP，理论存在「两次请求之间外部改盘」的竞态（本次隔离单客户端未触发）。
- **只读通道的非文档路径**：`context.snapshot` 对非文档路径（如 Attachments/）无法经文档 API 读正文时，按设计退化为旧形状（无 `content`），guest 需处理 content 缺失。
- **未在本探针复跑负向能力 W**：无 `context.read`/`context.write` 能力时的拒绝路径由 U 测试覆盖，且既往 W06 越权证据已记录（本次未重复跑）。
- **`currentEpoch()` 仍固定返回 1**（`WorkshopGuestFrame.tsx` 既有实现，属 F01-F16 审计附带风险）：本探针未覆盖「切库后旧连接写被 E_STALE_CONTEXT 拒绝」的真实产品路径（后端 epoch 409 兜底未在此场景触发）。
- **guest 写绕过宿主编辑器保存桥**（CoreSaveBridge coordinator 不感知 guest 写入）：若官方 UI 同时打开同一文档，宿主下一次保存可能 CAS 冲突（会透传 conflict/需恢复），本探针不并发官方编辑。
- **打印桩（G3）未改动**；`print.snapshot` 仍是桩（不在本任务范围）。
- **SDK 类型未同步**：`docs/ui-workshop/sdk/src/index.ts` 的 `request` 返回 `unknown`，additive 字段无功能影响；若 SDK 后续加类型需同步。
- **已知 A7 隔离残余风险**：本次探针页面同样出现 `E_ISOLATION_RESIDUAL: guest 可见 __TAURI_INTERNALS__` 横幅（remote IPC invoke 已拒绝）——与 G1/G2 无关，沿用 `P5-T26-A7-isolation.md` 的结论，属既有残余风险。
- 本证据为**隔离测试构建**上的 Windows 产品 W，不等于官方 UI 全量基线；不替代 F01–F16 逐项登记。

## 复现

```powershell
# 前置：测试构建 C:\ke-tmp\uiws-t26\bin\knowledgeeditor.exe 已包含本任务前端+Rust 改动
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\y8882\AppData\Local\Python\pythoncore-3.14-64\python.exe' -X utf8 'F:\Work\KE Project\knowledge-editor\docs\ui-workshop\tools\run_t26_guest_io_probe.py'
```

原始 JSON：`docs/ui-workshop/evidence/T26-G1G2-results.json`
