# -*- coding: utf-8 -*-
"""Conservative T27 evidence collector; Windows execution is UNTESTED.

Dry-run writes a plan/results under ./t27-preflight, never installs anything.
Execution requires Windows, an elevated dedicated VM, KE_CLOUD_VM=1, a matching
--vm-id and --snapshot-id (or KE_CLOUD_SNAPSHOT_ID). Snapshot existence must be
checked by the operator; this script cannot query the VM provider.

U3 editor/save/print/export and U6 single-instance/recovery-log acceptance need
human review. --manual-evidence attaches a JSON object with U3/U6 entries, each
containing reviewer, notes, and evidence (paths relative to workdir/evidence).
Attachments do NOT turn an unverified human check into an automatic PASS.
No unattended PASS is supported. A reviewer must finish the manual runbook.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


PS = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
STAGES = {
    "U1": "基线安装、版本与启动",
    "U2": "候选覆盖升级、版本与数据保留",
    "U3": "升级后编辑/保存/打印导出/默认工坊入口（需手工）",
    "U4": "卸载候选、回装基线与数据保留",
    "U5": "重新升级候选后实际卸载、目录清理与数据保留",
    "U6": "候选重启两次、单实例与恢复日志（需手工）",
}


class ManualPauseRequired(RuntimeError):
    """Leave the candidate installed; an operator can resume this checkpoint."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ps_literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def safe_workdir(value: str) -> Path:
    raw = Path(value).expanduser()
    if platform.system() != "Windows" and re.match(r"^[A-Za-z]:|^\\\\", value):
        raise ValueError("非 Windows 环境拒绝将 Windows 路径当作本地输出目录")
    if any(p.is_symlink() for p in [raw, *raw.parents]):
        raise ValueError("输出路径及其父路径不能是符号链接")
    path = raw.resolve()
    if path in {Path(path.anchor), Path.home().resolve(), Path.cwd().resolve()}:
        raise ValueError("输出必须使用独立子目录，不能是根目录、用户目录或当前目录本身")
    for name in ("WINDIR", "SystemRoot", "ProgramFiles", "ProgramFiles(x86)"):
        if os.environ.get(name):
            protected = Path(os.environ[name]).resolve()
            if path == protected or protected in path.parents:
                raise ValueError("不能向系统/程序安装目录写入证据")
    return path


def execute_blockers(args: argparse.Namespace) -> list[str]:
    blockers = []
    if platform.system() != "Windows":
        blockers.append("需要 Windows 10/11 x64 VM；当前执行路径未实测")
    if os.environ.get("KE_CLOUD_VM") != "1":
        blockers.append("需要专用测试 VM 标记 KE_CLOUD_VM=1")
    machine = os.environ.get("COMPUTERNAME", "")
    if not args.vm_id or not machine or args.vm_id.casefold() != machine.casefold():
        blockers.append("--vm-id 必须与当前 VM 的 COMPUTERNAME 一致")
    if not args.snapshot_id or not args.snapshot_id.strip():
        blockers.append("缺少已创建快照标识 --snapshot-id / KE_CLOUD_SNAPSHOT_ID")
    if platform.system() == "Windows":
        if platform.release() not in ("10", "11"):
            blockers.append("需要 Windows 10/11；不支持其他 Windows 版本")
        architecture = os.environ.get("PROCESSOR_ARCHITEW6432", platform.machine()).casefold()
        if architecture not in ("amd64", "x86_64"):
            blockers.append("需要 Windows x64 VM")
        try:
            if not ctypes.windll.shell32.IsUserAnAdmin():
                blockers.append("需要管理员权限")
        except (AttributeError, OSError):
            blockers.append("无法验证管理员权限")
    if args.skip_screenshots:
        blockers.append("执行验收必须保存截图；不能使用 --skip-screenshots")
    return blockers


