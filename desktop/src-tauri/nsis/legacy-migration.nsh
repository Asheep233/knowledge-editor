; 品牌迁移钩子：AstraNota 安装时检测旧版 KnowledgeEditor
; （品牌改版 productName 不同，NSIS 原生升级检测不认识旧版——需要显式迁移）
; 数据不删除：tauri NSIS 卸载默认不删 AppData（identifier 未变，新装后数据自动衔接）
; v1.1.5 ⑦：卸载前先按「旧安装目录路径」精确结束旧版进程——旧版卸载器内置
; 同名进程检测（knowledgeeditor.exe），同名的新版（tauri 二进制名未变）会被误判
; 为"正在运行"导致静默卸载失败；路径过滤可避免误杀新版。
; 标签带 __kemig_ 前缀防与主脚本冲突。
;
; ── SEC-4 加固（2026-10-02 独立审查）─────────────────────────────────────────
; 审查事实（原实现）：从 **HKCU**（普通用户可写 = 不可信）读 UninstallString 后
; 直接 `ExecWait '"$0" /S'`；InstallLocation 还被字符串拼进 PowerShell `-Command`
; （引号可逃逸 → 命令注入；安装器提权运行时构成提权）。
; 现在：
;   ① 只读 **HKLM**（先 64 位视图，空则 32 位视图）。**绝不读 HKCU**。
;   ② 注册表取到的值**一律不拼进任何命令行**：先写入 `$TEMP` 下的数据文件，
;      再执行一段**静态** PowerShell 脚本（脚本文本为常量，不含任何插值/拼接），
;      由脚本自己做「存在性 + .exe 扩展名 + 文件名白名单 + 根目录白名单」校验，
;      并以**参数数组**（Start-Process -FilePath / -ArgumentList）启动卸载器。
;   ③ 校验不通过 → **不执行任何外部程序**，只提示手动卸载（非破坏性）。
;   附带：写出的 PowerShell 脚本正文**纯 ASCII**（注释也用英文）—— NSIS `FileWrite`
;   受安装器 ANSI 代码页影响，非 ASCII 正文在非中文 Windows 上可能被写坏。
; 说明：原文件为「纯原生指令、不用 LogicLib」；加固后改用 LogicLib（NSIS 自带、
; 带 include 守卫，与主脚本重复 include 安全），以便把分支写清楚。
!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  StrCpy $0 ""
  StrCpy $1 ""
  ; ① 64 位视图
  SetRegView 64
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "InstallLocation"
  ${If} $0 == ""
    ; 32 位视图（32 位 NSIS 进程读 HKLM 的默认映射视图）
    SetRegView 32
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
    ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "InstallLocation"
    SetRegView 64
  ${EndIf}
  ${If} $0 == ""
    Goto __kemig_done
  ${EndIf}

  ; 提示（紧随上面的分支，无需跳转标签）
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到旧版 KnowledgeEditor 已安装。$\r$\n$\r$\n是否卸载旧版以完成品牌迁移？（卸载不会删除文档数据，工作区与设置保持不变）$\r$\n$\r$\n若系统安全策略不允许自动卸载，可选择「否」后手动卸载。" IDYES __kemig_do IDNO __kemig_done
__kemig_do:
  ; ② 注册表值只作为**数据**写入临时文件（任何字符都不会进入命令行）
  FileOpen $8 "$TEMP\ke-mig-input.txt" w
  FileWrite $8 "$0$\r$\n$1$\r$\n"
  FileClose $8
  ; 静态脚本（常量文本，不含注册表数据；本处 $$ 为 NSIS 转义，写出后是单个 $）
  FileOpen $8 "$TEMP\ke-mig-run.ps1" w
  FileWrite $8 "$$ErrorActionPreference = 'SilentlyContinue'$\r$\n"
  FileWrite $8 "$$f = Join-Path $$env:TEMP 'ke-mig-input.txt'$\r$\n"
  FileWrite $8 "$$lines = @(Get-Content -LiteralPath $$f)$\r$\n"
  FileWrite $8 "$$uninst = if ($$lines.Count -ge 1) { [string]$$lines[0] } else { '' }$\r$\n"
  FileWrite $8 "$$inst = if ($$lines.Count -ge 2) { [string]$$lines[1] } else { '' }$\r$\n"
  FileWrite $8 "$$roots = @($$env:ProgramFiles, $${env:ProgramFiles(x86)}, (Join-Path $$env:LOCALAPPDATA 'Programs')) | Where-Object { $$_ }$\r$\n"
  FileWrite $8 "function Test-InRoots([string]$$p) {$\r$\n"
  FileWrite $8 "  if (-not $$p) { return $$false }$\r$\n"
  FileWrite $8 "  try { $$full = [IO.Path]::GetFullPath($$p) } catch { return $$false }$\r$\n"
  FileWrite $8 "  foreach ($$r in $$roots) {$\r$\n"
  FileWrite $8 "    try { $$root = [IO.Path]::GetFullPath($$r).TrimEnd([char]92) + [char]92 } catch { continue }$\r$\n"
  FileWrite $8 "    if ($$full.StartsWith($$root, [StringComparison]::OrdinalIgnoreCase)) { return $$true }$\r$\n"
  FileWrite $8 "  }$\r$\n"
  FileWrite $8 "  return $$false$\r$\n"
  FileWrite $8 "}$\r$\n"
  FileWrite $8 "# 1) stop old processes only when install dir passed the allowlist check$\r$\n"
  FileWrite $8 "if ((Test-Path -LiteralPath $$inst -PathType Container) -and (Test-InRoots $$inst)) {$\r$\n"
  FileWrite $8 "  $$prefix = $$inst.TrimEnd([char]92) + [char]92$\r$\n"
  FileWrite $8 "  Get-Process knowledgeeditor | Where-Object { $$_.Path -and $$_.Path.StartsWith($$prefix, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force$\r$\n"
  FileWrite $8 "}$\r$\n"
  FileWrite $8 "# 2) run the old uninstaller only if: exists + .exe + filename allowlist + root allowlist$\r$\n"
  FileWrite $8 "$$isExe = ($$uninst -and ([IO.Path]::GetExtension($$uninst) -ieq '.exe'))$\r$\n"
  FileWrite $8 "$$isNamed = ((Split-Path $$uninst -Leaf) -match '(?i)(uninstall|unins|knowledgeeditor)')$\r$\n"
  FileWrite $8 "$$ok = $$isExe -and $$isNamed -and (Test-Path -LiteralPath $$uninst -PathType Leaf) -and (Test-InRoots $$uninst)$\r$\n"
  FileWrite $8 "if (-not $$ok) { exit 3 }$\r$\n"
  FileWrite $8 "try { Start-Process -FilePath $$uninst -ArgumentList '/S' -Wait | Out-Null } catch { exit 4 }$\r$\n"
  FileWrite $8 "exit 0$\r$\n"
  FileClose $8
  ExecWait 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$TEMP\ke-mig-run.ps1"' $2
  Delete "$TEMP\ke-mig-run.ps1"
  Delete "$TEMP\ke-mig-input.txt"
  ${If} $2 == 3
    ; ③ 校验未通过：不执行任何程序，提示手动卸载（非破坏性）
    MessageBox MB_OK|MB_ICONEXCLAMATION "未能自动卸载旧版 KnowledgeEditor（卸载器路径未通过安全校验）。$\r$\n$\r$\n请手动卸载旧版后重新运行安装程序；文档数据不受影响。"
  ${EndIf}
__kemig_done:
!macroend
