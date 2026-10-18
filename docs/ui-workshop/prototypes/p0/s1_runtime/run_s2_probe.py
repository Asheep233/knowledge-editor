# -*- coding: utf-8 -*-
"""P0-S2 实机探针：真实 WebView2 内验证「换 shell 不重建 EditorView/history」。

流程：启动原型 app（S1_SCENARIO=s2, S1_OPEN_S2=1）→ Rust setup 打开 s2-shell 窗口加载 s2.html
（esbuild 打包的 Tiptap harness）→ harness 创建 editor、两个 shell、移动 view.dom、验证身份/undo/
focus/组合输入/源码草稿 → 通过 Tauri 命令 report_results 写 results.json → runner 断言并落证据。
运行（Windows Python）：python run_s2_probe.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-s2-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:240], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    EVID.mkdir(parents=True, exist_ok=True)
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-s2"
    probe.mkdir(parents=True)
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe),
        "S1_SCENARIO": "s2",
        "S1_OPEN_S2": "1",
    })
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 120
    while time.time() < end:
        f = probe / "results.json"
        if f.exists():
            try:
                results = json.loads(f.read_text(encoding="utf-8"))
                break
            except Exception:
                pass
        if p.poll() is not None and not f.exists():
            break
        time.sleep(0.3)
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    events = (probe / "events.log").read_text(encoding="utf-8") if (probe / "events.log").exists() else ""
    r = results or {}
    print("s2 results:", json.dumps(r, ensure_ascii=False)[:900])
    print("events:", [line for line in events.splitlines() if "s2" in line or "guest-" in line][:5], flush=True)
    check("S2-1 Rust setup 打开 s2-shell 窗口", r.get("phase") == "s2-done" and "s2-shell opened" in events, r.get("phase", r.get("error")))
    check("S2-2 editor 创建且初始文档正确", bool(r.get("editorCreated")) and "初始内容" in str(r.get("initialDoc")), r.get("initialDoc"))
    check("S2-3 换壳后 view/dom 身份不变（未重建）",
          r.get("viewIdentitySameAfterSwap") is True and r.get("viewIdentitySameAfterSecondSwap") is True,
          f"swap={r.get('viewIdentitySameAfterSwap')} back={r.get('viewIdentitySameAfterSecondSwap')}")
    check("S2-4 换壳后正文内容保持", r.get("docAfterSwap") == r.get("docAfterEdits"), f"{r.get('docAfterEdits')!r} -> {r.get('docAfterSwap')!r}")
    check("S2-5 换壳后 undo 继续可用（history 未重建）",
          r.get("undoWorkedAfterSwap") is True and r.get("redoWorkedAfterSwap") is True,
          f"undo={r.get('undoWorkedAfterSwap')} redo={r.get('redoWorkedAfterSwap')}")
    check("S2-6 旧 shell 的 editor-host 已空（DOM 被移动而非复制）",
          r.get("shellAAfterSwapEditorHostChildren") == 0, r.get("shellAAfterSwapEditorHostChildren"))
    check("S2-7 换壳后焦点/输入可用", r.get("focusInputWorked") is True, r.get("focusInputWorked"))
    check("S2-8 组合输入事件（synthetic IME）不丢内容", r.get("compositionSyntheticHandled") is True, r.get("compositionSyntheticHandled"))
    check("S2-9 源码草稿跨换壳保持", r.get("sourceDraftPreserved") is True or r.get("sourceDraftPreservedAfterSecondSwap") is True,
          f"first={r.get('sourceDraftPreserved')} second={r.get('sourceDraftPreservedAfterSecondSwap')}")
    check("S2-10 结果来自真实 WebView2（UA 记录）", "Edg/" in str(r.get("userAgent", "")), str(r.get("userAgent"))[:80])
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
    }
    out = EVID / "P0-S2-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
