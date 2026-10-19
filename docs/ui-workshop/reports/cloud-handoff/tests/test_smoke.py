"""Boundary tests; Windows/application/CDP are mocked, never Windows acceptance evidence."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "cloud_verify_installed.py"
spec = importlib.util.spec_from_file_location("cloud_verify_installed", SCRIPT)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.exe = self.root / "knowledgeeditor.exe"
        self.exe.write_text("mock", encoding="utf-8")
        self.out = self.root / "result.json"
        self.data = self.root / "data"
        self.data.mkdir()
        self.sentinel = self.data / "existing-user-file.txt"
        self.sentinel.write_text("keep", encoding="utf-8")
        self.pack = self.root / "pack"
        self.pack.mkdir()
        self.pack_id = "com.astranota.cloud.smoke"
        (self.pack / "manifest.json").write_text(json.dumps({
            "id": self.pack_id, "version": "1.0.0",
            "signature": {"alg": "ed25519", "keyId": "k1", "signature": "1" * 128},
        }), encoding="utf-8")
        self.keys = json.dumps({"k1": {"key": "2" * 64}})
        self.argv = ["--exe", str(self.exe), "--snapshot-id", "snap-before-smoke",
                     "--data-dir", str(self.data), "--out", str(self.out), "--expect-entry", "no"]

    def run_main(self, argv=None, windows=True, **patches):
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(smoke.platform, "system", return_value="Windows" if windows else "Linux"))
            stack.enter_context(mock.patch.dict(smoke.os.environ, {"KE_CLOUD_VM": "1"}, clear=True))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            for name, replacement in patches.items():
                stack.enter_context(mock.patch.object(smoke, name, replacement))
            code = smoke.main(self.argv if argv is None else argv)
        return code, json.loads(self.out.read_text(encoding="utf-8"))

    def yes_args(self):
        return self.argv[:-2] + ["--expect-entry", "yes", "--pack-dir", str(self.pack), "--pubkeys", self.keys]

    def runtime_mocks(self):
        self.proc = mock.Mock(pid=1001)
        self.proc.poll.return_value = None
        self.tracker = mock.Mock()
        self.tracker.cleanup.return_value = {"ownedPids": [1001, 1002], "residualPids": [], "errors": []}
        self.cdp = mock.Mock()
        self.guest_heartbeat = 0

        def evaluate(expression):
            if "const r=window.__keGuestResults" in expression:
                self.guest_heartbeat += 5
                return {"packId": self.pack_id, "connected": True, "heartbeatCount": self.guest_heartbeat}
            return True

        self.cdp.eval.side_effect = evaluate
        self.clock_value = 0

        def clock():
            self.clock_value += 0.1
            return self.clock_value

        return {
            "importlib": SimpleNamespace(import_module=mock.Mock(side_effect={
                "websocket": SimpleNamespace(create_connection=mock.Mock()),
                "psutil": SimpleNamespace(Process=mock.Mock()),
            }.__getitem__)),
            "subprocess": SimpleNamespace(Popen=mock.Mock(return_value=self.proc), STDOUT=-2),
            "OwnedProcesses": mock.Mock(return_value=self.tracker),
            "CDP": mock.Mock(return_value=self.cdp),
            "targets": mock.Mock(return_value=[{"type": "page", "url": "http://tauri.localhost", "webSocketDebuggerUrl": "ws://localhost/mock"}]),
            "time": SimpleNamespace(monotonic=clock, sleep=lambda _seconds: None),
        }

    def test_help_does_not_import_optional_dependencies(self):
        with mock.patch.object(smoke.importlib, "import_module", side_effect=ImportError("uninstalled")) as imp:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as stop:
                smoke.main(["--help"])
        self.assertEqual(stop.exception.code, 0)
        imp.assert_not_called()

    def test_linux_guard_preserves_existing_data_and_emits_blocked(self):
        popen = mock.Mock(side_effect=AssertionError("must not start"))
        with mock.patch.object(smoke.subprocess, "Popen", popen):
            code, result = self.run_main(windows=False)
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertFalse(result["executed"])
        self.assertFalse(result["smokeCompleted"])
        self.assertEqual(self.sentinel.read_text(), "keep")
        self.assertEqual(list(self.data.iterdir()), [self.sentinel])
        popen.assert_not_called()

    def test_yes_without_pack_and_keys_cannot_pass(self):
        code, result = self.run_main(self.argv[:-1] + ["yes"])
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertTrue(any("必须提供" in check["name"] and not check["pass"] for check in result["checks"]))

    def test_missing_exe_and_snapshot_emits_json(self):
        argv = ["--exe", str(self.root / "missing.exe"), "--expect-entry", "no", "--out", str(self.out)]
        code, result = self.run_main(argv)
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(sum(not check["pass"] for check in result["checks"]), 2)

    def test_missing_dependency_emits_json_before_launch(self):
        with mock.patch.object(smoke.importlib, "import_module", side_effect=ImportError("websocket")):
            code, result = self.run_main()
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertFalse(result["executed"])

    def test_malformed_pack_json_emits_blocked_json(self):
        (self.pack / "manifest.json").write_text("{broken", encoding="utf-8")
        code, result = self.run_main(self.yes_args())
        self.assertEqual(code, 2)
        self.assertIn("JSONDecodeError", result["checks"][-1]["detail"])

    def test_startup_timeout_and_runtime_exception_still_clean_up_and_write_json(self):
        patches = self.runtime_mocks()
        patches["targets"] = mock.Mock(return_value=[])
        code, result = self.run_main(self.argv + ["--startup-timeout", "0.1"], **patches)
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(result["executed"])
        self.tracker.cleanup.assert_called_once()
        self.assertEqual(self.sentinel.read_text(), "keep")
        self.assertTrue(Path(result["runDataDir"]).is_dir())

    def test_unsigned_scan_cannot_be_called_signed_install(self):
        patches = self.runtime_mocks()
        backend = mock.Mock(return_value={"signatureStatus": "missing", "packId": self.pack_id, "version": "1.0.0"})
        patches["invoke"] = backend
        code, result = self.run_main(self.yes_args(), **patches)
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual([call.args[1] for call in backend.call_args_list], ["workshop_pack_scan"])

    def test_full_enabled_flow_checks_real_backend_shape_and_isolates_each_run(self):
        patches = self.runtime_mocks()
        replies = [
            {"signatureStatus": "valid", "packId": self.pack_id, "version": "1.0.0"},
            {"active": "1.0.0", "previous": None},
            {"packs": [{"id": self.pack_id, "active": "1.0.0", "activeVersion": "1.0.0", "signatureStatus": "valid"}]},
            {"state": "active", "packId": self.pack_id},
            {"state": "active", "packId": self.pack_id},
            {"state": "stopped", "packId": self.pack_id},
        ]
        patches["invoke"] = mock.Mock(side_effect=replies)
        code, result = self.run_main(self.yes_args(), **patches)
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["smokeCompleted"])
        env = patches["subprocess"].Popen.call_args.kwargs["env"]
        first = Path(result["runDataDir"])
        self.assertEqual(Path(env["APPDATA"]), first / "appdata")
        self.assertEqual(Path(env["WEBVIEW2_USER_DATA_FOLDER"]), first / "webview")
        self.assertEqual(env["KE_WORKSHOP_PUBKEYS"], self.keys)
        patches = self.runtime_mocks()
        patches["targets"].side_effect = RuntimeError("deliberate CDP failure")
        second_code, second = self.run_main(**patches)
        self.assertEqual(second_code, 1)
        self.assertNotEqual(first, Path(second["runDataDir"]))
        self.assertTrue(first.exists())
        self.assertEqual(self.sentinel.read_text(), "keep")

    def test_backend_active_for_another_pack_cannot_pass(self):
        patches = self.runtime_mocks()

        def backend(_cdp, command, _payload):
            if command == "workshop_pack_scan":
                return {"signatureStatus": "valid", "packId": self.pack_id, "version": "1.0.0"}
            if command == "workshop_pack_install":
                return {"active": "1.0.0"}
            if command == "workshop_pack_list":
                return {"packs": [{"id": self.pack_id, "active": "1.0.0", "activeVersion": "1.0.0", "signatureStatus": "valid"}]}
            return {"state": "active", "packId": "another.pack"}

        patches["invoke"] = backend
        code, result = self.run_main(self.yes_args() + ["--ui-timeout", "0.1"], **patches)
        self.assertEqual(code, 1)
        self.assertFalse(result["smokeCompleted"])

    def test_default_hidden_and_visible_cases(self):
        for entry_visible in (False, True):
            with self.subTest(entry_visible=entry_visible):
                patches = self.runtime_mocks()
                patches["invoke"] = mock.Mock(side_effect=AssertionError("default flow must not mutate packs"))
                self.cdp.eval.side_effect = lambda expression: True if "document.readyState" in expression else entry_visible
                code, result = self.run_main(self.argv + ["--hidden-observe-seconds", "1"], **patches)
                self.assertEqual(code, 1 if entry_visible else 0)
                self.assertEqual(result["status"], "FAIL" if entry_visible else "PASS")

    def test_early_active_without_guest_heartbeat_cannot_pass(self):
        patches = self.runtime_mocks()
        evaluate = self.cdp.eval.side_effect
        self.cdp.eval.side_effect = lambda expression: False if ">=" in expression and "__keGuestHeartbeats" in expression else evaluate(expression)

        def backend(_cdp, command, _payload):
            if command == "workshop_pack_scan":
                return {"signatureStatus": "valid", "packId": self.pack_id, "version": "1.0.0"}
            if command == "workshop_pack_install":
                return {"active": "1.0.0"}
            if command == "workshop_pack_list":
                return {"packs": [{"id": self.pack_id, "active": "1.0.0", "activeVersion": "1.0.0", "signatureStatus": "valid"}]}
            return {"state": "active", "packId": self.pack_id}

        patches["invoke"] = backend
        code, result = self.run_main(self.yes_args() + ["--ui-timeout", "0.1"], **patches)
        self.assertEqual(code, 1)
        self.assertFalse(result["smokeCompleted"])
        self.assertTrue(any("实际心跳" in check["name"] and not check["pass"] for check in result["checks"]))

    def test_residual_process_prevents_pass(self):
        patches = self.runtime_mocks()
        self.cdp.eval.side_effect = lambda expression: "document.readyState" in expression
        self.tracker.cleanup.return_value = {"ownedPids": [1001, 1002], "residualPids": [1002], "errors": []}
        code, result = self.run_main(self.argv + ["--hidden-observe-seconds", "1"], **patches)
        self.assertEqual(code, 1)
        self.assertTrue(result["smokeCompleted"])
        self.assertEqual(result["status"], "FAIL")


class CDPAndProcessTests(unittest.TestCase):
    def test_javascript_exception_and_invoke_rejection_are_not_swallowed(self):
        cdp = object.__new__(smoke.CDP)
        cdp.call = mock.Mock(return_value={"exceptionDetails": {"text": "boom"}, "result": {"type": "undefined"}})
        with self.assertRaisesRegex(RuntimeError, "JavaScript exception"):
            cdp.eval("throw Error('boom')")
        cdp = mock.Mock()
        for value in (None, {"ok": False, "error": "denied"}, {"value": True}):
            cdp.eval.return_value = value
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                smoke.invoke(cdp, "workshop_pack_install", {})

    def test_pid_tree_uses_process_identity_and_ignores_other_instances(self):
        class NoSuchProcess(Exception):
            pass

        class FakeProcess:
            def __init__(self, pid, created):
                self.pid, self.created = pid, created
                self.running, self.killed = True, False
                self.descendants = []

            def create_time(self):
                return self.created

            def is_running(self):
                return self.running

            def children(self, recursive=False):
                return self.descendants

            def kill(self):
                self.killed, self.running = True, False

        root, child, unrelated = FakeProcess(1001, 1), FakeProcess(1002, 2), FakeProcess(2001, 1)
        root.descendants = [child]
        fake = SimpleNamespace(Process=mock.Mock(return_value=root), NoSuchProcess=NoSuchProcess,
                               wait_procs=mock.Mock(return_value=([], [])))
        proc = mock.Mock(pid=1001)
        proc.poll.return_value = None
        with mock.patch.object(smoke.importlib, "import_module", return_value=fake):
            tracker = smoke.OwnedProcesses(proc)
            child.running = False  # Recorded PID was reused; psutil reports old Process.is_running() false.
            result = tracker.cleanup()
        self.assertTrue(root.killed)
        self.assertFalse(child.killed)
        self.assertFalse(unrelated.killed)
        self.assertEqual(result["residualPids"], [])
        fake.Process.assert_called_once_with(1001)


if __name__ == "__main__":
    unittest.main()
