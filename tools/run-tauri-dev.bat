@echo off
set CARGO_TERM_COLOR=never
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*
cd /d "D:\KE Project\knowledge-editor\desktop"
npm run dev 1> "D:\KE Project\tauri-dev.log" 2>&1
