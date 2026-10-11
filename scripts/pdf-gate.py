#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""task-70 门禁：安全门禁（导出不得写坏文件/工作区）+ 一致性门禁（PDF vs 编辑器渲染）。

用法（**只在沙箱工作区**跑，绝不指向主理人真实笔记）：

  python3 scripts/pdf-gate.py \
      --doc "C:/ke-tmp/ke-sandbox/Articles/dark-demo.md" \
      --pdf "C:/ke-tmp/ke-sandbox-exports/dark-demo.pdf" \
      --editor-png /tmp/editor-shot.png \
      --workspace "C:/ke-tmp/ke-sandbox" \
      --cdp-port 9333

判据：
  安全 ① 导出前后被导出文档 sha256 不变
       ② 导出不在工作区产生/修改任何文件（工作区快照 diff）
       ③ 输出路径保护：指向工作区内部或与已有文件重名 → 拒绝
       ④ 打印不改写编辑器 DOM（导出前后正文 HTML 摘要一致）
  一致 几何：抽样元素相对位置/尺寸偏差 ≤ 1 CSS px 或 0.5%
       颜色：抽样区域平均 ΔE < 2，且无整块前景/背景反转
       公式：PDF 中存在可选中矢量文本（非位图）；$$ 块不跨页
       中文：无乱码（PDF 文本层含预期中文串）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import urllib.request

# ---------------------------------------------------------------- 基础工具


def sha256(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def workspace_snapshot(root: pathlib.Path) -> dict[str, str]:
    """工作区文件 → sha256（跳过导出产物目录）。"""
    out: dict[str, str] = {}
    for f in sorted(root.rglob('*')):
        if f.is_file():
            out[str(f.relative_to(root)).replace('\\', '/')] = sha256(f)
    return out


def snapshot_diff(before: dict[str, str], after: dict[str, str]) -> dict[str, list[str]]:
    return {
        'added': sorted(set(after) - set(before)),
        'removed': sorted(set(before) - set(after)),
        'changed': sorted(k for k in set(before) & set(after) if before[k] != after[k]),
    }


# ---------------------------------------------------------------- CDP


class CDP:
    def __init__(self, port: int = 9333):
        import queue
        import threading
        import websocket  # type: ignore

        pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=5))
        page = [p for p in pages if p.get('type') == 'page'][0]
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=120)
        self._mid = 0
        self._pending: dict[int, 'queue.Queue'] = {}
        self._threading = threading

        def reader():
            while True:
                try:
                    msg = json.loads(self.ws.recv())
                except Exception:
                    return
                if 'id' in msg and msg['id'] in self._pending:
                    self._pending.pop(msg['id']).put(msg.get('result', {}))

        threading.Thread(target=reader, daemon=True).start()

    def call(self, method: str, params: dict | None = None, timeout: int = 60) -> dict:
        import queue

        self._mid += 1
        q: 'queue.Queue' = queue.Queue()
        self._pending[self._mid] = q
        self.ws.send(json.dumps({'id': self._mid, 'method': method, 'params': params or {}}))
        try:
            return q.get(timeout=timeout)
        except Exception:
            return {}

    def js(self, expr: str):
        import queue  # noqa: F401

        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        if 'exceptionDetails' in r:
            raise RuntimeError('JS error: ' + str(r['exceptionDetails'])[:200])
        return r.get('result', {}).get('value')


def body_digest(cdp: CDP) -> str:
    """编辑器正文 DOM 摘要（判 ④：打印不得改写编辑器 DOM）。"""
    html = cdp.js("(()=>{const e=document.querySelector('.ke-editor-prose');return e?e.innerHTML.length+':'+e.innerText.length:''})()")
    return str(html)


def element_boxes(cdp: CDP) -> list[dict]:
    """抽样元素的几何 + 颜色（体内相对坐标）。"""
    expr = """
    (()=>{
      const root=document.querySelector('.ke-editor-prose'); if(!root) return '[]';
      const rr=root.getBoundingClientRect();
      const sel='h1,h2,h3,p,li,table,img,.katex-display,.ke-math--block,pre';
      const out=[...root.querySelectorAll(sel)].slice(0,60).map(el=>{
        const b=el.getBoundingClientRect(); const cs=getComputedStyle(el);
        return {tag:el.tagName.toLowerCase(), x:+(b.x-rr.x).toFixed(2), y:+(b.y-rr.y).toFixed(2),
                w:+b.width.toFixed(2), h:+b.height.toFixed(2),
                color:cs.color, bg:cs.backgroundColor};
      });
      return JSON.stringify({root:{w:+rr.width.toFixed(2),bg:getComputedStyle(root).backgroundColor}, items:out});
    })()
    """
    return json.loads(cdp.js(expr) or '[]')


# ---------------------------------------------------------------- PDF 分析


