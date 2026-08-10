/// <reference types="vite/client" />

interface Window {
  /** 桌面版运行时注入的后端 API 基址（如 http://127.0.0.1:8000）；Web 开发/测试未注入时为空。 */
  __KE_API_BASE__?: string
}
