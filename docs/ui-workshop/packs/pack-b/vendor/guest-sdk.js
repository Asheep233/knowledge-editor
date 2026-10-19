var KeWorkshopSDK = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    SDK_VERSION: () => SDK_VERSION,
    SdkError: () => SdkError,
    autoConnect: () => autoConnect,
    connectGuest: () => connectGuest
  });
  var SdkError = class extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
      super(message);
      this.name = "SdkError";
      this.code = code;
      this.retryable = retryable;
    }
  };
  function defaultPort() {
    return {
      postMessage: (msg) => window.parent.postMessage({ type: "t19-wire", direction: "guest-to-host", msg }, "*"),
      onMessage: (cb) => {
        const handler = (e) => {
          const d = e.data;
          if (d?.type === "t19-wire" && d.direction === "host-to-guest") cb(d.msg);
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
      }
    };
  }
  var seq = 0;
  function connectGuest(options) {
    const timeoutMs = options.timeoutMs ?? 5e3;
    const port = options.port ?? defaultPort();
    const pending = /* @__PURE__ */ new Map();
    const unsubscribe = port.onMessage((raw) => {
      const msg = raw;
      if (msg?.type === "handshake.response") {
        const p = pending.get("__handshake");
        if (!p) return;
        pending.delete("__handshake");
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg);
        else p.reject(new SdkError(msg.error?.code ?? "E_HANDSHAKE", msg.error?.message ?? "\u63E1\u624B\u88AB\u62D2\u7EDD"));
        return;
      }
      if (msg?.type === "response" && msg.requestId) {
        const p = pending.get(msg.requestId);
        if (!p) return;
        pending.delete(msg.requestId);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new SdkError(msg.error?.code ?? "E_PROTOCOL", msg.error?.message ?? "\u8BF7\u6C42\u5931\u8D25", msg.error?.retryable));
      }
    });
    const handshakeRef = { info: null };
    const connection = {
      get handshakeInfo() {
        return handshakeRef.info;
      },
      async handshake() {
        const msg = { protocolVersion: 1, sdkVersion: options.sdkVersion ?? "sdk-0.1.0", requestedFeatures: options.requestedFeatures };
        const res = await rawRequest("handshake", msg);
        if (!res?.ok) throw new SdkError(res?.error?.code ?? "E_HANDSHAKE", res?.error?.message ?? "\u63E1\u624B\u88AB\u62D2\u7EDD");
        const info = {
          ok: true,
          protocolVersion: res.protocolVersion ?? 1,
          hostVersion: res.hostVersion ?? "unknown",
          acceptedFeatures: res.acceptedFeatures ?? [],
          contextId: res.contextId ?? "",
          epoch: res.epoch ?? 0
        };
        handshakeRef.info = info;
        return info;
      },
      request: (method, params = {}) => rawRequest(method, params),
      heartbeat: () => window.parent.postMessage({ type: "t19-heartbeat" }, "*"),
      close(reason = "guest-closed") {
        unsubscribe();
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new SdkError("E_CLOSED", reason));
        }
        pending.clear();
      }
    };
    function rawRequest(kind, payload) {
      const requestId = `sdk-${++seq}`;
      const pendingKey = kind === "handshake" ? "__handshake" : requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(pendingKey);
          reject(new SdkError("E_TIMEOUT", `\u8BF7\u6C42\u8D85\u65F6: ${kind}`, true));
        }, timeoutMs);
        pending.set(pendingKey, { resolve, reject, timer });
        if (kind === "handshake") port.postMessage({ type: "handshake", ...payload });
        else port.postMessage({ type: "request", requestId, method: kind, params: payload });
      });
    }
    return connection;
  }
  function autoConnect(options) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SdkError("E_TIMEOUT", "\u7B49\u5F85\u5BBF\u4E3B t19-port \u8D85\u65F6")), options.timeoutMs ?? 1e4);
      const onMessage = (e) => {
        const d = e.data;
        if (d?.type !== "t19-port") return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        const conn = connectGuest(options);
        conn.handshake().then(() => resolve(conn)).catch(reject);
      };
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ type: "t19-guest-alive" }, "*");
    });
  }
  var SDK_VERSION = "0.1.0";
  return __toCommonJS(index_exports);
})();
