"""rc.3：父进程心跳单测（不依赖真实桌面壳）。"""
from __future__ import annotations

import os

from app.services import parent_watch


def test_configured_parent_pid_missing_or_invalid(monkeypatch):
    monkeypatch.delenv("KE_PARENT_PID", raising=False)
    assert parent_watch._configured_parent_pid() is None
    monkeypatch.setenv("KE_PARENT_PID", "abc")
    assert parent_watch._configured_parent_pid() is None
    monkeypatch.setenv("KE_PARENT_PID", "0")
    assert parent_watch._configured_parent_pid() is None
    monkeypatch.setenv("KE_PARENT_PID", " 4321 ")
    assert parent_watch._configured_parent_pid() == 4321


def test_parent_alive_current_process_true():
    assert parent_watch.parent_alive(os.getpid()) is True


def test_parent_alive_dead_pid_false():
    assert parent_watch.parent_alive(2**31 - 1) is False


def test_parent_alive_unconfigured_returns_none(monkeypatch):
    monkeypatch.delenv("KE_PARENT_PID", raising=False)
    assert parent_watch.parent_alive() is None


def test_start_if_configured_without_env_is_noop(monkeypatch):
    monkeypatch.delenv("KE_PARENT_PID", raising=False)
    assert parent_watch.start_if_configured() is False
