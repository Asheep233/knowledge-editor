# 云端实机验收交接

按 `TASKS.md` 执行。最短路径：

```powershell
# 0) 准备（Git/Node/Python/Rust/VS Build Tools；pip install pyinstaller websocket-client requests）
mkdir C:\ke-cloud; # 上传本目录到 C:\ke-cloud\（含 ui-workshop.bundle 与脚本）
# 1) 取代码
cd C:\ke-cloud; git clone https://github.com/Asheep233/knowledge-editor.git repo; cd repo
git checkout 4c71233
git fetch C:\ke-cloud\ui-workshop.bundle feat/ui-workshop:feat/ui-workshop
git checkout feat/ui-workshop
# 2) 构建（见 cloud_build.ps1）
powershell -ExecutionPolicy Bypass -File C:\ke-cloud\cloud_build.ps1
# 3) T27 I 门禁（U1–U6，见 TASKS.md §4）→ 填 evidence/T27-I-results.json
# 4) 安装态冒烟（workshop-enabled 包；见 TASKS.md §5）
python C:\ke-cloud\cloud_verify_installed.py --exe "<install>\knowledgeeditor.exe" --expect-entry yes
# 5) 打包 C:\ke-cloud\evidence 回传
```

**回传 zip 内容**：`T27-I-results.json`、`cloud-workshop-verify*.json`、U1–U6 截图、logs、`P5-T26-T27-I-gate.md`。
**红线**：快照 VM、自建测试数据、不 push/不 Release、不用真实笔记、失败如实。
