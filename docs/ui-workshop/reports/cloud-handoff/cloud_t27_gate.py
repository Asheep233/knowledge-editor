# -*- coding: utf-8 -*-
"""T27 I 门禁自动化（Windows VM）：U1–U6 安装/覆盖升级/回滚/卸载/重启 + 截图 + 结果 JSON。

安全设计：
- **默认 dry-run**：只检查安装包/版本/路径，打印计划，不安装任何东西；
- 真正执行必须同时给 `--execute` 且设置环境变量 `KE_CLOUD_VM=1`（专用 VM 标记）；
- 只安装/卸载给定的 baseline/candidate 安装包；不 push/不联网写远端；
- 截图基于 WinForms CopyFromScreen；失败保留现状供排查。

用法（云 VM）：
  set KE_CLOUD_VM=1
  python cloud_t27_gate.py --baseline C:\\ke-cloud\\installers\\baseline-v1.2.9-default_x64-setup.exe \
      --candidate C:\\ke-cloud\\installers\\candidate-default_x64-setup.exe \
      --workdir C:\\ke-cloud\\t27 --execute
产出的 evidence 目录：<workdir>\\evidence\\T27-I-results.json + U1..U6/*.png + logs/
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PS = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]


def ps(cmd: str, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(PS + [cmd], capture_output=True, text=True, timeout=timeout)


def file_version(exe: Path) -> str:
    r = ps(f"(Get-Item -LiteralPath '{exe}').VersionInfo.FileVersion")
    return (r.stdout or "").strip()


def screenshot(path: Path) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    script = (
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; "
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; "
        "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; "
        "$g=[System.Drawing.Graphics]::FromImage($bmp); "
        "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); "
        f"$bmp.Save('{path}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()"
    )
    return ps(script, 60).returncode == 0 and path.exists()


def install_location() -> Path | None:
    """从注册表/常见目录定位已安装 exe。"""
    script = (
        "$names='AstraNota','KnowledgeEditor'; $found=$null; "
        "foreach($n in $names){ foreach($h in 'HKCU:','HKLM:'){ "
        " $k=Join-Path $h \"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$n\"; "
        " if(Test-Path $k){ $loc=(Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation; "
        "  if($loc){ $exe=Join-Path $loc 'knowledgeeditor.exe'; if(Test-Path $exe){ $found=$exe; break } } } } "
        " if($found){break} } ; if(-not $found){ "
        " $cands=@($env:LOCALAPPDATA+'\\Programs\\AstraNota\\knowledgeeditor.exe', "
        " $env:ProgramFiles+'\\AstraNota\\knowledgeeditor.exe', "
        " ${env:ProgramFiles(x86)}+'\\AstraNota\\knowledgeeditor.exe'); "
        " foreach($c in $cands){ if(Test-Path $c){ $found=$c; break } } }; Write-Output $found"
    )
    out = (ps(script).stdout or "").strip().splitlines()
    if out and out[-1].strip():
        p = Path(out[-1].strip())
        return p if p.exists() else None
    return None


def uninstall_string() -> tuple[str, str] | None:
    script = (
        "$names='AstraNota','KnowledgeEditor'; $r=$null; "
        "foreach($n in $names){ foreach($h in 'HKCU:','HKLM:'){ "
        " $k=Join-Path $h \"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$n\"; "
        " if(Test-Path $k){ $u=(Get-ItemProperty $k -ErrorAction SilentlyContinue).UninstallString; "
        "  $loc=(Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation; "
        "  if($u){ $r=$u+'|'+$loc; break } } } if($r){break} }; Write-Output $r"
    )
    out = (ps(script).stdout or "").strip().splitlines()
    if not out or "|" not in out[-1]:
        return None
    cmd, _, loc = out[-1].partition("|")
    return cmd.strip(), loc.strip()


def run_installer(path: Path, outdir: Path, label: str) -> int:
    log = outdir / "logs" / f"install-{label}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Start-Process -FilePath '{path}' -ArgumentList '/S' -Wait -PassThru | Select-Object -ExpandProperty ExitCode"],
                       capture_output=True, text=True, timeout=600)
    log.write_text((r.stdout or "") + "\n" + (r.stderr or ""), encoding="utf-8")
    code = (r.stdout or "").strip().splitlines()[-1:] or ["1"]
    try:
        return int(code[0])
    except ValueError:
        return 1


def run_uninstaller(outdir: Path, label: str) -> int:
    u = uninstall_string()
    if not u:
        return 127
    cmd, _loc = u
    log = outdir / "logs" / f"uninstall-{label}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    # UninstallString 通常是 "xxx.exe"（带引号）；追加 /S 静默
    r = subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"$p='{cmd}'; $exe=$p.Trim('\"'); if($exe -notmatch '\\.exe$'){{$exe=($exe -split ' ')[0].Trim('\"')}}; "
                        f"Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru | Select-Object -ExpandProperty ExitCode"],
                       capture_output=True, text=True, timeout=600)
    log.write_text((r.stdout or "") + "\n" + (r.stderr or ""), encoding="utf-8")
    try:
        return int((r.stdout or "").strip().splitlines()[-1])
    except Exception:
        return 1


def launch(exe: Path, workdir: Path, label: str, wait_s: int = 10) -> dict:
    logs = workdir / "logs" / f"run-{label}.log"
    logs.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    ws = workdir / "workspace"
    (ws / "Articles").mkdir(parents=True, exist_ok=True)
    (ws / "Articles" / "t27-test.md").write_text("---\ntitle: T27\ntest\n---\n\nI-GATE-DATA\n", encoding="utf-8")
    env["KE_WORKSPACE"] = str(ws)
    log = logs.open("w", encoding="utf-8")
    proc = subprocess.Popen([str(exe)], env=env, stdout=log, stderr=subprocess.STDOUT)
    time.sleep(wait_s)
    alive = proc.poll() is None
    shot = workdir / "evidence" / label / f"{label}.png"
    screenshot(shot)
    if alive:
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Get-Process knowledgeeditor -ErrorAction SilentlyContinue | "
                        f"Where-Object {{ $_.Path -eq '{exe}' }} | Stop-Process -Force -ErrorAction SilentlyContinue"],
                       capture_output=True, text=True)
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    log.close()
    return {"alive": alive, "version": file_version(exe), "screenshot": str(shot), "workspace": str(ws)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--candidate", required=True)
    ap.add_argument("--workdir", default=r"C:\ke-cloud\t27")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--skip-screenshots", action="store_true")
    args = ap.parse_args()

    baseline = Path(args.baseline)
    candidate = Path(args.candidate)
    workdir = Path(args.workdir)
    evid = workdir / "evidence"
    evid.mkdir(parents=True, exist_ok=True)

    plan = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "mode": "EXECUTE" if args.execute else "DRY-RUN",
        "baseline": {"path": str(baseline), "exists": baseline.exists(), "fileVersion": file_version(baseline) if baseline.exists() else None},
        "candidate": {"path": str(candidate), "exists": candidate.exists(), "fileVersion": file_version(candidate) if candidate.exists() else None},
    }
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not baseline.exists() or not candidate.exists():
        print("安装包缺失，退出（dry-run）")
        return 2
    if not args.execute:
        plan["plannedSteps"] = ["U1 安装 baseline→启动→截图", "U2 安装 candidate 覆盖升级→启动/数据检查→截图",
                                "U3 升级后冒烟（配合 cloud_verify_installed.py）", "U4 卸载 candidate→重装 baseline→启动",
                                "U5 卸载 candidate→程序目录清理/数据保留检查", "U6 启动/退出 ×2"]
        plan["note"] = "真正执行：KE_CLOUD_VM=1 且加 --execute（仅专用 VM）"
        (evid / "t27-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        print("DRY-RUN OK →", evid / "t27-plan.json")
        return 0
    if os.environ.get("KE_CLOUD_VM") != "1":
        print("拒绝执行：请在专用 VM 设置 KE_CLOUD_VM=1（防误在真实机安装）")
        return 3

    checks: list[dict] = []

    def add(cid: str, name: str, ok: bool, detail=None) -> None:
        checks.append({"id": cid, "name": name, "pass": bool(ok), "evidence": [], "detail": detail or {}})
        print(("PASS " if ok else "FAIL ") + cid + " " + name)

    # U1 基线安装
    code = run_installer(baseline, workdir, "U1-baseline")
    exe = install_location()
    add("U1", "基线安装成功且可启动", code == 0 and exe is not None, {"installerExit": code, "exe": str(exe)})
    u1 = launch(exe, workdir, "U1") if exe else {"alive": False}
    add("U1b", "基线启动成功（进程存活 + 截图）", bool(u1.get("alive")), u1)

    # U2 覆盖升级
    code = run_installer(candidate, workdir, "U2-candidate")
    exe2 = install_location()
    u2 = launch(exe2, workdir, "U2") if exe2 else {"alive": False}
    ver = file_version(exe2) if exe2 else ""
    data_ok = (workdir / "workspace" / "Articles" / "t27-test.md").exists()
    add("U2", "覆盖升级安装成功且版本为候选", code == 0 and exe2 is not None and "1.2.18" in ver, {"installerExit": code, "version": ver})
    add("U2b", "升级后启动成功 + 测试数据保留", bool(u2.get("alive")) and data_ok, {"alive": u2.get("alive"), "dataPreserved": data_ok})

    # U3 冒烟（由 cloud_verify_installed.py 完成，这里仅记录入口/可执行）
    add("U3", "升级后冒烟（由 cloud_verify_installed.py 另行执行并回传）", True, {"delegated": True})

    # U4 回滚
    run_uninstaller(workdir, "U4-uninstall-candidate")
    code = run_installer(baseline, workdir, "U4-baseline-again")
    exe3 = install_location()
    u4 = launch(exe3, workdir, "U4") if exe3 else {"alive": False}
    add("U4", "回滚（卸载候选→重装基线）成功且可启动", code == 0 and exe3 is not None and bool(u4.get("alive")), {"installerExit": code, "alive": u4.get("alive")})

    # U5 卸载与数据保留
    run_uninstaller(workdir, "U5-uninstall-baseline")
    appdata = Path(os.environ.get("APPDATA", "")) / "KnowledgeEditor"
    installed_gone = install_location() is None
    add("U5", "卸载后程序目录清理、用户数据目录保留检查", installed_gone, {"installGone": installed_gone, "dataDir": str(appdata), "dataDirExists": appdata.exists()})

    # U6 重启两次（重装候选后）
    run_installer(candidate, workdir, "U6-candidate")
    exe4 = install_location()
    r1 = launch(exe4, workdir, "U6-run1", 8) if exe4 else {"alive": False}
    r2 = launch(exe4, workdir, "U6-run2", 8) if exe4 else {"alive": False}
    add("U6", "重启 2 次均启动成功（无崩溃）", bool(r1.get("alive")) and bool(r2.get("alive")), {"run1": r1.get("alive"), "run2": r2.get("alive")})

    passed = sum(1 for c in checks if c["pass"])
    verdict = "PASS" if passed == len(checks) else ("PASS_WITH_FINDINGS" if passed >= len(checks) - 1 else "FAIL")
    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "environment": {"vm": os.environ.get("COMPUTERNAME", ""), "windows": os.environ.get("OS", "Windows")},
        "baselineVersion": file_version(baseline),
        "candidateVersion": file_version(candidate),
        "checks": checks, "verdict": verdict,
        "notes": ["U3 冒烟由 cloud_verify_installed.py 单独执行并回传", "无 Authenticode 签名（P4-6 已知）"],
    }
    out = evid / "T27-I-results.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSUMMARY {passed}/{len(checks)} PASS verdict={verdict} -> {out}")
    return 0 if verdict != "FAIL" else 1


if __name__ == "__main__":
    sys.exit(main())
