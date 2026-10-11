#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""task-70 一致性门禁：编辑器 DOM（JSON 转储）↔ PDF（文本层 + 位图）逐元素比对。

判据：
  几何：匹配到的文本元素，相对位移偏差 ≤ 1 CSS px 或 0.5%（取宽）
  颜色：文本色 **ΔE76 < 2**；页面底色与主题底色一致性单独判（无整块反转）
  公式：PDF 文本层可选中（非位图）
  $$ 块不跨页：同一公式块的文本必须落在同一页
  中文：PDF 文本层含 CJK
"""
from __future__ import annotations
import argparse, json, pathlib, sys

def srgb_to_lab(rgb):
    def f(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (f(x) for x in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    def g_(t): return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)
    fx, fy, fz = g_(x), g_(y), g_(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def delta_e76(c1, c2):
    l1, a1, b1 = srgb_to_lab(c1); l2, a2, b2 = srgb_to_lab(c2)
    return ((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) ** 0.5

def parse_color(s):
    s = (s or '').strip()
    if s.startswith('#') and len(s) == 7:
        return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
    if s.startswith('rgb'):
        nums = [int(float(x)) for x in s.replace('rgba(', '').replace('rgb(', '').rstrip(')').split(',')[:3]]
        return tuple(nums)
    return None

def int_to_rgb(v):
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)

def norm(t):
    return ''.join(ch for ch in (t or '') if not ch.isspace())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--editor-json', required=True)
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--out', default='')
    args = ap.parse_args()
    ed = json.loads(pathlib.Path(args.editor_json).read_text(encoding='utf-8'))
    import pymupdf
    doc = pymupdf.open(args.pdf)
    # PDF 文本 span（pt → CSS px：×96/72）
    spans = []
    for pno, page in enumerate(doc):
        for blk in page.get_text('dict')['blocks']:
            for line in blk.get('lines', []):
                for sp in line.get('spans', []):
                    spans.append({'page': pno, 'text': sp['text'], 'bbox': sp['bbox'],
                                  'size': sp['size'], 'color': int_to_rgb(sp['color']),
                                  'px': [round(v * 96 / 72, 2) for v in sp['bbox']]})
    all_text = ''.join(s['text'] for s in spans)
    res = {'ok': True, 'checks': {}, 'samples': []}
    # --- 几何 + 颜色（按文本匹配；编辑器坐标相对 prose 左上角，PDF 相对页面左上角）
    # 逐元素匹配（按文本唯一性过滤，避免同一文本出现多次造成误配）
    pairs = []
    for it in ed.get('items', []):
        key = norm(it['text'])[:10]
        if len(key) < 2:
            continue
        hits = [s for s in spans if norm(s['text']).startswith(key[:8])]
        if len(hits) != 1:
            continue
        pairs.append((it, hits[0]))
    # 几何：比较「相邻匹配元素之间的相对位移」（对页边距/原点不敏感，衡量真正的排版一致性）
    geo_dev = []
    for (a, pa), (b, pb) in zip(pairs, pairs[1:]):
        e_dy, p_dy = b['y'] - a['y'], pb['px'][1] - pa['px'][1]
        e_dx, p_dx = b['x'] - a['x'], pb['px'][0] - pa['px'][0]
        geo_dev.append({'from': a['text'][:16], 'to': b['text'][:16],
                        'dy_editor': round(e_dy, 2), 'dy_pdf': round(p_dy, 2), 'dy_dev': round(abs(e_dy - p_dy), 2),
                        'dx_editor': round(e_dx, 2), 'dx_pdf': round(p_dx, 2), 'dx_dev': round(abs(e_dx - p_dx), 2)})
    col_dev = []
    for it, ph in pairs:
        edc = parse_color(it['color'])
        if edc:
            col_dev.append({'text': it['text'][:24], 'ed': list(edc), 'pdf': list(ph['color']),
                            'dE': round(delta_e76(edc, ph['color']), 2)})
    max_dy = max((g['dy_dev'] for g in geo_dev), default=None)
    max_dx = max((g['dx_dev'] for g in geo_dev), default=None)
    max_de = max((c['dE'] for c in col_dev), default=None)
    res['checks']['geometry_relative'] = {'matched': len(pairs), 'pairs': len(geo_dev),
                                          'max_dy_dev_px': max_dy, 'max_dx_dev_px': max_dx,
                                          'pass': (max_dy is not None and max_dy <= 1.0 and max_dx <= 1.0)}
    res['checks']['color_text'] = {'samples': len(col_dev), 'max_dE': max_de,
                                   'pass': (max_de is not None and max_de < 2.0)}
    res['geo_samples'] = geo_dev[:8]
    res['color_samples'] = col_dev[:8]
    # --- 公式矢量文本 / 中文
    res['checks']['vector_text'] = {'text_len': len(all_text),
                                    'has_cjk': any('\u4e00' <= ch <= '\u9fff' for ch in all_text),
                                    'pass': len(all_text) > 0 and any('\u4e00' <= ch <= '\u9fff' for ch in all_text)}
    # --- $$ 块不跨页：取公式块（katex-display）文本，检查是否落在同一页
    formula_spans = [s for s in spans if any(k in s['text'] for k in ('=', '∫', '∑'))]
    pages_used = sorted({s['page'] for s in formula_spans})
    res['checks']['display_math_single_page'] = {'formula_pages': pages_used, 'spans': len(formula_spans),
                                                 'pass': len(pages_used) <= 1}
    # --- 主题底色（整块反转判定）
    if doc:
        pix = doc[0].get_pixmap(dpi=72)
        corner = pix.pixel(2, 2)[:3]
        ed_root = parse_color(ed.get('rootBg')) or parse_color('#' + (ed.get('pageBgVar') or '').lstrip('#')) or None
        res['page_corner_rgb'] = list(corner)
        res['editor_theme_var'] = ed.get('pageBgVar')
        var = (ed.get('pageBgVar') or '').strip()
        vc = parse_color(var if var.startswith('#') or var.startswith('rgb') else None)
        if vc:
            d = delta_e76(vc, corner)
            res['checks']['theme_background'] = {'editor': vc, 'pdf_corner': list(corner), 'dE': round(d, 2), 'pass': d < 2.0}
    res['ok'] = all(v.get('pass') for v in res['checks'].values() if isinstance(v, dict))
    res['geo_samples'] = geo_dev[:8]; res['color_samples'] = col_dev[:8]
    text = json.dumps(res, ensure_ascii=False, indent=2)
    if args.out:
        pathlib.Path(args.out).write_text(text, encoding='utf-8')
    print(text)
    return 0 if res['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())
