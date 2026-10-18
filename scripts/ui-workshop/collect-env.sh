#!/usr/bin/env bash
# T00：环境快照（写入 docs/ui-workshop/evidence/env-*.txt，供报告引用）。
set -u
OUT="${1:-docs/ui-workshop/evidence/env-$(date +%Y%m%d-%H%M%S).txt}"
{
  echo "# UI 工坊环境快照 $(date '+%F %T %Z')"
  echo
  echo "OS: $(uname -a)"
  echo "Node: $(node --version 2>/dev/null || echo missing)"
  echo "npm: $(npm --version 2>/dev/null || echo missing)"
  echo "Python: $(python3 --version 2>/dev/null || echo missing)"
  echo "Rust: $(cat desktop/src-tauri/rust-toolchain.toml 2>/dev/null | head -3)"
  echo "cargo(windows): $(/mnt/f/Work/Dev/cargo/bin/cargo.exe --version 2>/dev/null || echo missing)"
  echo "git HEAD: $(git rev-parse HEAD 2>/dev/null)"
  echo "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo
  echo "## Windows 侧（可选）"
  powershell.exe -NoProfile -Command "(Get-OSVersion).Caption 2>\$null; 'WebView2: ' + (((Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv) ?? 'unknown')" 2>/dev/null | tr -d '\r'
} | tee "$OUT"
echo; echo "written: $OUT"
