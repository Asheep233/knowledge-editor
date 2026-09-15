"""回收站 API（2026-09-15 立项，MVP 仅文档）。

契约见 ``docs/design-trash-mvp.md`` §3：
``GET /api/trash`` · ``POST /api/trash/restore`` · ``DELETE /api/trash/{id}`` · ``DELETE /api/trash``
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..services import trash

router = APIRouter(prefix="/api/trash", tags=["trash"])


class RestoreBody(BaseModel):
    id: str


def _root(request: Request) -> Path:
    root = getattr(request.app.state, "workspace_root", None)
    if root is None:
        raise HTTPException(status_code=409, detail="未打开工作区")
    return root


@router.get("")
def list_trash(request: Request) -> dict:
    """回收站条目（按删除时间倒序）。"""
    items = trash.list_items(_root(request))
    return {"count": len(items), "items": items}


@router.post("/restore")
def restore_trash(request: Request, body: RestoreBody) -> dict:
    """恢复到原路径；冲突自动改名（``-1``/``-2``…），绝不覆盖。"""
    root = _root(request)
    try:
        rel, renamed = trash.restore(root, body.id)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法条目 id 或条目内容不在文档白名单内")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="条目不存在")
    except FileExistsError:
        # 去重后缀 1000 次耗尽（契约 §5 明确为 409，不得冒泡成 500）
        raise HTTPException(status_code=409, detail="同名文件过多，无法恢复")
    # 恢复即新增文件：重建索引（与 delete 的 update_file 对称）
    request.app.state.indexer.update_file(rel)
    return {"id": body.id, "restored_to": rel, "renamed": renamed}


@router.delete("/{id}", status_code=204)
def purge_trash(request: Request, id: str) -> None:
    """彻底删除单个条目（不可恢复）。路径参数名与契约 §3 的 ``{id}`` 保持一致。"""
    try:
        trash.purge(_root(request), id)
    except ValueError:
        raise HTTPException(status_code=400, detail="非法条目 id")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="条目不存在")


@router.delete("", status_code=204)
def clear_trash(request: Request) -> None:
    """清空回收站（幂等）。"""
    trash.clear(_root(request))
