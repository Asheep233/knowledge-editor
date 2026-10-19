/**
 * 参考包 A · 侧栏阅读器（读场景）—— 使用发布 SDK `sdk/dist/guest-sdk.js`（全局 `KeWorkshopSDK`）。
 *
 * 覆盖能力（manifest 声明，最小集）：
 * - `ui.shell`       协议线/命令桥基础能力（握手/心跳/请求通道）；
 * - `panel.sidebar`  侧栏面板定位（声明式，宿主按信任等级授予）；
 * - `context.read`   `context.snapshot` 返回正文（G1：content/contentBytes）；
 * - `print.request`  `print.snapshot` 走宿主真实打印管线（G3：真实 PDF + 不透明 token）。
 *
 * 行为：
 * 1. `KeWorkshopSDK.autoConnect` 等待宿主 `t19-port` → 握手 → 展示 acceptedFeatures/contextId/epoch；
 * 2. 200ms 心跳（宿主心跳监控；发布 SDK 的 `heartbeat()`）；
 * 3. 「读取快照」经 Broker 读 `context.snapshot`，展示 frontmatter 标题 + 正文摘要 + revision/diskHash；
 * 4. 监听宿主 HostEvent（wire `{type:'event', event}`）：`document-saved` 到达后自动重读该 relPath 快照；
 *    （注意：发布 SDK 0.1.0 尚未暴露事件订阅 API，本包按协议 wire 直接监听，见 README「已知限制」）
 * 5. 「打印快照」请求 `print.snapshot`，展示 pdfToken/pages（pages 不可得时为 null，不伪造）；
 * 6. 所有失败在 UI 内显示错误码/消息（不静默）。
 *
 * 诊断：每次状态变化后向宿主 `postMessage({type:'t19-guest-results', payload:<state>})`，
 * 供工坊宿主/探针观察 UI 状态（产品宿主组件本身即收集该消息，不改变协议语义）。
 */
