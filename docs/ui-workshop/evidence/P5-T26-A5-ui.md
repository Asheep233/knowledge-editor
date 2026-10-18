# P5-T26 A5 证据：工坊信任 UI（真实产品壳 + flag 构建）— W 11/11 PASS

- 日期：2026-10-19 · 平台：**Windows 11 + WebView2（真实产品壳隔离测试构建 com.astranota.uiws.e2e）**
- 前置：产品 dist 以 `VITE_KE_WORKSHOP=1` 构建（工坊入口开启）；隔离测试构建；env
  `KE_WORKSHOP_PUBKEYS` 提供签名公钥；`KE_WORKSPACE` 指向一次性隔离工作区（使主 UI 渲染）
- 工具：`tools/run_t26_ui_probe.py`（CDP DOM 交互：入口点击/按钮点击/徽章文本/localStorage 校验）
- 原始结果：`evidence/T26-A5-ui-results.json` · 证据类型：**W（真实产品 UI/命令/localStorage）**

## 实测结果：11/11 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-A5-1 产品实例启动 + IPC 就绪 | PASS |
| W-T26-A5-2 预装签名包成功（真实 `workshop_pack_install`） | PASS |
| **W-T26-A5-3 flag 构建下工坊入口可见（创意工坊）** | PASS |
| **W-T26-A5-4 面板打开并加载真实已安装包列表** | PASS（T26 UI Pack） |
| **W-T26-A5-5 列表显示真实签名徽章（签名：valid）** | PASS |
| W-T26-A5-6 默认信任等级 community | PASS |
| **W-T26-A5-7 授予 trusted → TrustStore 持久化** | PASS（`{"com.probe.t26ui":"trusted"}`） |
| **W-T26-A5-8 面板徽章更新为 trusted** | PASS |
| **W-T26-A5-9 撤销信任 → community（持久化清除）** | PASS |
| W-T26-A5-10 主进程存活（UI 链路无崩溃） | PASS |
| W-T26-A5-11 用户运行中的 AstraNota 未受影响 | PASS |

## 工程发现

- 产品主 UI 前置：**工作区必须先打开**（否则显示 WorkspacePicker，工坊入口不渲染）；隔离测试通过
  `KE_WORKSPACE` + `ensure_workspace_structure` 预置工作区解决，不触碰真实库。
- flag 构建方式：`VITE_KE_WORKSHOP=1 npm run build` → 复制到测试构建资源目录 → 重编测试二进制
  （dist 嵌入）；验证后已恢复默认 dist 与主产品构建。

## 结论

- T26 计划 **A5 的「信任授予/撤销 UI + 真实签名徽章 + TrustStore 持久化」完成**；
  剩余 A5 部分（**能力上限在真实包会话运行时的强制执行**）依赖 A7 产品侧包隔离宿主装配，
  仍列为未完成，不冒进。
