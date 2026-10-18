# P3-T18 证据：Windows/WebView2 恶意/故障 guest 越权探针（12/12 PASS）

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2 155（Tauri v2 原型 `uiws-s1-probe`）**
- 代码：
  - host：`docs/ui-workshop/core/broker/probe/host_probe.ts`（真实 `Broker` + `brokeredHandlers` +
    `HostDispatcher`，sandbox iframe 内经 `window.postMessage` JSON 线连接）
  - guest：`probe/guest_probe.ts`（真实 `GuestClient`；扮演**恶意/故障 guest**依次越权）
  - 构建/驱动：`probe/build_broker_probe.sh`、`prototypes/p0/s1_runtime/run_broker_probe.py`
- 原始结果：`evidence/T18-broker-probe-results.json` · 证据类型：**W（Windows/WebView2 实机）**

## 实测结果：**12/12 PASS**

| 检查 | 结果 |
| --- | --- |
| W-T18-1 Rust setup 打开 broker-render 窗口 | PASS |
| W-T18-2 guest 探针完成（无 crash） | PASS |
| W-T18-3 握手只回传已授能力 `[context.read, print.request, ui.shell]` | PASS |
| W-T18-4 允许的 `context.snapshot` 成功 | PASS |
| **W-T18-5 越权 `context.write` → `E_CAPABILITY`** | PASS |
| W-T18-6 已声明命令 `demo.hello` 可执行 | PASS |
| **W-T18-7 未声明命令 `system.exec` → `E_FORBIDDEN`** | PASS |
| **W-T18-8 超限 payload（>1024B）→ `E_BAD_PAYLOAD`** | PASS |
| **W-T18-9 未知方法 → `E_UNKNOWN_METHOD`** | PASS |
| **W-T18-10 opaque iframe 直接调 Tauri 原生命令被拒** | PASS：`rejected: Origin header is not a valid URL` |
| **W-T18-11 连续攻击后 host 仍健康（后续 snapshot 成功）** | PASS |
| W-T18-12 真实 WebView2（UA=Edg/155） | PASS |

## 结论

- T18 核心安全语义在 Windows/WebView2 实机成立：
  1. guest **没有任意 app 命令面**——只能经受控协议方法，且方法级能力/命令白名单/epoch/有界代理全部生效；
  2. **opaque sandbox iframe 无法直接触达 Tauri 原生命令**（Origin 校验拒绝，与 S1 结论一致）；
  3. 越权/畸形/超限请求被类型化拒绝，**host 状态不被破坏**（攻击后仍正常服务）。
- 尚未完成（T18 继续）：
  1. 真实产品 guest 连接建立（HostDispatcher 注入连接身份、`protocol.capabilities` 回传、包激活时
     能力集合生成）与产品壳接线；
  2. 三档策略（外部/网络/部分可信）与**用户授权 UI**（T22）；首次安装确认；
  3. 后端写口按来源收紧的端到端验证（T09 CORS 基础已有，需与真实包访问路径合并测试）。
