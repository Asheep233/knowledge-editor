/**
 * 参考包 B · Dock 写作表单（写场景）—— 使用发布 SDK `sdk/dist/guest-sdk.js`（全局 `KeWorkshopSDK`）。
 *
 * 覆盖能力（manifest 声明，最小集）：
 * - `ui.shell`      协议线 + `command.invoke` 命令桥（Broker 要求 ui.shell）；
 * - `panel.dock`    Dock 面板定位（声明式）；
 * - `context.read`  `context.snapshot` 读正文（G1），从中解析 frontmatter title/tags。
 * 写操作**不**声明 `context.write`：走 manifest 声明式命令 `article.set-title` / `article.set-tags`
 * （宿主白名单 → 后端原子写 meta，W02 语义），演示最小能力集下的元信息写入。
 *
 * 行为：
 * 1. `KeWorkshopSDK.autoConnect` 握手；200ms 心跳；
 * 2. 「读取快照」展示正文并自动填充 title/tags 表单（从 frontmatter 解析）；
 * 3. 「提交标题」/「提交标签」经 `command.invoke` 提交，展示宿主返回或错误码（不静默）；
 * 4. 监听 HostEvent（wire `{type:'event', event}`，SDK 0.1.0 无事件 API，见 README 已知限制）；
 * 5. 状态镜像：`postMessage({type:'t19-guest-results', payload:<state>})` 供宿主/探针观察。
 */
