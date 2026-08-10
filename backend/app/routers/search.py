"""全文搜索：SQLite FTS5 trigram，中文子串匹配。"""
from fastapi import APIRouter, Query, Request

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(
    request: Request,
    q: str = Query(..., min_length=1, description="搜索关键词"),
    limit: int = Query(50, ge=1, le=200),
) -> dict:
    results = request.app.state.store.search(q, limit=limit)
    return {"query": q, "count": len(results), "results": results}