def initialize_fixture(workdir: Path) -> dict:
    """Create once; never regenerate a missing/corrupt file on a later launch."""
    manifest_path = workdir / "fixture-manifest.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    workspace = workdir / "workspace"
    data = workdir / "appdata" / "KnowledgeEditor"
    files = {
        workspace / "Articles" / "t27-retention.md": "---\ntitle: T27 retention\n---\n\nI-GATE-DATA\n",
        data / "t27-retention.txt": "T27 isolated appdata retention probe\n",
        data / "settings.json": json.dumps({"schema_version": 1, "startup": {"auto_open_recent_workspace": True}}),
        data / "app_config.json": json.dumps({"recent_workspaces": [str(workspace)], "recent_documents": []}),
    }
    if any(p.exists() for p in files) or workspace.exists() or data.exists():
        raise RuntimeError("隔离数据目录已存在但无 manifest，拒绝覆盖；请使用新的专用 workdir")
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as stream:
            stream.write(content)
    hashes = {str(p.relative_to(workdir)): sha256(p) for p in files}
    manifest = {"createdAt": now(), "initialHashes": hashes,
                "immutableHashes": {k: v for k, v in hashes.items() if k.endswith((".md", ".txt"))}}
    write_json(manifest_path, manifest)
    return manifest


def verify_fixture(workdir: Path, manifest: dict) -> dict:
    records = {}
    for relative, expected in manifest["immutableHashes"].items():
        path = workdir / relative
        actual = sha256(path) if path.is_file() else None
        records[relative] = {"expectedSHA256": expected, "actualSHA256": actual, "pass": actual == expected}
    settings_ok = config_ok = False
    errors = []
    try:
        data = workdir / "appdata" / "KnowledgeEditor"
        settings = json.loads((data / "settings.json").read_text(encoding="utf-8"))
        settings_ok = settings.get("startup", {}).get("auto_open_recent_workspace") is True
        config = json.loads((data / "app_config.json").read_text(encoding="utf-8"))
        config_ok = str(workdir / "workspace") in config.get("recent_workspaces", [])
    except (OSError, ValueError, AttributeError) as exc:
        errors.append(str(exc))
    return {"pass": all(r["pass"] for r in records.values()) and settings_ok and config_ok,
            "hashes": records, "startupSettingPreserved": settings_ok,
            "workspaceSettingPreserved": config_ok, "errors": errors}


def version_matches(actual: str, expected: str) -> bool:
    def normalized(value: str) -> tuple[int, ...] | None:
        if not re.fullmatch(r"\d+(?:\.\d+){1,3}", value.strip()):
            return None
        parts = [int(x) for x in value.strip().split(".")]
        while len(parts) > 2 and parts[-1] == 0:
            parts.pop()
        return tuple(parts)
    return normalized(actual) is not None and normalized(actual) == normalized(expected)


