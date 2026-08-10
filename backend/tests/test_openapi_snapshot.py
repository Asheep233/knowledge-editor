"""OpenAPI 端点快照（Phase 7 M2，P10）。

冻结契约：路径集合必须与 Phase 6E 基线一致（36 个路径、42 个方法端点，
含 1 处增量扩展 `DELETE /api/attachments/{rel_path}`）。
任何新增/删除/改名都会使本测试失败并列出差异，防止侧车打包过程误动 API。
"""

from __future__ import annotations

# 基线快照：GET /openapi.json 的 paths 键（排序后与下方断言比较）。
# 由 2026-08-10（v0.7.3）从 app.openapi() 提取，作为冻结依据。
SNAPSHOT_PATHS = [
    "/api/articles",
    "/api/articles/{article_id}",
    "/api/articles/{article_id}/meta",
    "/api/attachments",
    "/api/attachments/list",
    "/api/attachments/orphans",
    "/api/attachments/{rel_path}",
    "/api/drafts/recovery",
    "/api/drafts/recovery/restore",
    "/api/drafts/recovery/{doc_path}",
    "/api/export/package",
    "/api/fs/dir",
    "/api/fs/doc",
    "/api/fs/events",
    "/api/fs/move",
    "/api/health",
    "/api/history/list",
    "/api/history/preview",
    "/api/history/restore",
    "/api/import/markdown",
    "/api/import/package",
    "/api/index/rebuild",
    "/api/modules",
    "/api/modules/{module_path}",
    "/api/search",
    "/api/tags",
    "/api/tags/{tag_name}",
    "/api/tree",
    "/api/workspace/close",
    "/api/workspace/create",
    "/api/workspace/current",
    "/api/workspace/info",
    "/api/workspace/init",
    "/api/workspace/open",
    "/api/workspace/recent",
    "/api/workspace/recent-documents",
]


def test_openapi_path_snapshot(client):
    """端点路径集合与冻结基线一致；差异须显式评审（Phase 7 不再新增/修改 API）。"""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    paths = sorted(resp.json()["paths"].keys())

    missing = sorted(set(SNAPSHOT_PATHS) - set(paths))
    added = sorted(set(paths) - set(SNAPSHOT_PATHS))
    assert not missing, f"基线端点缺失（被移除或改名）: {missing}"
    assert not added, f"新增端点未纳入冻结契约: {added}"
    assert paths == SNAPSHOT_PATHS


def test_openapi_method_count(client):
    """方法端点总数与基线一致。

    注：phase7-plan.md 引用的「42 端点」为 Phase 6E 冻结检查的业务口径
    （不含辅助端点且按业务操作统计）；OpenAPI 实测方法数为 47（含
    /api/workspace/info、/api/workspace/init 等辅助端点的方法）。
    此处以 OpenAPI 实测为冻结基线，防止侧车打包过程误动 API。
    """
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    methods = sum(
        len([m for m in item if m in {"get", "post", "put", "delete", "patch"}])
        for item in resp.json()["paths"].values()
    )
    assert methods == 47, f"方法端点数偏离实测基线 47，实际 {methods}"
