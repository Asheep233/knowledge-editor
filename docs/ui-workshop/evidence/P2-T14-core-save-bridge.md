# P2-T14 证据：Core 保存桥（ADR-002 步骤 1）— 单元 8 例 + 真实后端 e2e 11/11

- 日期：2026-10-19 · 代码：
  - `frontend/src/core/session/coreSaveBridge.ts`（DOM-free）：
    - `ensureContext`：`GET /api/workspace/info` → `POST /api/context/open`（id=`ke-default`）；
      已存在（409）→ `switch` 取最新 epoch；模块级缓存；`invalidate()` 切库失效；
    - `createSaveFn(relPath, getContent)`：取可信快照（revision+diskHash）→ SaveCoordinator
      （HttpTransport + RecoveryJournal）→ 返回产品 `SaveFn`（仅 file_durable resolve）；
    - `saveDocument(relPath, content)`：一次性保存；冲突映射 `E_CONFLICT`/`E_CONFLICT_EXTERNAL`/
      `E_STALE_CONTEXT`（旧 UI 提示可用）；成功后 revision 前进，后续保存自动用新 revision。
  - 单元测试 `coreSaveBridge.test.ts` 8 例（注入 fetch）
  - e2e：`docs/ui-workshop/core/session/t14_bridge_e2e.ts` + `run_t14_bridge_e2e.sh`
    （隔离 uvicorn + 临时工作区，真实 `/api/context/*`）
- 证据类型：**U（单元）+ A（真实后端 e2e）**；尚未接 EditorArea（ADR-002 步骤 2）

## 验证结果

```text
$ npx vitest run src/core/session
Tests  37 passed (37)          # 含 coreSaveBridge 8 例
$ npx tsc -b --noEmit
exit 0
$ bash core/session/run_t14_bridge_e2e.sh
SUMMARY 11/11 PASS
```

| 单元用例 | 验证 |
| --- | --- |
| ensureContext 缓存 | workspace/info + context/open 仅一次；binding=ke-default/epoch |
| open 409 | 自动 switch 取最新 epoch |
| 两次保存 | 首次 expected_revision=0→rev1；第二次 expected_revision=1→rev2（快照/revision 正确推进） |
| revision 冲突 | 抛 CoreSaveError(E_CONFLICT) |
| epoch 过期 | 抛 CoreSaveError(E_STALE_CONTEXT) |
| invalidate | 丢弃缓存后重新 open（epoch 更新） |
| 工作区未打开 | 明确 E_CONTEXT 错误 |
| DOM/React 守卫 | 源码无 DOM/React |

| e2e 检查（真实后端，11/11） | 结果 |
| --- | --- |
| 工作区创建/打开、桥解析上下文 | PASS |
| 首次保存 revision=1、二次保存 revision=2 | PASS |
| tree 可见桥保存文档、search 命中内容 | PASS |
| snapshot 接口 rev+hash、新桥实例按当前 revision 保存 | PASS |
| **切库后旧桥保存被拒（E_STALE_CONTEXT，不静默写入）**、switch 返回新 epoch | PASS |

## 结论

- T14 的**上下文解析 + Core 保存组合**成立并经真实后端验证：快照 revision 正确推进、冲突/切库屏障
  不静默写入、旧 UI 错误映射可用；是 ADR-002 步骤 1 的完成。
- 尚未完成（T14 步骤 2/3）：
  1. `EditorArea.buildSaveFn` flag 分支接入 `createSaveFn`（仅当前文档 WYSIWYG；禁止双写）；
  2. 字节一致性对比（新旧链对同一编辑输出一致）与恢复点/源码通道回归；
  3. 产品 UI 手工验收 + Windows/WebView2 保存实机 W；通过后才可考虑 flag 默认开启。