class Gate:
    def __init__(self, args: argparse.Namespace, workdir: Path, summary: dict):
        self.args, self.workdir, self.summary = args, workdir, summary
        self.evidence = workdir / "evidence"
        self.env = dict(os.environ)
        self.env.update({"APPDATA": str(workdir / "appdata"), "KE_WORKSPACE": str(workdir / "workspace")})
        self.manifest: dict = {}
        self.current: dict | None = None

    def save(self) -> None:
        self.summary["generatedAt"] = now()
        write_json(self.evidence / "T27-I-results.json", self.summary)

    def ps(self, command: str, label: str, timeout: int = 300) -> subprocess.CompletedProcess:
        log = self.evidence / "logs" / (label + ".json")
        record = {"startedAt": now(), "command": command}
        self.attach(log)
        try:
            result = subprocess.run(PS + ["$ErrorActionPreference='Stop'; " + command],
                                    env=self.env, capture_output=True, text=True, timeout=timeout)
            record.update(returncode=result.returncode, stdout=result.stdout, stderr=result.stderr)
            if result.returncode:
                raise RuntimeError(f"PowerShell {label} 返回 {result.returncode}")
            return result
        except Exception as exc:
            record["exception"] = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            record["finishedAt"] = now()
            write_json(log, record)

    def attach(self, path: Path) -> None:
        if self.current is not None:
            relative = str(path.relative_to(self.evidence))
            if relative not in self.current["evidence"]:
                self.current["evidence"].append(relative)

    def operation(self, name: str, value: dict) -> dict:
        if self.current is not None:
            self.current["detail"][name] = value
            self.save()
        return value

    def file_version(self, exe: Path, label: str) -> str:
        return self.ps(f"(Get-Item -LiteralPath {ps_literal(exe)}).VersionInfo.FileVersion", label).stdout.strip()

    def install_location(self, label: str) -> Path | None:
        command = (
            "$found=@(); foreach($h in 'HKCU:','HKLM:'){ foreach($n in 'AstraNota','KnowledgeEditor'){"
            "$k=Join-Path $h ('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$n);"
            "if(Test-Path -LiteralPath $k){$p=Get-ItemProperty -LiteralPath $k;"
            "if($p.InstallLocation){$e=Join-Path $p.InstallLocation 'knowledgeeditor.exe';"
            "if(Test-Path -LiteralPath $e){$found+=$e}}}}};"
            "@($found | Select-Object -Unique) | ConvertTo-Json -Compress"
        )
        output = self.ps(command, label).stdout.strip()
        paths = json.loads(output) if output else []
        paths = [paths] if isinstance(paths, str) else paths
        if len(paths) > 1:
            raise RuntimeError("检测到多个安装路径，拒绝猜测目标")
        return Path(paths[0]) if paths else None

    def screenshot(self, label: str) -> Path:
        path = self.evidence / self.current["id"] / (label + ".png")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.attach(path)
        self.ps("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; "
                "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; "
                "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; "
                "$g=[System.Drawing.Graphics]::FromImage($bmp); "
                "try {$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); "
                f"$bmp.Save({ps_literal(path)},[System.Drawing.Imaging.ImageFormat]::Png)"
                "} finally {$g.Dispose();$bmp.Dispose()}", label + "-screenshot", 60)
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError("截图缺失/为空")
        return path

    def install(self, installer: Path, label: str) -> Path:
        result = self.ps(f"$p=Start-Process -FilePath {ps_literal(installer)} -ArgumentList '/S' -Wait -PassThru; "
                         "Write-Output $p.ExitCode", label, 600)
        code = int(result.stdout.strip())
        self.operation(label, {"installer": str(installer), "exitCode": code})
        if code != 0:
            raise RuntimeError(f"安装退出码 {code}；未继续后续操作")
        exe = self.install_location(label + "-locate")
        if exe is None or not exe.is_file():
            raise RuntimeError("安装后未找到唯一注册可执行文件")
        return exe

    def check_version(self, exe: Path, expected: str, label: str) -> None:
        actual = self.file_version(exe, label + "-version")
        self.operation(label + "-version", {"expected": expected, "actual": actual})
        if not version_matches(actual, expected):
            raise RuntimeError(f"安装版本不符：expected={expected}, actual={actual!r}")

    def check_data(self, label: str) -> None:
        result = self.operation(label + "-data", verify_fixture(self.workdir, self.manifest))
        if not result["pass"]:
            raise RuntimeError("隔离测试数据 hash 或设置校验失败；未重建数据")

    def launch(self, exe: Path, label: str) -> dict:
        """Only owns this Popen PID. No image-name/path-wide process killing."""
        log_path = self.evidence / "logs" / (label + "-app.log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self.attach(log_path)
        state = {"exe": str(exe), "alive": False, "gracefulExit": False, "forcedCleanup": False}
        proc = None
        try:
            with log_path.open("w", encoding="utf-8") as log:
                proc = subprocess.Popen([str(exe)], env=self.env, stdout=log, stderr=subprocess.STDOUT)
                state["pid"] = proc.pid
                time.sleep(self.args.launch_wait)
                state["alive"] = proc.poll() is None
                if not state["alive"]:
                    raise RuntimeError("启动进程提前退出；进程存活不能替代 UI 冒烟")
                state["screenshot"] = str(self.screenshot(label).relative_to(self.evidence))
                self.ps(f"$p=Get-Process -Id {proc.pid}; if(-not $p.CloseMainWindow())"
                        "{throw 'No main window accepted CloseMainWindow'}", label + "-close", 30)
                state["exitCode"] = proc.wait(timeout=20)
                state["gracefulExit"] = state["exitCode"] == 0
                if not state["gracefulExit"]:
                    raise RuntimeError("关闭后的进程退出码非零")
                return state
        finally:
            try:
                if proc is not None and proc.poll() is None:
                    state["forcedCleanup"] = True
                    proc.kill()  # Only the PID returned by our own Popen.
                    proc.wait(timeout=10)
            except Exception as exc:
                state["cleanupException"] = f"{type(exc).__name__}: {exc}"
            finally:
                self.operation(label, state)

    def uninstall_candidate(self, exe: Path, label: str) -> None:
        self.check_version(exe, self.args.candidate_version, label + "-precondition")
        raw = self.ps(
            "$u=@(); foreach($h in 'HKCU:','HKLM:'){foreach($n in 'AstraNota','KnowledgeEditor'){"
            "$k=Join-Path $h ('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$n);"
            "if(Test-Path -LiteralPath $k){$p=Get-ItemProperty -LiteralPath $k;"
            f"if($p.InstallLocation -and ((Join-Path $p.InstallLocation 'knowledgeeditor.exe') -eq {ps_literal(exe)}))"
            "{$u+=$p.UninstallString}}}}; @($u | Select-Object -Unique) | ConvertTo-Json -Compress",
            label + "-registry").stdout.strip()
        values = json.loads(raw) if raw else []
        values = [values] if isinstance(values, str) else values
        if len(values) != 1:
            raise RuntimeError("未找到唯一匹配安装目录的卸载命令")
        match = re.fullmatch(r'\s*(?:"([^"]+\.exe)"|([^"\s]+\.exe))\s*', values[0], re.I)
        if not match:
            raise RuntimeError("无法安全解析卸载命令；拒绝执行带未知参数的命令")
        uninstaller = Path(match.group(1) or match.group(2)).resolve()
        if uninstaller.parent != exe.parent.resolve() or not uninstaller.is_file():
            raise RuntimeError("卸载器必须位于本次候选安装目录内")
        tree_before = sorted(str(p.relative_to(exe.parent)) for p in exe.parent.rglob("*"))
        result = self.ps(f"$p=Start-Process -FilePath {ps_literal(uninstaller)} -ArgumentList '/S' -Wait -PassThru; "
                         "Write-Output $p.ExitCode", label, 600)
        code = int(result.stdout.strip())
        tree_after = sorted(str(p.relative_to(exe.parent)) for p in exe.parent.rglob("*")) if exe.parent.exists() else []
        self.operation(label, {"exitCode": code, "candidateExe": str(exe), "uninstaller": str(uninstaller),
                               "treeBefore": tree_before, "treeAfter": tree_after})
        tree_path = self.evidence / self.current["id"] / (label + "-tree.json")
        write_json(tree_path, {"installDirectory": str(exe.parent), "before": tree_before, "after": tree_after})
        self.attach(tree_path)
        if code != 0:
            raise RuntimeError(f"卸载退出码 {code}")
        if exe.exists() or tree_after or self.install_location(label + "-locate") is not None:
            raise RuntimeError("卸载后程序文件/目录内容仍存在；需检查延迟删除而非自动放行")
        self.check_data(label)
        self.screenshot(label + "-after")

    def manual_check(self, cid: str, tasks: list[str], attach: bool = True) -> None:
        self.current["detail"].update(status="needs_manual_review", pendingTasks=tasks,
                                      automaticCoverage="部分；人工材料仅附加，未自动验证内容")
        if attach and self.args.manual_evidence:
            entries = json.loads(Path(self.args.manual_evidence).read_text(encoding="utf-8"))
            entry = entries.get(cid)
            if entry:
                if not entry.get("reviewer") or not entry.get("notes") or not entry.get("evidence"):
                    raise RuntimeError("人工材料需要 reviewer、notes、evidence 非空字段")
                for relative in entry["evidence"]:
                    path = (self.evidence / relative).resolve()
                    if self.evidence.resolve() not in path.parents or not path.is_file() or path.stat().st_size == 0:
                        raise RuntimeError("人工证据必须是 evidence 内已存在的非空文件")
                    self.attach(path)
                self.current["detail"]["manualAttachment"] = entry

    def pause_for_manual(self, exe: Path) -> None:
        instructions = (
            "U3 人工断点：当前仍为升级后的候选版本 " + self.args.candidate_version + "。\n"
            "在另一个 PowerShell 窗口执行以下命令，完成编辑/保存/重开、打印预览/导出、默认工坊入口检查，"
            "将截图与导出文件保存到 evidence/U3；不要修改 retention probe。完成后关闭所有产品窗口。\n"
            f"$env:APPDATA={ps_literal(self.workdir / 'appdata')}\n"
            f"$env:KE_WORKSPACE={ps_literal(self.workdir / 'workspace')}\n"
            f"& {ps_literal(exe)}\n"
            "本断点不会自动认定人工结果为 PASS。非交互执行将在此保留候选安装；"
            "之后在终端使用相同参数加 --resume --execute 继续。"
        )
        self.current["detail"]["manualInstructions"] = instructions
        print(instructions, flush=True)
        self.save()
        if not sys.stdin.isatty():
            raise ManualPauseRequired("等待 U3 人工操作；请在交互终端用 --resume --execute 恢复")
        try:
            answer = input("完成 U3 操作并关闭产品后输入 CONTINUE 继续采集 U4–U6：")
        except (EOFError, KeyboardInterrupt) as exc:
            raise ManualPauseRequired("人工断点未完成，保留当前候选安装") from exc
        if answer.strip() != "CONTINUE":
            raise ManualPauseRequired("人工断点未完成，保留当前候选安装")
        count = self.ps("@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq "
                        + ps_literal(exe) + " }).Count", "U3-manual-process-check").stdout.strip()
        if count != "0":
            raise ManualPauseRequired("手工启动的产品尚未关闭；未继续卸载")
        self.current["detail"]["operatorAcknowledgedAt"] = now()

    def run_stage(self, cid: str, action) -> bool:
        self.current = next(c for c in self.summary["checks"] if c["id"] == cid)
        self.current["detail"].update(status="running", startedAt=now())
        self.save()
        try:
            action()
            manual = self.current["detail"]["status"] == "needs_manual_review"
            self.current["pass"] = not manual
            self.current["detail"]["status"] = "needs_manual_review" if manual else "passed"
            return True
        except ManualPauseRequired as exc:
            self.current["detail"].update(status="needs_manual_review", reason=str(exc))
            self.summary["executionStatus"] = "NEEDS_MANUAL_REVIEW"
            return False
        except Exception as exc:
            self.current["detail"].update(status="failed", exception=f"{type(exc).__name__}: {exc}")
            self.summary["executionStatus"] = "FAILED"
            return False
        finally:
            self.current["detail"]["finishedAt"] = now()
            self.save()
            self.current = None

    def execute(self) -> None:
        locations = {}
        if self.args.resume:
            rows = self.summary["checks"]
            if (not all(c["pass"] for c in rows[:2]) or rows[2]["detail"]["status"] != "needs_manual_review"
                    or any(c["detail"]["status"] != "not_run" for c in rows[3:])):
                raise RuntimeError("--resume 仅支持 U1/U2 通过、U3 人工断点、U4–U6 未执行的记录")
            if not (self.workdir / "fixture-manifest.json").is_file():
                raise RuntimeError("恢复断点缺少原始 fixture manifest，拒绝重新初始化")
            exe = self.install_location("resume-existing-install")
            if exe is None or not exe.is_file():
                raise RuntimeError("U3 断点的候选安装不存在")
            original_exe = rows[1]["detail"].get("U2", {}).get("exe")
            if not original_exe or Path(original_exe).resolve() != exe.resolve():
                raise RuntimeError("恢复断点的安装路径必须与原 U2 启动记录一致")
            self.check_version(exe, self.args.candidate_version, "resume-candidate")
            locations["U2"] = exe
        elif self.install_location("preflight-existing-install") is not None:
            raise RuntimeError("VM 已有目标程序安装；请先恢复干净快照，拒绝修改未知安装")
        self.manifest = initialize_fixture(self.workdir)
        self.summary["fixtureManifest"] = str(self.workdir / "fixture-manifest.json")
        self.check_data("initial")

        def installed(cid: str, package: str, expected: str) -> Path:
            exe = self.install(Path(package), cid + "-install")
            self.check_version(exe, expected, cid)
            self.check_data(cid + "-before-launch")
            self.launch(exe, cid)
            self.check_data(cid + "-after-launch")
            locations[cid] = exe
            return exe

        def u3() -> None:
            tasks = [
                "候选升级态打开隔离 workspace，另建编辑用文档，编辑并保存后重开验证（不要修改 retention probe）",
                "打印预览/导出并保留输出文件与截图；默认生产包工坊入口应隐藏",
                "必须在 U2 后、U4 前完成并记录时间/版本/数据路径；继续采集不代表人工审阅通过"]
            self.manual_check("U3", tasks, attach=False)
            self.pause_for_manual(locations["U2"])
            self.check_data("U3-after-manual")
            self.manual_check("U3", tasks)

        actions = {
            "U1": lambda: installed("U1", self.args.baseline, self.args.baseline_version),
            "U2": lambda: installed("U2", self.args.candidate, self.args.candidate_version),
            "U3": u3,
            "U4": lambda: (self.uninstall_candidate(locations["U2"], "U4-uninstall-candidate"),
                            installed("U4", self.args.baseline, self.args.baseline_version)),
            "U5": lambda: (installed("U5-upgrade", self.args.candidate, self.args.candidate_version),
                            self.uninstall_candidate(locations["U5-upgrade"], "U5-uninstall-candidate")),
            "U6": lambda: (installed("U6", self.args.candidate, self.args.candidate_version),
                            self.launch(locations["U6"], "U6-restart2"), self.check_data("U6-restart2"),
                            self.manual_check("U6", [
                                "在升级和回滚状态分别重启两次，并保存每轮版本/截图/应用恢复日志（自动轮次仅候选）",
                                "同时发起第二实例，验证仅一个主实例且参数正确转交，检查无残留子进程",
                                "审核全部 crash/recover 日志及正常关闭；进程存活和两次启动日志不能证明无异常"])),
        }
        for cid, action in actions.items():
            if self.args.resume and cid in ("U1", "U2"):
                continue
            if not self.run_stage(cid, action):
                for check in self.summary["checks"]:
                    if check["detail"]["status"] == "not_run":
                        check["detail"]["reason"] = f"前序阶段 {cid} 未完成，后续未执行"
                break
        if self.summary["executionStatus"] != "FAILED":
            self.summary["executionStatus"] = "NEEDS_MANUAL_REVIEW"
        self.summary["productVerdict"] = "NOT_DETERMINED" if self.summary["executionStatus"] != "FAILED" else "REVIEW_FAILURE_EVIDENCE"
        self.save()


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", default="")
    ap.add_argument("--candidate", default="")
    ap.add_argument("--baseline-version", default="1.2.9")
    ap.add_argument("--candidate-version", default="1.2.18")
    ap.add_argument("--workdir", default=str(Path.cwd() / "t27-preflight"))
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--resume", action="store_true", help="仅恢复本 workdir 保存的 U3 人工断点；需同时 --execute")
    ap.add_argument("--vm-id", default="")
    ap.add_argument("--snapshot", "--snapshot-id", dest="snapshot_id", default=os.environ.get("KE_CLOUD_SNAPSHOT_ID", ""))
    ap.add_argument("--manual-evidence", help="JSON: {U3/U6: {reviewer, notes, evidence: [relative paths]}}")
    ap.add_argument("--skip-screenshots", action="store_true", help="仅兼容旧参数；执行时拒绝")
    ap.add_argument("--launch-wait", type=int, default=10)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        workdir = safe_workdir(args.workdir)
    except (OSError, ValueError) as exc:
        print(f"拒绝不安全输出路径：{exc}", file=sys.stderr)
        return 2
    previous = None
    old_plan = None
    previous_path = workdir / "evidence" / "T27-I-results.json"
    if previous_path.is_file():
        previous = json.loads(previous_path.read_text(encoding="utf-8"))
        if any(c["detail"]["status"] != "not_run" for c in previous["checks"]) and not args.resume:
            print("此 workdir 已有执行证据，拒绝覆盖；U3 断点使用 --execute --resume，否则使用新的专用 workdir", file=sys.stderr)
            return 2
    if args.resume:
        if not args.execute or previous is None:
            print("--resume 需要已有 U3 断点记录并同时指定 --execute", file=sys.stderr)
            return 2
        old_plan = json.loads((workdir / "evidence" / "t27-plan.json").read_text(encoding="utf-8"))
        for label in ("baseline", "candidate"):
            if not getattr(args, label):
                setattr(args, label, old_plan["packages"][label]["path"])
    summary = {
        "generatedAt": now(), "runId": str(uuid.uuid4()),
        "environment": {"vm": os.environ.get("COMPUTERNAME", ""), "windows": platform.platform(),
                        "snapshot": args.snapshot_id, "authorizationRef": "原任务用户请求：仅专用快照 VM、自建隔离数据；快照标识为操作者声明，非云平台验证"},
        "baselineVersion": args.baseline_version, "candidateVersion": args.candidate_version,
        "checks": [{"id": cid, "name": name, "pass": False, "evidence": [],
                    "detail": {"status": "not_run", "reason": "尚未执行"}} for cid, name in STAGES.items()],
        "verdict": "FAIL", "executionStatus": "NOT_RUN", "productVerdict": "NOT_DETERMINED",
        "notes": ["Windows 执行路径未实测；Linux 预检不能替代 I 类验收。",
                  "FAIL 表示门禁证据未齐；not_run/blocked 不是产品失败。",
                  "U3/U6 必须人工审阅；本采集器不会自动产出 PASS/PASS_WITH_FINDINGS。",
                  "截图只是屏幕证据，不能证明编辑/保存/打印/单实例或无恢复异常。",
                  "安装包签名状态需另行核验，不预设为已签名或未签名。"],
    }
    if args.resume:
        summary = previous
    gate = Gate(args, workdir, summary)
    blockers = execute_blockers(args) if args.execute else []
    packages = {}
    for label in ("baseline", "candidate"):
        value = getattr(args, label)
        path = Path(value) if value else None
        exists = path is not None and path.is_file()
        digest = None
        if exists:
            try:
                digest = sha256(path)
            except OSError as exc:
                blockers.append(f"无法读取 {label} 安装包：{type(exc).__name__}: {exc}")
        packages[label] = {"path": value, "exists": exists,
                           "sha256": digest,
                           "fileVersion": None, "versionStatus": "未调用 Windows API；安装态版本在各阶段验证"}
        if not exists:
            blockers.append(f"缺少 {label} 安装包")
        if args.resume and packages[label]["sha256"] != old_plan["packages"][label]["sha256"]:
            blockers.append(f"恢复断点时 {label} 安装包 hash 与原计划不符")
    if args.resume:
        if old_plan.get("runId") != summary["runId"]:
            blockers.append("恢复断点的 plan/results runId 不一致")
        if (args.snapshot_id != summary["environment"].get("snapshot") or
                os.environ.get("COMPUTERNAME", "") != summary["environment"]["vm"]):
            blockers.append("恢复断点的 VM/快照声明必须与原执行记录一致")
        if (args.baseline_version != summary["baselineVersion"] or
                args.candidate_version != summary["candidateVersion"]):
            blockers.append("恢复断点的期望版本必须与原记录一致")
    plan = {"generatedAt": now(), "mode": "EXECUTE" if args.execute else "DRY-RUN",
            "runId": summary["runId"], "workdir": str(workdir), "packages": packages,
            "plannedSteps": STAGES, "blockers": blockers,
            "manualEvidenceFormat": {"U3": {"reviewer": "姓名/标识", "notes": "时间/版本/操作结果",
                                              "evidence": ["U3/manual.png", "U3/export.pdf"]}},
            "note": "干跑仅生成计划/未执行结果。执行还需 Windows+VM+snapshot+管理员；人工材料不会自动放行。"}
    if args.resume and blockers:
        summary.setdefault("resumeErrors", []).append({"generatedAt": now(), "blockers": blockers})
        gate.save()
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 2
    write_json(gate.evidence / "t27-plan.json", plan)
    if blockers:
        summary["executionStatus"] = "BLOCKED" if args.execute else "NOT_RUN"
        summary["blockers"] = blockers
        for check in summary["checks"]:
            check["detail"]["reason"] = "；".join(blockers)
    gate.save()
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.execute or blockers:
        return 2 if blockers else 0
    try:
        summary["executionStatus"] = "RUNNING"
        gate.save()
        gate.execute()
    except Exception as exc:
        summary["executionStatus"] = "BLOCKED"
        summary["blockers"] = [f"执行前预检/fixture 异常：{type(exc).__name__}: {exc}"]
        gate.save()
    return 1  # Manual acceptance is deliberately never inferred from automated liveness.


if __name__ == "__main__":
    sys.exit(main())