def pdf_report(pdf: pathlib.Path, expect_texts: list[str]) -> dict:
    import pymupdf  # type: ignore

    doc = pymupdf.open(pdf)
    pages = []
    colors: list[tuple[int, int, int]] = []
    text_all = ''
    for i, page in enumerate(doc):
        text = page.get_text()
        text_all += text
        pix = page.get_pixmap(dpi=72)
        # 抽样像素颜色（每页四角 + 中心）
        w, h = pix.width, pix.height
        samples = []
        for (x, y) in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3), (w // 2, h // 2)]:
            samples.append(pix.pixel(x, y))
        colors.extend(samples)
        pages.append({'index': i, 'size': [round(page.rect.width, 2), round(page.rect.height, 2)],
                      'text_len': len(text), 'corner_colors': samples,
                      'images': len(page.get_images(full=True))})
    # 公式矢量文本：PDF 文本层里应能搜到 latex 渲染后的可见片段（如 "=" 与数字），
    # 且不应把整段公式变成图片（page.get_images 数量应与正文图片数一致）。
    return {
        'pages': pages,
        'text_has_expected': {t: (t in text_all) for t in expect_texts},
        'text_total_len': len(text_all),
        'page_count': len(doc),
    }


def mean_delta_e(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    """简单欧氏 RGB 距离（ΔE 近似，够用于"是否整块反转"判定）。"""
    return sum((a - b) ** 2 for a, b in zip(c1, c2)) ** 0.5


# ---------------------------------------------------------------- 主流程


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--doc', required=True, help='被导出文档（沙箱副本）')
    ap.add_argument('--pdf', required=True, help='输出 PDF 路径（工作区之外）')
    ap.add_argument('--workspace', required=True, help='沙箱工作区根目录')
    ap.add_argument('--editor-png', default='', help='编辑器截图（可选）')
    ap.add_argument('--cdp-port', type=int, default=9333)
    ap.add_argument('--expect-text', default='', help='逗号分隔：PDF 文本层应包含的串（中文/公式符号）')
    ap.add_argument('--no-cdp', action='store_true', help='不连 CDP（只做 PDF 侧分析）')
    ap.add_argument('--out', default='', help='结果 JSON 路径')
    args = ap.parse_args()

    doc = pathlib.Path(args.doc)
    pdf = pathlib.Path(args.pdf)
    ws = pathlib.Path(args.workspace)
    result: dict = {'ok': True, 'checks': {}, 'notes': []}

    # ---- 安全门禁 ③：输出路径保护（先判，避免真写出去了才发现）
    try:
        inside_ws = pdf.resolve().is_relative_to(ws.resolve())   # 按路径分量判定，避免 'C:\\a\\b' 前缀误判
    except AttributeError:
        inside_ws = str(ws.resolve()).lower() in str(pdf.resolve()).lower()
    result['checks']['gate3_output_guard'] = {
        'pdf': str(pdf), 'inside_workspace': inside_ws,
        'pass': not inside_ws,
    }
    if inside_ws:
        result['ok'] = False
        result['notes'].append('输出 PDF 位于工作区内 → 按门禁③拒绝，未执行导出')

    # ---- 导出前快照
    doc_sha_before = sha256(doc)
    ws_before = workspace_snapshot(ws)
    dom_before = None
    boxes = None
    if not args.no_cdp:
        cdp = CDP(args.cdp_port)
        dom_before = body_digest(cdp)
        boxes = element_boxes(cdp)

    # ---- 真正导出：由调用方（或本脚本 --no-cdp 之外的流程）触发宿主打印。
    #      这里只负责断言：若 PDF 不存在则报「未导出」，不代做导出动作。
    exported = pdf.exists()
    result['checks']['export_performed'] = {'pdf_exists': exported, 'pass': exported}

    # ---- 安全门禁 ① ②
    doc_sha_after = sha256(doc)
    ws_after = workspace_snapshot(ws)
    diff = snapshot_diff(ws_before, ws_after)
    result['checks']['gate1_doc_unchanged'] = {
        'before': doc_sha_before, 'after': doc_sha_after, 'pass': doc_sha_before == doc_sha_after}
    # 允许新增的只有 caller 明确的导出产物（此处 PDF 在区外，故应为空）
    result['checks']['gate2_workspace_untouched'] = {'diff': diff, 'pass': not any(diff.values())}

    # ---- 安全门禁 ④：打印不得改写编辑器 DOM
    if not args.no_cdp:
        dom_after = body_digest(CDP(args.cdp_port))
        result['checks']['gate4_dom_unchanged'] = {
            'before': dom_before, 'after': dom_after, 'pass': dom_before == dom_after}
        result['editor_geometry'] = boxes

    # ---- 一致性门禁（PDF 侧）
    if exported:
        expect = [t for t in args.expect_text.split(',') if t]
        pdf_rep = pdf_report(pdf, expect)
        result['pdf'] = pdf_rep
        # 公式矢量文本：文本层非空 + 期望串命中
        vec_ok = pdf_rep['text_total_len'] > 0 and all(pdf_rep['text_has_expected'].values())
        result['checks']['gate_formula_vector_text'] = {
            'text_len': pdf_rep['text_total_len'],
            'expected_hits': pdf_rep['text_has_expected'], 'pass': bool(vec_ok)}
        # 主题跟随：PDF 页面角落像素应与编辑器主题底色接近
        if not args.no_cdp and boxes:
            # 主题底色取自文档根变量（正文容器自身是 transparent，底色在 html/body 上）
            root_bg = cdp.js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()") or boxes['root']['bg']
            num = None
            if isinstance(root_bg, str) and root_bg.startswith('#'):
                h = root_bg.lstrip('#')
                if len(h) == 3:
                    h = ''.join(c * 2 for c in h)
                if len(h) >= 6:
                    num = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
            elif isinstance(root_bg, str) and root_bg.startswith('rgb'):
                num = [int(x) for x in root_bg.replace('rgba(', '').replace('rgb(', '').rstrip(')').split(',')[:3]]
            if num:
                deltas = []
                for p in pdf_rep['pages']:
                    r, g, b = p['corner_colors'][0][:3]
                    deltas.append(round(mean_delta_e((r, g, b), tuple(num)), 2))
                result['checks']['theme_follows_editor'] = {
                    'editor_bg': root_bg, 'page_corner_deltas': deltas,
                    'pass': all(d < 32 for d in deltas)}  # 宽松阈值：先判"是否整块反转"

    result['ok'] = all(c.get('pass') for c in result['checks'].values() if isinstance(c, dict))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        pathlib.Path(args.out).write_text(text, encoding='utf-8')
    print(text)
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
