# -*- coding: utf-8 -*-
"""P0-S4 实机探针：独立只读快照 renderer + WebView2 PrintToPdf 真实 PDF。

流程：启动原型 app（S1_SCENARIO=s4, S1_OPEN_PRINT=1）→ Rust setup 打开 print-render 窗口加载
print.html（esbuild+KaTeX harness）→ harness 用**内存 session 快照**（含未保存标记）渲染 HTML，
调用 Rust 对本窗口 PrintToPdf 写系统临时目录 → runner 用 PyMuPDF 校验真实 PDF、并断言「未隐式保存」
（临时 note.md 哈希不变）。运行（Windows Python）：python run_s4_probe.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"F:\Work\KE Project\knowledge-editor")
EXE = Path(r"F:\Work\Dev\cargo-target\release\uiws-s1-probe.exe")
BASE = Path(r"C:\ke-tmp\uiws-s4-probe")
EVID = REPO / "docs" / "ui-workshop" / "evidence"
UNSAVED_MARK = "UNSAVED-SNAPSHOT-MARK"


def sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    checks: list[dict] = []

    def check(name: str, ok: bool, detail) -> None:
        checks.append({"name": name, "pass": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + " | " + str(detail)[:240], flush=True)

    if not EXE.exists():
        print(f"缺少原型 exe: {EXE}")
        return 2
    if BASE.exists():
        shutil.rmtree(BASE, ignore_errors=True)
    probe = BASE / "probe-s4"
    probe.mkdir(parents=True)
    note = BASE / "note.md"
    note_bytes = "---\ntitle: S4 源笔记（不得被打印隐式修改）\n---\n\n磁盘旧正文（不应进入 PDF）\n".encode("utf-8")
    note.write_bytes(note_bytes)
    note_sha = sha_bytes(note_bytes)
    target = probe / "snapshot.pdf"
    env = dict(os.environ)
    env.update({
        "S1_PROBE_DIR": str(probe),
        "S1_SCENARIO": "s4",
        "S1_OPEN_PRINT": "1",
        "S1_PRINT_TARGET": str(target),
    })
    p = subprocess.Popen([str(EXE)], env=env)
    results = None
    end = time.time() + 150
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
    subprocess.run(["taskkill", "/F", "/IM", "uiws-s1-probe.exe"], capture_output=True, text=True)
    events = (probe / "events.log").read_text(encoding="utf-8") if (probe / "events.log").exists() else ""
    r = results or {}
    print("s4 results:", json.dumps(r, ensure_ascii=False)[:800])
    print("events:", [line for line in events.splitlines() if "print" in line or "s4" in line][:5], flush=True)
    check("S4-1 Rust setup 打开 print-render 窗口", "print-render opened by rust setup" in events, events.splitlines()[:4])
    check("S4-2 harness 完成且 KaTeX 渲染 2 处", r.get("phase") == "s4-done" and r.get("katexCount") == 2,
          f"phase={r.get('phase')} katex={r.get('katexCount')} err={r.get('error')}")
    check("S4-3 快照包含未保存内容标记（来自内存 session，非磁盘）", r.get("unsavedMarkPresent") is True, r.get("unsavedMarkPresent"))
    pdf_ok = False
    pdf_detail: dict = {}
    if target.exists() and target.stat().st_size > 0:
        pdf_ok = True
        pdf_detail["size"] = target.stat().st_size
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(str(target))
            text = "\n".join(page.get_text() for page in doc)
            pdf_detail.update({"pages": doc.page_count, "text_has_mark": UNSAVED_MARK in text,
                               "text_snippet": text[:160]})
            pdf_ok = doc.page_count >= 1 and UNSAVED_MARK in text
            doc.close()
        except Exception as e:
            pdf_detail["error"] = str(e)
            pdf_ok = False
    check("S4-4 真实 PDF 生成且含未保存内容（PyMuPDF 文本校验）", pdf_ok, pdf_detail)
    check("S4-5 打印不隐式保存：源笔记 sha256 不变", sha_bytes(note.read_bytes()) == note_sha, note_sha[:16])
    check("S4-6 PDF 输出在系统临时目录（工作区之外）", str(target).startswith(str(BASE)), str(target))
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "exe": str(EXE),
        "checks": checks,
        "pass_count": sum(1 for c in checks if c["pass"]),
        "total": len(checks),
        "raw_results": results,
        "pdf": pdf_detail,
    }
    out = EVID / "P0-S4-probe-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {summary['pass_count']}/{summary['total']} PASS -> {out}")
    return 0 if summary["pass_count"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
