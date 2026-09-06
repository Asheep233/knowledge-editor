@echo off
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*
start "" /b "D:\KE Project\knowledge-editor\desktop\src-tauri\target\debug\knowledgeeditor.exe"
