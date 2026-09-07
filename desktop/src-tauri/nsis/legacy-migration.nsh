; 品牌迁移钩子：AstraNota 安装时检测旧版 KnowledgeEditor
; （品牌改版 productName 不同，NSIS 原生升级检测不认识旧版——需要显式迁移）
; 数据不删除：tauri NSIS 卸载默认不删 AppData（identifier 未变，新装后数据自动衔接）
; v1.1.5 ⑦：卸载前先按「旧安装目录路径」精确结束旧版进程——旧版卸载器内置
; 同名进程检测（knowledgeeditor.exe），同名的新版（tauri 二进制名未变）会被误判
; 为"正在运行"导致静默卸载失败；路径过滤可避免误杀新版。
; 标签带 __kemig_ 前缀防与主脚本冲突；不使用 LogicLib，纯原生指令。
!macro NSIS_HOOK_PREINSTALL
  StrCpy $0 ""
  StrCpy $1 ""
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "InstallLocation"
  StrCmp $0 "" 0 __kemig_ask
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "InstallLocation"
  StrCmp $0 "" 0 __kemig_ask
  ReadRegStr $0 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  ReadRegStr $1 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "InstallLocation"
  StrCmp $0 "" __kemig_done
__kemig_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到旧版 KnowledgeEditor 已安装。$\r$\n$\r$\n是否卸载旧版以完成品牌迁移？（卸载不会删除文档数据，工作区与设置保持不变）" IDYES __kemig_do IDNO __kemig_done
__kemig_do:
  ; 路径精确结束旧版进程（仅 InstallLocation 目录下的 knowledgeeditor.exe，避免误杀新版）
  StrCmp $1 "" __kemig_run
  ExecWait 'powershell.exe -noprofile -c "Get-Process knowledgeeditor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \"$1*\" } | Stop-Process -Force -ErrorAction SilentlyContinue; exit"'
__kemig_run:
  ExecWait '"$0" /S'
__kemig_done:
!macroend