(function () {
  'use strict';

  var PACK_ID = 'com.astranota.cloud.smoke';
  var FEATURES = ['ui.shell', 'panel.sidebar', 'context.read', 'print.request'];
  var HEARTBEAT_MS = 200;
  var SDK = window.KeWorkshopSDK;

  var conn = null;
  var state = {
    phase: 'booting',
    packId: PACK_ID,
    sdkVersion: SDK && SDK.SDK_VERSION ? SDK.SDK_VERSION : null,
    connected: false,
    requestedFeatures: FEATURES.slice(),
    acceptedFeatures: [],
    handshake: null,
    heartbeatCount: 0,
    snapshot: null,
    printResult: null,
    lastEvent: null,
    lastError: null,
    statusText: '启动中…',
  };
  var heartbeatTimer = null;
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text == null ? '—' : String(text);
  }
  function esc(text) {
    return String(text == null ? '' : text);
  }
  function setStatus(text) {
    state.statusText = text;
    setText('status', text);
    report();
  }
  function showError(err) {
    var code = err && err.code ? String(err.code) : '';
    var message = err && err.message ? String(err.message) : String(err);
    state.lastError = { code: code, message: message };
    $('error-box').hidden = false;
    setText('error-text', (code ? code + ': ' : '') + message);
    report();
  }
  function clearError() {
    state.lastError = null;
    $('error-box').hidden = true;
    setText('error-text', '');
  }

  /** 状态镜像：宿主/探针可在主窗口 `window.addEventListener('message')` 收到。 */
  function report() {
    try {
      var rendered = {
        status: $('status') ? $('status').textContent : null,
        title: $('doc-title') ? $('doc-title').textContent : null,
        meta: $('doc-meta') ? $('doc-meta').textContent : null,
        snippet: $('doc-snippet') ? $('doc-snippet').textContent : null,
        content: $('doc-content') ? $('doc-content').textContent : null,
        lastEvent: $('last-event') ? $('last-event').textContent : null,
        printResult: $('print-result') ? $('print-result').textContent : null,
        errorText: $('error-box') && !$('error-box').hidden && $('error-text') ? $('error-text').textContent : null,
      };
      window.parent.postMessage(
        {
          type: 't19-guest-results',
          payload: {
            phase: 'pack-a-state',
            packId: state.packId,
            sdkVersion: state.sdkVersion,
            connected: state.connected,
            requestedFeatures: state.requestedFeatures,
            acceptedFeatures: state.acceptedFeatures,
            handshake: state.handshake,
            heartbeatCount: state.heartbeatCount,
            snapshot: state.snapshot,
            printResult: state.printResult,
            lastEvent: state.lastEvent,
            lastError: state.lastError,
            statusText: state.statusText,
            rendered: rendered,
          },
        },
        '*',
      );
    } catch (e) {
      /* 镜像失败不影响主流程 */
    }
  }

  // ---------------- 快照内容解析（demo 级：frontmatter title + 正文） ----------------

  function splitFrontmatter(content) {
    var text = String(content == null ? '' : content).replace(/^\uFEFF/, '');
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { frontmatter: '', body: text };
    return { frontmatter: m[1], body: text.slice(m[0].length) };
  }

  function parseTitle(content, relPath) {
    var parts = splitFrontmatter(content);
    var m = /(^|\n)title:\s*(.+?)\s*(\r?\n|$)/.exec(parts.frontmatter);
    if (m && m[2]) return m[2].replace(/^["']|["']$/g, '');
    var h = /(^|\n)#\s+(.+?)\s*(\r?\n|$)/.exec(parts.body);
    if (h && h[2]) return h[2];
    return relPath ? relPath.split('/').pop() : '（无标题）';
  }

  function applySnapshot(snap, relPath, reason) {
    var hasContent = typeof snap.content === 'string';
    var content = hasContent ? snap.content : '';
    var parts = splitFrontmatter(content);
    var body = parts.body.trim();
    var title = hasContent ? parseTitle(content, relPath) : relPath.split('/').pop();
    state.snapshot = {
      relPath: snap.relPath || relPath,
      revision: snap.revision,
      diskHash: snap.diskHash,
      contentBytes: snap.contentBytes == null ? null : snap.contentBytes,
      hasContent: hasContent,
      contentLen: content.length,
      title: title,
      snippet: body.slice(0, 200),
      tail: body.slice(-120),
      reason: reason || 'manual',
    };
    setText('doc-title', title);
    setText(
      'doc-meta',
      (state.snapshot.relPath || '') +
        ' · revision=' +
        (snap.revision == null ? '?' : snap.revision) +
        ' · diskHash=' +
        String(snap.diskHash || '').slice(0, 12) +
        '…' +
        (state.snapshot.contentBytes == null ? '' : ' · ' + state.snapshot.contentBytes + ' bytes'),
    );
    setText('doc-snippet', body.slice(0, 200) || '（正文为空）');
    setText('doc-content', hasContent ? body : '（该响应不含 content：缺少 context.read 或读取退化）');
    clearError();
    report();
  }

  // ---------------- 能力请求 ----------------

  async function loadSnapshot(relPath, reason) {
    if (!conn) {
      showError(new Error('未连接：协议线尚未建立'));
      return null;
    }
    relPath = String(relPath || '').trim();
    if (!relPath) {
      showError(new Error('请先填写文档路径（如 Articles/example.md）'));
      return null;
    }
    $('btn-load').disabled = true;
    setStatus('读取快照中…（' + reason + '）');
    try {
      var snap = await conn.request('context.snapshot', { relPath: relPath });
      applySnapshot(snap, relPath, reason);
      setStatus('快照已读取（' + reason + '）');
      return snap;
    } catch (e) {
      showError(e);
      setStatus('读取快照失败');
      return null;
    } finally {
      $('btn-load').disabled = false;
    }
  }

  async function printSnapshot() {
    if (!conn) {
      showError(new Error('未连接：协议线尚未建立'));
      return;
    }
    var relPath = $('rel-path').value.trim() || (state.snapshot && state.snapshot.relPath);
    if (!relPath) {
      showError(new Error('请先填写或读取一个文档路径'));
      return;
    }
    $('btn-print').disabled = true;
    setStatus('请求真实打印管线中…（宿主生成 PDF 期间主窗口阻塞属已知行为）');
    clearError();
    try {
      var result = await conn.request('print.snapshot', { relPath: relPath });
      state.printResult = { pdfToken: result && result.pdfToken, pages: result && result.pages };
      setText(
        'print-result',
        '真实 PDF token=' +
          String(result.pdfToken || '').slice(0, 24) +
          '… · pages=' +
          (result.pages == null ? 'null（宿主不可得，未伪造）' : result.pages),
      );
      setStatus('打印请求完成');
    } catch (e) {
      state.printResult = null;
      setText('print-result', '失败：' + (e && e.message ? e.message : String(e)));
      showError(e);
      setStatus('打印请求失败');
    } finally {
      $('btn-print').disabled = false;
      report();
    }
  }

  // ---------------- HostEvent（发布 SDK 0.1.0 无事件订阅 API → 按 wire 直接监听） ----------------

  function handleHostEvent(event) {
    if (!event || typeof event !== 'object') return;
    var summary = { type: event.type };
    if (event.type === 'document-saved') {
      summary.relPath = event.relPath;
      summary.revision = event.revision;
    } else if (event.type === 'context-changed') {
      summary.contextId = event.contextId;
      summary.epoch = event.epoch;
    } else if (event.type === 'theme-changed') {
      summary.theme = event.theme;
    }
    summary.receivedAt = Date.now();
    state.lastEvent = summary;
    setText(
      'last-event',
      event.type === 'document-saved'
        ? 'document-saved · ' + event.relPath + ' · revision=' + event.revision
        : String(event.type) + ' · ' + JSON.stringify(summary),
    );
    var li = document.createElement('li');
    li.textContent = new Date(summary.receivedAt).toLocaleTimeString() + ' ' + JSON.stringify(summary);
    $('event-list').appendChild(li);
    report();
    if (event.type === 'document-saved' && typeof event.relPath === 'string') {
      $('rel-path').value = event.relPath;
      void loadSnapshot(event.relPath, 'document-saved');
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 't19-wire' || d.direction !== 'host-to-guest') return;
    var msg = d.msg;
    if (msg && msg.type === 'event') handleHostEvent(msg.event);
  });

  // ---------------- 启动：autoConnect → 握手 → 心跳 ----------------

  async function main() {
    setText('sdk-version', state.sdkVersion || '未加载');
    setText('cap-chip', '能力：' + FEATURES.join(' / '));
    if (!SDK || typeof SDK.autoConnect !== 'function') {
      showError(new Error('发布 SDK 未加载：vendor/guest-sdk.js 缺失或 CSP 阻断'));
      setStatus('SDK 未加载');
      return;
    }
    setStatus('等待宿主 t19-port 与握手…');
    try {
      conn = await SDK.autoConnect({ requestedFeatures: FEATURES, timeoutMs: 30000 });
      var info = conn.handshakeInfo || {};
      state.connected = true;
      state.handshake = {
        protocolVersion: info.protocolVersion,
        hostVersion: info.hostVersion,
        contextId: info.contextId,
        epoch: info.epoch,
      };
      state.acceptedFeatures = info.acceptedFeatures || [];
      setText('sdk-meta', 'v' + (state.sdkVersion || '?') + ' · host ' + (info.hostVersion || '?') + ' · protocol v' + (info.protocolVersion || '?'));
      setText('handshake', 'accepted=[' + state.acceptedFeatures.join(', ') + '] · contextId=' + info.contextId + ' · epoch=' + info.epoch);
      setStatus('协议线已连接（握手完成）');
      heartbeatTimer = setInterval(function () {
        try {
          conn.heartbeat();
        } catch (e) {
          /* 连接关闭后的兜底 */
        }
        state.heartbeatCount += 1;
        setText('heartbeat', String(state.heartbeatCount));
        if (state.heartbeatCount % 5 === 0) report(); // 约 1s 一次镜像（避免刷屏）
      }, HEARTBEAT_MS);
      report();
    } catch (e) {
      state.phase = 'error';
      state.connected = false;
      showError(e);
      setStatus('握手失败（' + (e && e.code ? e.code : 'ERROR') + '）');
    }
  }

  $('btn-load').addEventListener('click', function () {
    void loadSnapshot($('rel-path').value, 'manual');
  });
  $('btn-print').addEventListener('click', function () {
    void printSnapshot();
  });
  $('rel-path').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') void loadSnapshot($('rel-path').value, 'manual');
  });

  report();
  void main();
})();
