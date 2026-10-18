# P0-S5 原型证据：包 / 私有状态原子事务（T06 部分）

- 日期：2026-10-19
- 代码：`docs/ui-workshop/prototypes/p0/s5_txn/registry.py`（无 UI、纯 Python 标准库 + 可替换存储语义）
- 测试：`test_s5.py`（10 例）；演示：`run_demo.py`
- 平台证据：**U（单元/逻辑）**；Linux WSL 与 **Windows Python 3.14（NTFS）** 双平台实测
- 未验证：真实 Tauri/前端运行时接入、真实包格式（wire/protocol）、Rust 原生指针与安全模式（T17–T20）、真实进程强杀注入（当前用 `os._exit(97)` 模拟提交点断电/强杀）

## 覆盖的事务语义

1. **安装**：ZIP → staging → manifest 校验（schema/id/version/files 声明）→ 路径穿越/绝对路径/未声明文件/单文件与总体积上限（zip bomb 防护）→ 文件 sha256/字节数校验 → **单次 rename** 到不可变 `packages/<id>/<version>/`；同版本不同内容拒绝，相同内容幂等。
2. **私有状态**：每包版本独立 `state/<id>/<version>/private`；激活时从旧状态复制并执行迁移回调；旧状态不被新包污染。
3. **激活**：`journal` → 指针临时文件 fsync → `os.replace(active.json)` → fsync 目录 → 删 journal；包指针与私有状态指针**同一提交点**。
4. **恢复**：重启 `recover()` 依据 journal 与 active.json 判定：已提交 → 完成清理；未提交 → 撤销新状态目录、保留旧指针（旧 UI 继续可用）；staging 清理；损坏指针安全回退官方包。
5. **回滚**：以新事务回到上一包及其匹配私有状态；**Core 笔记 hash 不变**（演示中显式断言）。

## 提交点进程终止用例

| 终止点 | 恢复后状态 | 断言 |
| --- | --- | --- |
| `install:staged` | 未安装，staging 清空 | 半安装不生效 |
| `install:committed` | 已安装，staging 清空 | 已提交内容保留 |
| `activate:journal_written` | 旧指针（旧 UI 可继续） | 未提交激活不生效 |
| `activate:pointer_committed` | 新指针（已持久） | 已提交激活持久 |

## 运行记录（2026-10-19）

```text
# Linux WSL
$ python3 -m pytest docs/ui-workshop/prototypes/p0/s5_txn/test_s5.py -q
..........                                                               [100%]
10 passed in 1.69s

$ python3 docs/ui-workshop/prototypes/p0/s5_txn/run_demo.py
notes: {'note.md': '5d88baa3…e33bb'}
installed/activated: sage@1.0.0
activated v2: sage@2.0.0 (previous: 1.0.0)
health-fail rollback -> current: 1.0.0 previous: 2.0.0
OK: 回滚后包=v1，笔记 hash 未变

# Windows Python 3.14（NTFS）
> python.exe -m pytest docs\ui-workshop\prototypes\p0\s5_txn\test_s5.py -q
..........                                                               [100%]
10 passed in 1.18s
```

## 结论与缺口

- 结论：事务最小语义（不可变安装、单提交点激活、崩溃恢复、回滚不动笔记）在原型的逻辑与文件系统层成立，且 Windows NTFS 上测试通过。
- T06 仍未 `passed`：需要把事务接入真实包格式/运行时（T17–T19）、Rust 原生指针与安全模式（T20）、真实 UI 激活/健康检查/表单交接（W01–W03），并在真实进程强杀下复验。
