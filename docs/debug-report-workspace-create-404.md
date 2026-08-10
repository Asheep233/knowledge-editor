# Debug 报告：新建工作区报 404 Not Found

日期：2026-08-09

## 一、现象

用户在 Workspace 选择页输入本地目录路径后点击「新建工作区」，界面提示「创建失败：404 Not Found」。后端接口 `/api/workspace/create` 路由存在且前端调用路径正确，现象与代码表面状态不一致。

## 二、排查过程

排查从「路由是否存在」到「进程与数据状态」逐层展开，共发现三个相互叠加的问题。

**第一步：确认路由与代理配置正常。** 检查 `backend/app/routers/workspace.py`，`@router.post("/create", status_code=201)` 已注册；检查 `frontend/vite.config.ts`，`/api` 代理正确指向 `127.0.0.1:8000`。代码层面没有缺失。

**第二步：实际启动后端复现。** 用 `uvicorn app.main:app` 启动后端，health 检查返回 200，但 `POST /api/workspace/create` 返回 404 且无响应体。随后发现 8000 端口已被另一个进程（PID 24496）占用，该进程是项目 `.venv` 启动的 uvicorn 实例，命令行没有 `--reload` 参数——它加载的是 Phase 4 代码更新**之前**的旧代码：有 `/api/health`，但没有 `/api/workspace/create` 路由。前端是新的（能显示选择页），请求打到旧进程上，FastAPI 对不存在的路由返回 404。这是用户看到「创建失败：404 Not Found」的直接原因。

**第三步：定位索引数据库损坏。** 自己启动的 uvicorn 实例并未成功运行，日志显示 `sqlite3.DatabaseError: database disk image is malformed`，`Application startup failed. Exiting.`——lifespan 启动阶段 `activate_workspace` 全量重建索引时，对 `workspace\.knowledgeeditor\index.db` 执行 `DELETE FROM files` 报索引文件损坏。用 `PRAGMA integrity_check` 只读检查返回 `ok`、`SELECT count(*)` 返回 7 行，但任何写操作立即抛 `malformed`——这是 SQLite 页损坏的典型表现：只读路径未触及损坏页，写入即暴露。旧进程被终止后（WAL 自动合并进主库），写入验证确认文件已损坏，`index.db` 确认为坏文件。6 个 Markdown 文档数据完好无损。

**第四步：复现自愈逻辑时发现连接句柄泄漏。** 为索引损坏增加「自动丢弃重建」逻辑后，最小复现脚本显示第一次 `connect()` 抛异常被捕获、删除损坏文件，但第二次 `connect()` 依然读到坏文件。原因是 `IndexStore.connect()` 中 `sqlite3.connect()` 已成功并持有文件句柄，后续 `PRAGMA journal_mode=WAL` 抛错时连接未关闭；Windows 文件锁使 `unlink` 静默失败（PermissionError 被 `except OSError` 吞掉），损坏文件实际未被删除。这也是后端启动失败的完整链路：索引损坏 → 句柄遗留 → 删除失败 → 重建失败 → 服务起不来。

## 三、根因

| 层级 | 根因 | 影响 |
| --- | --- | --- |
| 直接原因 | 8000 端口被旧代码后端进程常驻占用（uvicorn 无 `--reload`，内存中是没有 `/api/workspace/create` 路由的旧版本） | 新建工作区请求命中 404 |
| 深层原因 | `workspace\.knowledgeeditor\index.db` 页损坏（只读正常、写入即 `malformed`） | 新后端启动时全量重建索引崩溃，服务无法启动 |
| 次生缺陷 | `IndexStore.connect()` 初始化失败时遗留 SQLite 连接句柄（Windows 文件锁） | 自愈逻辑删除损坏文件失败，二次连接仍读到坏文件 |

Markdown 为唯一事实源、SQLite 仅作索引的架构在此次事件中起到了关键作用：索引文件损坏不损失任何用户数据，6 个文档可完整重建。

## 四、修复内容

1. **终止旧后端进程**，用项目 `.venv` 重启最新代码（`Application startup complete`）。损坏的 `index.db` 已备份后由新逻辑自动丢弃重建，6 个文档与标签全部恢复。
2. **索引损坏自愈**（`backend/app/routers/workspace.py`）：`_open_index` 捕获 `sqlite3.DatabaseError`，关闭连接后删除主库及 `-wal`/`-shm` 文件，干净重建。索引是派生数据，损坏不应阻塞工作区打开，这是对「保留全量重建索引能力」设计约束的落实。
3. **连接句柄修复**（`backend/app/store/db.py`）：`connect()` 初始化失败时关闭已创建的连接再重抛，确保调用方删除损坏文件不被 Windows 文件锁阻塞。
4. **回归测试**（`backend/tests/test_workspace_mgmt.py`）：新增 `test_open_workspace_with_corrupt_index_recovers`，写入无效 SQLite 文件后打开工作区，断言自动重建成功、Markdown 数据与标签无损、损坏文件被有效索引替换。

## 五、验证结果

| 验证项 | 结果 |
| --- | --- |
| 后端 pytest 全套 | 78/78 通过（新增损坏索引自愈测试 1 项） |
| 重建恢复 | 6 个文档 + 标签全部恢复，文件树正常 |
| 创建工作区 | `POST /api/workspace/create` 返回 201，最近列表记录正确 |
| 中文路径全链路 | 中文目录、中文文档创建、文件树、最近列表全部正常 |

排查中另有一个易混淆现象：用 PowerShell 发送中文路径的创建请求时返回 500（`WinError 123`，路径被转成 `??-?????`）。这是 PowerShell 5 `ConvertTo-Json` 按 ANSI 编码发送导致的测试命令问题，浏览器前端以 UTF-8 发送不受影响；改用 Python 脚本以 UTF-8 验证中文路径后全链路通过，应用本身对中文路径无缺陷。

## 六、复盘与建议

这次问题的直接触发点是进程与代码版本不一致，深层隐患是索引损坏时服务完全不可用。两条改进方向：

1. **开发期使用 `uvicorn --reload` 启动**，代码变更自动重载，从源头避免「前端新、后端旧」的进程错位。已在报告中记录该操作方式。
2. **索引自愈是架构要求的自然延伸**：既然 SQLite 只是派生索引、Markdown 是唯一事实源，索引损坏就应该降级为「自动重建」而非「服务不可用」。后续可考虑在健康检查中加入索引完整性探测，提前暴露损坏风险。