(function () {
  'use strict';

  var PACK_ID = 'com.astranota.examples.pack-b';
  var FEATURES = ['ui.shell', 'panel.dock', 'context.read', 'editor.commands.readonly'];
  // T26 F03：受控编辑器命令桥（editor.*，小写；须与 manifest.commands 逐条声明一致）。
  // 注意：bulletList / orderedList / codeBlock 因 manifest 命令名校验仅允许 [a-z0-9.-]，
  // 无法逐字声明 camelCase 协议名 → 本包**不声明**这 3 条（调用会被宿主 E_FORBIDDEN 拒绝）。
  var EDITOR_COMMANDS = [
    'editor.bold', 'editor.italic', 'editor.underline', 'editor.strike', 'editor.code',
    'editor.heading1', 'editor.heading2', 'editor.heading3', 'editor.blockquote',
    'editor.undo', 'editor.redo'
  ];
  var COMMANDS = ['article.set-title', 'article.set-tags'].concat(EDITOR_COMMANDS);
  var HEARTBEAT_MS = 200;
  var SDK = window.KeWorkshopSDK;

  var conn = null;
  var state = {
    phase: 'booting',
    packId: PACK_ID,
    sdkVersion: SDK && SDK.SDK_VERSION ? SDK.SDK_VERSION : null,
    connected: false,
    requestedFeatures: FEATURES.slice(),
    declaredCommands: COMMANDS.slice(),
    acceptedFeatures: [],
    handshake: null,
    heartbeatCount: 0,
    snapshot: null,
    form: { title: '', tags: '' },
    commandResults: [],
    lastEvent: null,
    lastError: null,
    statusText: '启动中…',
  };
  var heartbeatTimer = null;

  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text == null ? '—' : String(text);
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

  function report() {
    try {
      window.parent.postMessage(
        {
          type: 't19-guest-results',
          payload: {
            phase: 'pack-b-state',
            packId: state.packId,
            sdkVersion: state.sdkVersion,
            connected: state.connected,
            requestedFeatures: state.requestedFeatures,
            declaredCommands: state.declaredCommands,
            acceptedFeatures: state.acceptedFeatures,
            handshake: state.handshake,
            heartbeatCount: state.heartbeatCount,
            snapshot: state.snapshot,
            form: state.form,
            commandResults: state.commandResults,
            lastEvent: state.lastEvent,
            lastError: state.lastError,
            statusText: state.statusText,
            rendered: {
              status: $('status') ? $('status').textContent : null,
              title: $('doc-title') ? $('doc-title').textContent : null,
              meta: $('doc-meta') ? $('doc-meta').textContent : null,
              content: $('doc-content') ? $('doc-content').textContent : null,
              commandResult: $('command-result') ? $('command-result').textContent : null,
              lastEvent: $('last-event') ? $('last-event').textContent : null,
              errorText: $('error-box') && !$('error-box').hidden && $('error-text') ? $('error-text').textContent : null,
            },
          },
        },
        '*',
      );
    } catch (e) {
      /* 镜像失败不影响主流程 */
    }
  }

  // ---------------- frontmatter 解析（demo 级：title 单行 / tags 行内或 YAML 列表） ----------------

  function splitFrontmatter(content) {
    var text = String(content == null ? '' : content).replace(/^\uFEFF/, '');
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { frontmatter: '', body: text };
    return { frontmatter: m[1], body: text.slice(m[0].length) };
  }

  function parseMeta(content) {
    var fm = splitFrontmatter(content).frontmatter;
    var title = '';
    var tags = [];
    var mt = /(^|\n)title:\s*(.+?)\s*(\r?\n|$)/.exec(fm);
    if (mt && mt[2]) title = mt[2].replace(/^["']|["']$/g, '');
    var inline = /(^|\n)tags:\s*\[(.*?)\]/.exec(fm);
    if (inline) {
      tags = inline[2]
        .split(',')
        .map(function (t) {
          return t.trim().replace(/^["']|["']$/g, '');
        })
        .filter(Boolean);
    } else {
      var block = /(^|\n)tags:\s*(\r?\n((\s*-\s*.+?\s*)(\r?\n|$))+)/.exec(fm);
      if (block) {
        tags = block[0]
          .split(/\r?\n/)
          .map(function (line) {
            var m = /^\s*-\s*(.+?)\s*$/.exec(line);
            return m ? m[1].replace(/^["']|["']$/g, '') : '';
          })
          .filter(Boolean);
      } else {
        var csv = /(^|\n)tags:\s*(.+?)\s*(\r?\n|$)/.exec(fm);
        if (csv && csv[2] && csv[2].trim().indexOf('[') !== 0) {
          tags = csv[2]
            .split(',')
            .map(function (t) {
              return t.trim().replace(/^["']|["']$/g, '');
            })
            .filter(Boolean);
        }
      }
    }
    return { title: title, tags: tags };
  }

  function fillForm(meta) {
    if (meta.title) $('title-input').value = meta.title;
    $('tags-input').value = meta.tags.join(', ');
    state.form = { title: $('title-input').value, tags: $('tags-input').value };
    report();
  }

  function relPathOrError() {
    var relPath = $('rel-path').value.trim() || (state.snapshot && state.snapshot.relPath);
    if (!relPath) showError(new Error('请先填写或读取一个文档路径'));
    return relPath;
  }

  // ---------------- 快照读取 ----------------

  async function loadSnapshot(reason) {
    if (!conn) {
      showError(new Error('未连接：协议线尚未建立'));
      return null;
    }
    var relPath = String($('rel-path').value || '').trim();
    if (!relPath) {
      showError(new Error('请先填写文档路径（如 Articles/example.md）'));
      return null;
    }
    $('btn-load').disabled = true;
    setStatus('读取快照中…（' + reason + '）');
    try {
      var snap = await conn.request('context.snapshot', { relPath: relPath });
      var hasContent = typeof snap.content === 'string';
      var content = hasContent ? snap.content : '';
      var meta = parseMeta(content);
      var body = splitFrontmatter(content).body.trim();
      state.snapshot = {
        relPath: snap.relPath || relPath,
        revision: snap.revision,
        diskHash: snap.diskHash,
        contentBytes: snap.contentBytes == null ? null : snap.contentBytes,
        hasContent: hasContent,
        contentLen: content.length,
        title: meta.title || null,
        tags: meta.tags,
        bodyTail: body.slice(-120),
        reason: reason,
      };
      setText('doc-title', meta.title || '（frontmatter 无 title）');
      setText(
        'doc-meta',
        (state.snapshot.relPath || '') + ' · revision=' + (snap.revision == null ? '?' : snap.revision) + ' · diskHash=' + String(snap.diskHash || '').slice(0, 12) + '…',
      );
      setText('doc-content', hasContent ? body : '（该响应不含 content：缺少 context.read 或读取退化）');
      fillForm(meta);
      clearError();
      setStatus('快照已读取（' + reason + '）');
      return snap;
    } catch (e) {
      showError(e);
      setStatus('读取快照失败');
      return null;
    } finally {
      $('btn-load').disabled = false;
      report();
    }
  }

  // ---------------- command.invoke（声明式命令 → 宿主白名单 → 后端原子写 meta） ----------------

  function renderCommandResult(entry) {
    var text = entry.name + ' → ' + (entry.ok ? 'ok' : '失败') + (entry.ok ? '' : '（' + entry.error + '）');
    setText('command-result', text);
    var li = document.createElement('li');
    li.textContent = new Date(entry.at).toLocaleTimeString() + ' ' + text + (entry.ok ? ' · ' + JSON.stringify(entry.value) : '');
    $('command-list').appendChild(li);
    state.commandResults.push(entry);
    report();
  }

  async function invokeCommand(name, args) {
    if (!conn) {
      showError(new Error('未连接：协议线尚未建立'));
      return null;
    }
    try {
      var result = await conn.request('command.invoke', { name: name, args: args });
      renderCommandResult({ name: name, ok: true, value: result, at: Date.now() });
      clearError();
      state.lastError = null;
      setStatus('命令 ' + name + ' 已由宿主执行');
      return result;
    } catch (e) {
      var code = e && e.code ? String(e.code) : 'ERROR';
      var message = e && e.message ? String(e.message) : String(e);
      renderCommandResult({ name: name, ok: false, error: code + ': ' + message, at: Date.now() });
      showError(e);
      setStatus('命令 ' + name + ' 失败');
      return null;
    }
  }

  // ---------------- 编辑器命令（command.invoke editor.*，真实宿主编辑器命令桥） ----------------

  function renderEditorCommand(name) {
    var last = state.commandResults[state.commandResults.length - 1];
    if (!last) return;
    setText('editor-command-result', last.name + ' → ' + (last.ok ? 'ok' : '失败（' + last.error + '）'));
  }

  function invokeEditorCommand(name) {
    void invokeCommand(name, {}).then(function (r) {
      renderEditorCommand(name);
      return r;
    });
  }

  var EDITOR_BUTTONS = {
    'btn-cmd-bold': 'editor.bold',
    'btn-cmd-italic': 'editor.italic',
    'btn-cmd-underline': 'editor.underline',
    'btn-cmd-strike': 'editor.strike',
    'btn-cmd-code': 'editor.code',
    'btn-cmd-heading1': 'editor.heading1',
    'btn-cmd-heading2': 'editor.heading2',
    'btn-cmd-heading3': 'editor.heading3',
    'btn-cmd-blockquote': 'editor.blockquote',
    'btn-cmd-undo': 'editor.undo',
    'btn-cmd-redo': 'editor.redo'
  };

  // 负向测试 hook（仅参考包演示/自动化用；真实调用仍受宿主 manifest 声明 + 能力 + 白名单三重校验）
  window.__packBInvokeCommand = function (name, args) {
    return invokeCommand(name, args || {});
  };
  window.__packBEditorCommands = EDITOR_COMMANDS.slice();
  window.__packBState = state;

  function submitTitle() {
    var relPath = relPathOrError();
    if (!relPath) return;
    var title = $('title-input').value.trim();
    state.form = { title: $('title-input').value, tags: $('tags-input').value };
    void invokeCommand('article.set-title', { relPath: relPath, title: title });
  }

  function submitTags() {
    var relPath = relPathOrError();
    if (!relPath) return;
    var tags = $('tags-input')
      .value.split(',')
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
    state.form = { title: $('title-input').value, tags: $('tags-input').value };
    void invokeCommand('article.set-tags', { relPath: relPath, tags: tags });
  }

  // ---------------- HostEvent（SDK 0.1.0 无事件 API → wire 直接监听） ----------------

  function handleHostEvent(event) {
    if (!event || typeof event !== 'object') return;
    state.lastEvent = { type: event.type, relPath: event.relPath, revision: event.revision, receivedAt: Date.now() };
    setText(
      'last-event',
      event.type === 'document-saved'
        ? 'document-saved · ' + event.relPath + ' · revision=' + event.revision
        : String(event.type) + ' · ' + JSON.stringify(event),
    );
    report();
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 't19-wire' || d.direction !== 'host-to-guest') return;
    var msg = d.msg;
    if (msg && msg.type === 'event') handleHostEvent(msg.event);
  });

  // ---------------- 启动 ----------------

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
        if (state.heartbeatCount % 5 === 0) report();
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
    void loadSnapshot('manual');
  });
  Object.keys(EDITOR_BUTTONS).forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('click', function () {
      invokeEditorCommand(EDITOR_BUTTONS[id]);
    });
  });
  $('btn-submit-title').addEventListener('click', submitTitle);
  $('btn-submit-tags').addEventListener('click', submitTags);
  $('rel-path').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') void loadSnapshot('manual');
  });
  $('title-input').addEventListener('input', function () {
    state.form = { title: $('title-input').value, tags: $('tags-input').value };
  });
  $('tags-input').addEventListener('input', function () {
    state.form = { title: $('title-input').value, tags: $('tags-input').value };
  });

  report();
  void main();
})();
