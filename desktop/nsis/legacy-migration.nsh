; 品牌迁移钩子：AstraNota 安装时检测旧版 KnowledgeEditor
; （品牌改版 productName 不同，NSIS 原生升级检测不认识旧版——需要显式迁移）
; 数据不删除：tauri NSIS 卸载默认不删 AppData（identifier 未变，新装后数据自动衔接）
; 注意：所有标签带 __kemig_ 前缀防与主脚本冲突；不使用 LogicLib（${If} 依赖未引入），纯原生指令。
!macro NSIS_HOOK_PREINSTALL
  StrCpy $0 ""
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  StrCmp $0 "" 0 __kemig_ask
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  StrCmp $0 "" 0 __kemig_ask
  ReadRegStr $0 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\KnowledgeEditor" "UninstallString"
  StrCmp $0 "" __kemig_done
__kemig_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到旧版 KnowledgeEditor 已安装。$\r$\n$\r$\n是否卸载旧版以完成品牌迁移？（卸载不会删除文档数据，工作区与设置保持不变；如旧版软件正在运行，请先关闭）" IDYES __kemig_do IDNO __kemig_done
__kemig_do:
  ExecWait '"$0" /S'
__kemig_done:
!macroend
