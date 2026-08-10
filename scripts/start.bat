@echo off
rem ============================================================
rem  KnowledgeEditor 一键启动入口（Windows 双击版）
rem  本脚本仅作为入口：切换到项目根目录后调用 start.ps1，
rem  所有检查 / 启动 / 进程管理逻辑均在 start.ps1 中（PowerShell）。
rem ============================================================

rem 切换到项目根目录（本文件位于 scripts\ 下，上级即项目根）
cd /d "%~dp0.."
if errorlevel 1 (
    echo [ERROR] 无法定位项目根目录：%~dp0..
    pause
    exit /b 1
)

echo ============================================
echo   KnowledgeEditor 开发环境启动中 ...
echo   启动内容: FastAPI backend + Vite frontend
echo   关闭本窗口不会停止已启动的服务
echo   停止服务: 运行 scripts\stop.ps1
echo ============================================
echo.

rem 调用 start.ps1（PowerShell 逻辑保持不变，临时放开执行策略）
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo [ERROR] 启动失败（退出码 %EXITCODE%），请查看上方错误提示。
    echo         依赖缺失时请先运行 scripts\setup.ps1 初始化。
    echo         端口被占用时请按提示处理占用进程后重试。
) else (
    echo [OK] 启动流程完成。
    echo      前端: http://localhost:5173
    echo      后端: http://127.0.0.1:8000
)

echo.
pause
