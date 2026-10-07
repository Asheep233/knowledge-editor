# 版本与发版策略（2026-10-07 主理人拍板 · 方案 A）

## 一句话
**公开版本按批发**（不再每修一条就发一版）；**内部验证构建用 `x.y.z-dev.N`**，不占正式版本号。

## 1. 公开版本：语义化三段式 `MAJOR.MINOR.PATCH`
| 类型 | 节奏 | 例子 |
|---|---|---|
| **数据丢失 / 安全 / 崩溃** | **立刻发**（不攒批） | 复制公式改错行、保存失败被当成功、XSS、引用误删 |
| **功能缺陷** | 攒 **2–3 条**或 **1–2 天** | 退格横跳、解析错误、快捷键失效 |
| **UI 手感 / 观感** | **攒进下一批**（与上两类合并发） | 按钮难点、编号错位、列对齐 |

- 发布动作：`node scripts/bump-version.mjs x.y.z` → 前端构建 → 侧车 PyInstaller → NSIS → manifest → tag + `gh release create`（正式版 `--latest`）
- 每次发布在 `CHANGELOG_DEV.md` 的「未发布」区整段搬进发布记录；**「未发布」区就是攒批的载体**

## 2. 内部验证构建：`x.y.z-dev.N`
- 生成/递增：`node scripts/dev-version.mjs`（或 `node scripts/dev-version.mjs 1.3.0` 指定基线）
- **不打 tag、不发 Release、不占正式版本号**；只用于「构建 → 真机验证」
- 状态栏会对 dev 构建显示 **`dev` 角标**（`data-testid="dev-build-badge"`），一眼区分「我在看的是临时构建还是已安装的正式版」
- 验证通过后：把 dev 版本还原为当前正式版本（`node scripts/bump-version.mjs <当前正式版>`）再提交其它改动

## 3. 预发布通道（可选）
想让某批修复「先用几天」再正式化：发 `x.y.z-rc.1` 为 **Pre-release**（不算 Latest，不会被当正式版下载）；
观察无问题后发正式 `x.y.z`（`--latest`）。历史上的 `1.2.0-pre.x` 即此模式。

## 4. 硬性约束（沿用）
- 版本号必须经 `scripts/bump-version.mjs`（9 处版本源；手工正则曾把第三方包版本写坏）
- **打包前问主理人**；打包必须核对产物（GUI 在跑会导致 NSIS 静默失败）
- 发版依据：干净 worktree 上的全量门禁（pytest / tsc / vitest / cargo）+ 关键项真机验收；数据类缺陷逐条附「修复前→修复后」实测
- 发版说明必须写「按主理人决策未做」与「已知残留」
