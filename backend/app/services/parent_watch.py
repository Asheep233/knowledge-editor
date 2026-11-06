"""父进程心跳（2026-11-06 · rc.3）。

背景：主程序异常/强杀退出时，Tauri 的正常清理链（`cleanup_on_exit`）不会执行，
PyInstaller 侧车可能成为孤儿进程长期存活；它会锁住 `knowledgeeditor-backend.exe`，
导致下一次覆盖安装报「无法打开要写入的文件」（rc.2 真机实测）。

方案：桌面壳 spawn 侧车时注入 `KE_PARENT_PID`；本模块以 daemon 线程每 2s 检查
父进程是否仍存活，连续 3 次检测不到后自行 `os._exit(0)`。
独立启动后端（开发/测试/手动 uvicorn）不注入该变量 → 不启用，行为不变。
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time

logger = logging.getLogger(__name__)

#: 轮询间隔（秒）
POLL_INTERVAL_S = 2.0
#: 连续多少次检测不到父进程后退出（避免启动/调度抖动误杀）
MISSES_BEFORE_EXIT = 3

_STILL_ACTIVE = 259


def _configured_parent_pid() -> int | None:
    """读取 `KE_PARENT_PID`；缺失/非法返回 None（不启用监控）。"""
    raw = os.environ.get("KE_PARENT_PID", "").strip()
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError:
        return None
    return pid if pid > 0 else None


def _alive_windows(pid: int) -> bool:
    """Windows：OpenProcess + GetExitCodeProcess，判断进程是否仍存活。"""
    import ctypes
    from ctypes import wintypes

    process_query_limited_information = 0x1000
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == _STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _alive_posix(pid: int) -> bool:
    """POSIX：signal 0 探测；无权限说明进程存在。"""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def parent_alive(pid: int | None = None) -> bool | None:
    """父进程是否存活。

    返回 None 表示未配置/非法 PID（不启用监控）；True/False 为探测结果。
    """
    parent = pid if pid is not None else _configured_parent_pid()
    if parent is None or parent <= 0:
        return None
    if sys.platform == "win32":
        return _alive_windows(parent)
    return _alive_posix(parent)


def _watch(parent_pid: int) -> None:
    misses = 0
    while True:
        time.sleep(POLL_INTERVAL_S)
        if parent_alive(parent_pid):
            misses = 0
            continue
        misses += 1
        logger.warning(
            "父进程 %s 不可达（连续 %d/%d 次）",
            parent_pid,
            misses,
            MISSES_BEFORE_EXIT,
        )
        if misses >= MISSES_BEFORE_EXIT:
            logger.error("父进程 %s 已退出，sidecar 自行退出（避免孤儿进程锁升级）", parent_pid)
            # 硬退出：父进程不存在时已无客户端；不等待 uvicorn 优雅收尾（会拖住关闭）。
            os._exit(0)


def start_if_configured() -> bool:
    """若 `KE_PARENT_PID` 已配置则启动心跳线程；返回是否启用。"""
    parent = _configured_parent_pid()
    if parent is None:
        return False
    thread = threading.Thread(target=_watch, args=(parent,), name="ke-parent-watch", daemon=True)
    thread.start()
    logger.info(
        "父进程心跳已启用：parent_pid=%s interval=%.1fs misses=%d",
        parent,
        POLL_INTERVAL_S,
        MISSES_BEFORE_EXIT,
    )
    return True


# PyInstaller onefile 的子进程里 `sys.frozen` 等环境不会自动清理；无需额外注册。
