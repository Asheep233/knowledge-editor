"""Regression tests of gate decisions with OS boundaries mocked.

These are Linux unit tests, not evidence of Windows/NSIS/UI acceptance.
"""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


MODULE = Path(__file__).resolve().parents[1] / "scripts" / "cloud_t27_gate.py"
SPEC = importlib.util.spec_from_file_location("cloud_t27_gate", MODULE)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workdir = self.root / "isolated"

    def main(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return gate.main(["--workdir", str(self.workdir), *args])

    def results(self):
        return json.loads((self.workdir / "evidence" / "T27-I-results.json").read_text())

    def collector(self):
        self.main()
        args = gate.parser().parse_args(["--workdir", str(self.workdir), "--launch-wait", "0"])
        return gate.Gate(args, self.workdir, self.results())

    def test_missing_installers_still_save_plan_and_non_product_failure(self):
        with patch.object(gate.subprocess, "run") as run, patch.object(gate.subprocess, "Popen") as popen:
            self.assertEqual(self.main(), 2)
        run.assert_not_called()
        popen.assert_not_called()
        result = self.results()
        self.assertEqual(result["executionStatus"], "NOT_RUN")
        self.assertEqual(result["productVerdict"], "NOT_DETERMINED")
        self.assertEqual(result["verdict"], "FAIL")
        self.assertEqual([c["id"] for c in result["checks"]], ["U1", "U2", "U3", "U4", "U5", "U6"])
        self.assertTrue(all(c["detail"]["status"] == "not_run" and not c["pass"] for c in result["checks"]))
        self.assertTrue((self.workdir / "evidence" / "t27-plan.json").is_file())
        self.assertFalse((self.workdir / "workspace").exists())

    def test_default_dryrun_uses_local_child_directory(self):
        with patch.object(gate.Path, "cwd", return_value=self.root):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(gate.main([]), 2)
        self.assertTrue((self.root / "t27-preflight" / "evidence" / "t27-plan.json").is_file())

    def test_dryrun_with_inputs_never_claims_acceptance(self):
        installer = self.root / "package.exe"
        installer.write_bytes(b"not a real installer")
        self.assertEqual(self.main("--baseline", str(installer), "--candidate", str(installer)), 0)
        self.assertEqual(self.results()["verdict"], "FAIL")
        self.assertTrue(all(not c["pass"] for c in self.results()["checks"]))

    def test_linux_execute_guard_rejects_before_any_os_mutation(self):
        with patch.dict(os.environ, {"KE_CLOUD_VM": "1", "COMPUTERNAME": "test-vm"}):
            with patch.object(gate.platform, "system", return_value="Linux"):
                with patch.object(gate.subprocess, "run") as run, patch.object(gate.subprocess, "Popen") as popen:
                    self.assertEqual(self.main("--execute", "--snapshot-id", "snap-1", "--vm-id", "test-vm"), 2)
        run.assert_not_called()
        popen.assert_not_called()
        self.assertEqual(self.results()["executionStatus"], "BLOCKED")
        self.assertFalse((self.workdir / "fixture-manifest.json").exists())

    def test_snapshot_and_vm_identity_are_both_mandatory(self):
        args = gate.parser().parse_args(["--execute", "--vm-id", "wrong"])
        args.snapshot_id = ""
        with patch.dict(os.environ, {"KE_CLOUD_VM": "1", "COMPUTERNAME": "test-vm"}):
            reasons = gate.execute_blockers(args)
        self.assertTrue(any("snapshot" in x for x in reasons))
        self.assertTrue(any("COMPUTERNAME" in x for x in reasons))

    def test_snapshot_environment_and_cli_alias(self):
        with patch.dict(os.environ, {"KE_CLOUD_SNAPSHOT_ID": "env-snapshot"}):
            self.assertEqual(gate.parser().parse_args([]).snapshot_id, "env-snapshot")
            self.assertEqual(gate.parser().parse_args(["--snapshot", "cli-snapshot"]).snapshot_id, "cli-snapshot")

    def test_unsafe_output_roots_and_symlinks_are_rejected(self):
        with self.assertRaises(ValueError):
            gate.safe_workdir("/")
        link = self.root / "link"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            gate.safe_workdir(str(link / "output"))
        with patch.object(gate.platform, "system", return_value="Linux"):
            with self.assertRaises(ValueError):
                gate.safe_workdir(r"C:\ke-cloud\t27")

    def test_missing_probe_is_not_recreated_by_initialization(self):
        manifest = gate.initialize_fixture(self.workdir)
        probe = self.workdir / "workspace" / "Articles" / "t27-retention.md"
        probe.unlink()
        self.assertEqual(gate.initialize_fixture(self.workdir), manifest)
        self.assertFalse(gate.verify_fixture(self.workdir, manifest)["pass"])
        self.assertFalse(probe.exists())

    def test_corrupted_probe_hash_fails_even_when_file_exists(self):
        manifest = gate.initialize_fixture(self.workdir)
        probe = self.workdir / "workspace" / "Articles" / "t27-retention.md"
        probe.write_text("lost content", encoding="utf-8")
        self.assertFalse(gate.verify_fixture(self.workdir, manifest)["pass"])
        gate.initialize_fixture(self.workdir)
        self.assertEqual(probe.read_text(), "lost content")

    def test_lost_appdata_or_setting_is_a_data_failure(self):
        manifest = gate.initialize_fixture(self.workdir)
        data = self.workdir / "appdata" / "KnowledgeEditor"
        (data / "settings.json").write_text("{}", encoding="utf-8")
        result = gate.verify_fixture(self.workdir, manifest)
        self.assertFalse(result["pass"])
        self.assertFalse(result["startupSettingPreserved"])
        (data / "t27-retention.txt").unlink()
        self.assertFalse(gate.verify_fixture(self.workdir, manifest)["pass"])

    def test_initializer_refuses_unowned_existing_workspace(self):
        (self.workdir / "workspace").mkdir(parents=True)
        note = self.workdir / "workspace" / "user-note.txt"
        note.write_text("keep me")
        with self.assertRaises(RuntimeError):
            gate.initialize_fixture(self.workdir)
        self.assertEqual(note.read_text(), "keep me")

    def test_version_matching_cannot_accept_substrings_or_missing_versions(self):
        self.assertTrue(gate.version_matches("1.2.18.0", "1.2.18"))
        for actual in ("", "11.2.18", "1.2.180", "1.2.18-dev", "v1.2.18"):
            self.assertFalse(gate.version_matches(actual, "1.2.18"), actual)

    def test_launch_uses_isolated_appdata_and_does_not_repair_lost_probe(self):
        collector = self.collector()
        manifest = gate.initialize_fixture(self.workdir)
        probe = self.workdir / "workspace" / "Articles" / "t27-retention.md"
        probe.unlink()
        proc = Mock(pid=4321)
        proc.poll.return_value = None
        proc.wait.return_value = 0
        # A successful wait means the process really exited before finally.
        proc.wait.side_effect = lambda timeout: setattr(proc.poll, "return_value", 0) or 0
        shot = collector.evidence / "U1" / "screen.png"
        with patch.dict(os.environ, {"APPDATA": "/real-user-appdata"}):
            with patch.object(gate.subprocess, "Popen", return_value=proc) as start:
                with patch.object(collector, "screenshot", return_value=shot), patch.object(collector, "ps") as ps:
                    collector.launch(Path("test.exe"), "U1")
        self.assertEqual(start.call_args.kwargs["env"]["APPDATA"], str(self.workdir / "appdata"))
        self.assertIn("Get-Process -Id 4321", ps.call_args.args[0])
        self.assertNotIn("knowledgeeditor", ps.call_args.args[0])
        self.assertFalse(probe.exists())
        self.assertFalse(gate.verify_fixture(self.workdir, manifest)["pass"])
        proc.kill.assert_not_called()

    def test_screenshot_failure_does_not_pass_and_only_owned_pid_is_cleaned(self):
        collector = self.collector()
        proc = Mock(pid=4321)
        proc.poll.return_value = None
        proc.wait.return_value = 0
        with patch.object(gate.subprocess, "Popen", return_value=proc):
            with patch.object(collector, "screenshot", side_effect=RuntimeError("capture failed")):
                self.assertFalse(collector.run_stage("U1", lambda: collector.launch(Path("app.exe"), "U1")))
        proc.kill.assert_called_once_with()
        row = self.results()["checks"][0]
        self.assertFalse(row["pass"])
        self.assertTrue(row["detail"]["U1"]["forcedCleanup"])
        self.assertIn("capture failed", row["detail"]["exception"])
        self.assertTrue(row["evidence"])

    def test_powershell_timeout_is_persisted_under_current_stage(self):
        collector = self.collector()
        with patch.object(gate.subprocess, "run", side_effect=subprocess.TimeoutExpired("ps", 1)):
            self.assertFalse(collector.run_stage("U2", lambda: collector.ps("test", "timeout", 1)))
        row = self.results()["checks"][1]
        self.assertEqual(row["detail"]["status"], "failed")
        self.assertIn("logs/timeout.json", row["evidence"])
        log = json.loads((collector.evidence / "logs" / "timeout.json").read_text())
        self.assertIn("TimeoutExpired", log["exception"])
        self.assertEqual(self.results()["verdict"], "FAIL")

    def test_manual_attachment_cannot_turn_a_check_into_pass(self):
        collector = self.collector()
        evidence = collector.evidence / "U3" / "manual.png"
        evidence.parent.mkdir(parents=True)
        evidence.write_bytes(b"human screenshot placeholder")
        attachment = self.root / "manual.json"
        attachment.write_text(json.dumps({"U3": {"reviewer": "operator", "notes": "review required", "evidence": ["U3/manual.png"]}}))
        collector.args.manual_evidence = str(attachment)
        self.assertTrue(collector.run_stage("U3", lambda: collector.manual_check("U3", ["edit/save/export"])))
        row = self.results()["checks"][2]
        self.assertFalse(row["pass"])
        self.assertEqual(row["detail"]["status"], "needs_manual_review")
        self.assertEqual(row["evidence"], ["U3/manual.png"])
        self.assertEqual(self.results()["verdict"], "FAIL")

    def test_uninstaller_nonzero_exit_is_failure_even_if_executable_disappears(self):
        collector = self.collector()
        folder = self.root / "installed"
        folder.mkdir()
        exe = folder / "knowledgeeditor.exe"
        exe.touch()
        uninstall = folder / "uninstall.exe"
        uninstall.touch()
        registry = subprocess.CompletedProcess([], 0, json.dumps(str(uninstall)), "")
        failed = subprocess.CompletedProcess([], 0, "23", "")
        with patch.object(collector, "check_version"), patch.object(collector, "ps", side_effect=[registry, failed]):
            self.assertFalse(collector.run_stage("U5", lambda: collector.uninstall_candidate(exe, "U5-remove")))
        row = self.results()["checks"][4]
        self.assertEqual(row["detail"]["U5-remove"]["exitCode"], 23)
        self.assertFalse(row["pass"])

    def test_full_mocked_collection_never_promotes_manual_gaps(self):
        collector = self.collector()
        gate.initialize_fixture(self.workdir)
        baseline = Path("baseline.exe")
        candidate = Path("candidate.exe")
        collector.args.baseline = str(baseline)
        collector.args.candidate = str(candidate)
        order = []
        def install(package, label):
            order.append(("install", package, label))
            return package
        def uninstall(exe, label):
            order.append(("uninstall", exe, label))
        with patch.object(collector, "install_location", return_value=None):
            with patch.object(collector, "install", side_effect=install), patch.object(collector, "check_version"):
                with patch.object(collector, "launch"), patch.object(collector, "uninstall_candidate", side_effect=uninstall), patch.object(collector, "pause_for_manual"):
                    collector.execute()
        rows = self.results()["checks"]
        self.assertEqual(len(rows), 6)
        self.assertEqual(self.results()["executionStatus"], "NEEDS_MANUAL_REVIEW")
        self.assertEqual(self.results()["verdict"], "FAIL")
        self.assertFalse(rows[2]["pass"])
        self.assertFalse(rows[5]["pass"])
        self.assertIn(("uninstall", candidate, "U5-uninstall-candidate"), order)
        u5_install = order.index(("install", candidate, "U5-upgrade-install"))
        u5_uninstall = order.index(("uninstall", candidate, "U5-uninstall-candidate"))
        self.assertLess(u5_install, u5_uninstall)

    def test_noninteractive_u3_pauses_before_uninstalling_candidate(self):
        collector = self.collector()
        with patch.object(collector, "install_location", return_value=None):
            with patch.object(collector, "install", return_value=Path("candidate.exe")), patch.object(collector, "check_version"):
                with patch.object(collector, "launch"), patch.object(collector, "uninstall_candidate") as uninstall:
                    with patch.object(gate.sys.stdin, "isatty", return_value=False), contextlib.redirect_stdout(io.StringIO()):
                        collector.execute()
        uninstall.assert_not_called()
        result = self.results()
        self.assertTrue(all(c["pass"] for c in result["checks"][:2]))
        self.assertEqual(result["checks"][2]["detail"]["status"], "needs_manual_review")
        self.assertTrue(all(c["detail"]["status"] == "not_run" for c in result["checks"][3:]))
        self.assertEqual(result["executionStatus"], "NEEDS_MANUAL_REVIEW")
        self.assertIn("APPDATA", result["checks"][2]["detail"]["manualInstructions"])

    def test_resume_continues_u3_checkpoint_without_reinstalling_baseline_first(self):
        collector = self.collector()
        manifest = gate.initialize_fixture(self.workdir)
        collector.manifest = manifest
        for row in collector.summary["checks"][:2]:
            row["pass"] = True
            row["detail"]["status"] = "passed"
        collector.summary["checks"][2]["detail"]["status"] = "needs_manual_review"
        collector.args.resume = True
        candidate = self.root / "candidate.exe"
        candidate.touch()
        collector.summary["checks"][1]["detail"]["U2"] = {"exe": str(candidate)}
        installs = []
        def install(package, label):
            installs.append(label)
            return candidate
        with patch.object(collector, "install_location", return_value=candidate), patch.object(collector, "check_version"):
            with patch.object(collector, "pause_for_manual"), patch.object(collector, "launch"), patch.object(collector, "uninstall_candidate"):
                with patch.object(collector, "install", side_effect=install):
                    collector.execute()
        self.assertNotIn("U1-install", installs)
        self.assertNotIn("U2-install", installs)
        self.assertIn("U4-install", installs)
        self.assertEqual(self.results()["executionStatus"], "NEEDS_MANUAL_REVIEW")

    def test_live_manual_process_prevents_u4_even_after_operator_continue(self):
        collector = self.collector()
        with patch.object(gate.sys.stdin, "isatty", return_value=True), patch("builtins.input", return_value="CONTINUE"):
            with patch.object(collector, "ps", return_value=subprocess.CompletedProcess([], 0, "1", "")):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertFalse(collector.run_stage("U3", lambda: collector.pause_for_manual(Path("candidate.exe"))))
        row = self.results()["checks"][2]
        self.assertEqual(row["detail"]["status"], "needs_manual_review")
        self.assertIn("尚未关闭", row["detail"]["reason"])

    def test_existing_execution_evidence_is_not_overwritten_by_fresh_dryrun(self):
        collector = self.collector()
        collector.summary["checks"][0]["detail"]["status"] = "failed"
        collector.save()
        original = (collector.evidence / "T27-I-results.json").read_bytes()
        self.assertEqual(self.main(), 2)
        self.assertEqual((collector.evidence / "T27-I-results.json").read_bytes(), original)

    def test_resume_changed_installer_hash_is_blocked_without_overwriting_original_plan(self):
        collector = self.collector()
        installer = self.root / "candidate.exe"
        installer.write_bytes(b"changed installer")
        collector.summary["executionStatus"] = "NEEDS_MANUAL_REVIEW"
        collector.summary["checks"][0]["pass"] = True
        collector.summary["checks"][0]["detail"]["status"] = "passed"
        collector.summary["checks"][1]["pass"] = True
        collector.summary["checks"][1]["detail"]["status"] = "passed"
        collector.summary["checks"][2]["detail"]["status"] = "needs_manual_review"
        collector.save()
        plan_path = collector.evidence / "t27-plan.json"
        plan = json.loads(plan_path.read_text())
        for label in ("baseline", "candidate"):
            plan["packages"][label].update(path=str(installer), sha256="old expected hash")
        gate.write_json(plan_path, plan)
        original_plan = plan_path.read_bytes()
        with patch.object(gate, "execute_blockers", return_value=[]), patch.object(gate.Gate, "execute") as execute:
            self.assertEqual(self.main("--execute", "--resume"), 2)
        execute.assert_not_called()
        self.assertEqual(plan_path.read_bytes(), original_plan)
        result = self.results()
        self.assertEqual(result["executionStatus"], "NEEDS_MANUAL_REVIEW")
        self.assertTrue(any("hash" in reason for reason in result["resumeErrors"][-1]["blockers"]))

    def test_first_failure_stops_later_installation_and_never_pass_with_findings(self):
        collector = self.collector()
        with patch.object(collector, "install_location", return_value=None):
            with patch.object(collector, "install", side_effect=RuntimeError("installer failed")) as install:
                collector.execute()
        install.assert_called_once()
        result = self.results()
        self.assertEqual(result["verdict"], "FAIL")
        self.assertEqual(result["executionStatus"], "FAILED")
        self.assertEqual(result["checks"][0]["detail"]["status"], "failed")
        self.assertTrue(all(c["detail"]["status"] == "not_run" for c in result["checks"][1:]))


if __name__ == "__main__":
    unittest.main()
