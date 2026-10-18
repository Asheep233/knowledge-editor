# P1-T11 证据：Tauri/WebView2 传输探针（Windows 实机 7/7 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 app `uiws-s1-probe`）**
- 代码：
  - guest 侧：`docs/ui-workshop/core/protocol/probe/guest_probe.ts`（sandbox iframe 内运行**真实
    `frontend/src/core/protocol/channel.ts::GuestClient`**）
  - host 侧：`probe/host_probe.ts`（主窗口运行真实 `HostDispatcher`；创建 sandbox iframe 并桥接传输）
  - 构建：`probe/build_protocol_probe.sh`（guest bundle 作为文本内联进 iframe srcdoc）
  - 宿主：`prototypes/p0/s1_runtime/tauri_sandbox/`（Rust setup 打开 `protocol-render` 窗口加载 protocol.html）
  - 驱动：`prototypes/p0/s1_runtime/run_protocol_probe.py`
- 原始结果：`evidence/T11-transport-probe-results.json`（**7/7 断言通过**）
- 证据类型：**W（Windows/WebView2 实机）**

## 实测结果

| 检查 | 结果 |
| --- | --- |
| W-T11-1 Rust setup 打开 protocol-render 窗口 | **PASS** |
| W-T11-2 guest 侧协议完成（非 timeout/error） | **PASS**（phase=protocol-done / guest-done） |
| W-T11-3 握手成功 + 能力协商（write 被接受） | **PASS**（acceptedFeatures=`[write, print]`） |
| W-T11-4 握手返回 context/epoch 绑定 | **PASS**（contextId=`ctx-proto`, epoch=1） |
| W-T11-5 类型化 request 往返（context.write completed/fileDurable） | **PASS**（revision=1, fileDurable=true） |
| W-T11-6 host→guest 事件投递（theme-changed/context-changed） | **PASS** |
| W-T11-7 真实 WebView2 环境（UA Edg/155） | **PASS** |

## 关键发现（影响 T11/T18 传输设计）

1. **MessagePort 不能 transfer 进 opaque-origin sandbox iframe（WebView2/Chromium 实测）**：
   `iframe.contentWindow.postMessage({type:'probe-port'}, '*', [channel.port2])` 在宿主侧成功执行，
   guest 也收到 `message` 事件，但 **`e.data.port` 为空**（消息到达、port 丢失）→ handshake 卡死。
   原因与安全模型一致：sandbox iframe（无 `allow-same-origin`）是 opaque origin/独立 agent cluster，
   MessagePort 无法跨 agent cluster transfer。
2. 传输候选退化为 **window.postMessage JSON 线**（带 `direction`/channel 标记）：同一轮探针下
   handshake/request/event 全部通过（W-T11-3/5/6）；该线仍由同一份协议类型/通道实现驱动（guest/host 都跑真实模块）。
3. 因此首发 guest 传输 = **postMessage JSON 桥（结构化 clone，带 channel/方向标签）**；
   性能敏感通道（编辑器面交互）只与宿主编辑面同 webview，不跨 iframe，不受此限制。
4. 若未来需要 MessagePort/SharedWorker，需要独立 WebviewWindow/自定义 origin（S1b 路线），
   代价是窗口形态与 ACL 配置（T18 决策）。

## 限制 / 未验证

- 探针采用 ad-hoc JSON 线适配器；**生产版 `iframeTransport.ts`（channel/背压/版本握手/错误映射）尚未产品化**，
  且未与真实包加载器（T17）接线。
- 未测大消息（附件/全文）在 postMessage 下的性能与内存上限；未测事件背压/丢弃策略。
- 未做 WebviewWindow 之间的传输探针（当前架构编辑面同 webview，guest 周边 UI 用 iframe 桥）。
