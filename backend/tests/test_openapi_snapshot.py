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


# P3-19：schema 签名快照——字段名/类型/required 的改动也会被冻结契约拦截，
# 而不仅是路径集合。签名格式：{schema: [ "{prop}:{type}:{req|opt}", ... ]}
SNAPSHOT_SCHEMAS = {
    "ArticleCreate": ["content:string:opt", "title:string:req"],
    "ArticleMetaUpdate": ["tags:anyOf:array+null:opt", "title:anyOf:null+string:opt"],
    "ArticleOut": [
        "content:string:req",
        "created_at:anyOf:null+string:opt",
        "id:string:req",
        "meta:object:opt",
        "path:string:req",
        "size:anyOf:integer+null:opt",
        "tags:array:opt",
        "title:string:req",
        "updated_at:anyOf:null+string:opt",
        "word_count:anyOf:integer+null:opt",
    ],
    "ArticleUpdate": ["content:string:req", "title:anyOf:null+string:opt"],
    "Body_import_markdown_api_import_markdown_post": ["file:string:req"],
    "Body_import_package_api_import_package_post": ["file:string:req"],
    "Body_upload_attachment_api_attachments_post": ["file:string:req"],
    "DirCreate": ["path:string:req"],
    "DocCreate": ["dir:string:opt", "title:string:req"],
    "ExportPackageReq": ["md:string:req", "refs:array:opt", "title:string:req"],
    "HTTPValidationError": ["detail:array:opt"],
    "HistoryRestoreBody": ["doc_path:string:req", "version_id:string:req"],
    "MoveBody": ["dst:string:req", "src:string:req"],
    "PathBody": ["path:string:req"],
    "RecentDocBody": ["rel_path:string:req", "title:string:opt"],
    "RecoveryCreate": [
        "content:anyOf:null+string:opt",
        "doc_path:string:req",
        "draft_path:string:opt",
        "session_id:string:opt",
    ],
    "RecoveryRestore": ["doc_path:string:req"],
    "RenameBody": ["new_name:string:req", "path:string:req"],
    "ValidationError": [
        "ctx:object:opt",
        "input:obj:opt",
        "loc:array:req",
        "msg:string:req",
        "type:string:req",
    ],
}


def _schema_type(v: dict) -> str:
    """把 OpenAPI schema 的类型表达归一化（供签名比较）。"""
    if not isinstance(v, dict):
        return "obj"
    if v.get("type"):
        return str(v["type"])
    if v.get("$ref"):
        return v["$ref"].split("/")[-1]
    if v.get("anyOf"):
        parts = {
            str(x.get("type") or x.get("$ref", "any").split("/")[-1])
            if isinstance(x, dict) else str(x)
            for x in v["anyOf"]
        }
        return "anyOf:" + "+".join(sorted(parts))
    if v.get("oneOf"):
        parts = {
            str(x.get("type") or x.get("$ref", "any").split("/")[-1])
            if isinstance(x, dict) else str(x)
            for x in v["oneOf"]
        }
        return "oneOf:" + "+".join(sorted(parts))
    if "items" in v:
        return "array:" + _schema_type(v["items"])
    return "obj"


def test_openapi_schema_snapshot(client):
    """请求/响应模型结构与冻结基线一致（字段名/类型/required 变更会被拦截）。"""
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schemas = resp.json().get("components", {}).get("schemas", {})
    sig = {}
    for name, sch in sorted(schemas.items()):
        props = sch.get("properties", {})
        required = set(sch.get("required", []))
        sig[name] = sorted(
            f"{k}:{_schema_type(v)}:{'req' if k in required else 'opt'}"
            for k, v in sorted(props.items())
        )
    assert set(sig.keys()) == set(SNAPSHOT_SCHEMAS.keys()), (
        "schema 集合偏离冻结基线: 新增 "
        f"{sorted(set(sig) - set(SNAPSHOT_SCHEMAS))} / 缺失 "
        f"{sorted(set(SNAPSHOT_SCHEMAS) - set(sig))}"
    )
    diffs = {
        name: {"current": sig[name], "frozen": SNAPSHOT_SCHEMAS[name]}
        for name in sig
        if sig[name] != SNAPSHOT_SCHEMAS[name]
    }
    assert not diffs, f"schema 结构与冻结基线不一致，需显式评审: {diffs}"
