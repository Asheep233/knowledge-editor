# Phase 3.9 报告：保存按钮与保存状态竞态修复

日期：2026-08-09

涉及文件：`frontend/src/components/layout/EditorArea.tsx`（仅此一个文件）

## 一、修改内容

### 1. 新增常驻「保存」按钮

此前编辑器只有三种保存途径：3 秒防抖自动保存、Ctrl+S / Cmd+S 快捷键、保存失败时的「重试」按钮，没有常驻的手动保存入口。本次在文档标签栏新增「保存」按钮：

- **位置**：标签栏右侧，紧跟保存状态文字之后、「重试」按钮之前。
- **行为**：点击调用已有的 `saveNow()`（与 Ctrl+S 同一路径），立即序列化当前 Markdown 并写入数据库，不等防抖。
- **禁用逻辑**：`disabled={!article || loading}`，未打开文档或文档加载中时置灰（`disabled:opacity-40`），防止空保存。
- **样式**：与「重试」按钮同级的轻量按钮（`border border-gray-200 bg-white ... hover:bg-gray-50`），视觉上弱于主操作，不干扰现有自动保存流程。

```tsx
<button
  type="button"
  onClick={() => void saveNow()}
  disabled={!article || loading}
  className="ml-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
>
  保存
</button>
```

### 2. 保存状态竞态修复

**问题背景**：3 秒防抖自动保存触发后，用户若在保存期间继续编辑，保存完成时会无条件显示「已保存」，把保存期间产生的新内容错误地标记为已持久化——用户可能因此以为最新的编辑已落盘，实际上它们尚未保存。

**修复方案**：引入编辑序号 `editSeqRef`（`useRef(0)`）做保存完成时的比对：

1. 每次内容变更（`handleUpdate`）将 `editSeqRef.current += 1`，并捕获本次序号 `seq`。
2. 防抖到期后异步保存，完成时比较：`editSeqRef.current === seq` 则保存期间无新编辑 → 「已保存」；否则有新编辑 → 保持「未保存…」（后续防抖会再次触发，最终收敛）。
3. 同一逻辑同步应用到 `saveNow()`（手动按钮 / Ctrl+S），保证两条保存路径行为一致。

```ts
// handleUpdate（防抖路径）
editSeqRef.current += 1
const seq = editSeqRef.current
setSaveState('dirty')
// …3s 后…
await saveArticle(article.id, withFrontmatter(md, KE_VERSION))
setSaveState(editSeqRef.current === seq ? 'saved' : 'dirty')

// saveNow（手动路径）
const seq = editSeqRef.current
// …await saveArticle…
setSaveState(editSeqRef.current === seq ? 'saved' : 'dirty')
```

保存状态机维持不变：`'idle' | 'dirty' | 'saving' | 'saved' | 'error'`，文字映射 `SAVE_LABEL` 未改动。

## 二、行为对照

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 手动保存按钮 | 无 | 常驻于标签栏，点击立即保存 |
| 自动保存完成，期间无新编辑 | 「已保存」 | 「已保存」（不变） |
| 自动保存完成，期间有新编辑 | 误显示「已保存」 | 保持「未保存…」，防抖重新计时 |
| 手动保存完成，期间有新编辑 | 误显示「已保存」 | 保持「未保存…」 |
| 保存失败 | 「保存失败」+「重试」 | 不变 |

## 三、验证结果

| 验证项 | 结果 |
| --- | --- |
| `npx tsc -b` 类型检查（保存按钮） | 通过 |
| `npm run build` 生产构建（保存按钮） | 成功（7.20s） |
| `npx tsc -b` 类型检查（竞态修复） | 通过 |

## 四、当前风险

1. **序号比对仅覆盖成功路径**：`editSeqRef` 在 `handleUpdate` 的编辑入口递增；保存失败走 `setSaveState('error')`，不会误报「已保存」。若失败后用户继续编辑，序号继续递增，下次保存成功时的比对不受影响。
2. **自动保存与手动保存并存**：手动保存不会清空未决的防抖定时器，若用户在点击「保存」后的 3 秒内又编辑，防抖仍会按原计划再保存一次——结果幂等（同一内容写入两次），无数据风险。
3. **「已保存」语义**：显示「已保存」仅代表当前序列化内容已写入数据库，不代表后端索引（SQLite）已完成其他衍生处理；与 Phase 3 的保存链路定义一致。
