"""Reproduce workspace-context boundary schedules using temporary fixtures only.

Run with the backend virtualenv Python from any directory. This is a deterministic
interleaving probe, not a reproduction through the current official UI.
"""
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))


class Indexer:
    def __init__(self):
        self.updated = []

    def update_file(self, relative_path):
        self.updated.append(relative_path)


with tempfile.TemporaryDirectory(prefix='ui-context-probe-') as temporary:
    root = Path(temporary)
    os.environ['KE_WORKSPACE'] = str(root / 'unused-workspace')
    os.environ['KE_APP_CONFIG'] = str(root / 'unused-config.json')
    from app.routers import documents

    first, second = root / 'first', root / 'second'
    for directory, text in [(first, 'first original\n'), (second, 'second original\n')]:
        (directory / 'Articles').mkdir(parents=True)
        (directory / 'Articles/shared.md').write_text(text, encoding='utf-8')
    first_index, second_index = Indexer(), Indexer()
    state = SimpleNamespace(workspace_root=first, indexer=first_index, history=None, watcher=None)
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    original_snapshot = documents._maybe_snapshot

    def concurrent_switch(_request, _relative_path, _new_content):
        # Emulate activate_workspace replacing app.state after path resolution.
        state.workspace_root = second
        state.indexer = second_index

    documents._maybe_snapshot = concurrent_switch
    try:
        documents.update_article(request, 'Articles/shared.md', documents.ArticleUpdate(content='first edited\n'))
    finally:
        documents._maybe_snapshot = original_snapshot
    mixed_context = {
        'first_file_changed': (first / 'Articles/shared.md').read_text(encoding='utf-8') == 'first edited\n',
        'second_file_unchanged': (second / 'Articles/shared.md').read_text(encoding='utf-8') == 'second original\n',
        'first_index_updates': list(first_index.updated),
        'second_index_updates': list(second_index.updated),
    }
    assert mixed_context == {
        'first_file_changed': True, 'second_file_unchanged': True,
        'first_index_updates': [], 'second_index_updates': ['Articles/shared.md'],
    }

    # A queued request cannot express its original workspace in the existing API.
    documents.update_article(request, 'Articles/shared.md', documents.ArticleUpdate(content='queued from first\n'))
    late_write = (second / 'Articles/shared.md').read_text(encoding='utf-8') == 'queued from first\n'
    assert late_write
    print(json.dumps({
        'baseline': 'v1.2.16 9dd19e7, existing backend unmodified',
        'method': 'deterministic context interleaving with temporary fixtures',
        'mixed_context_probe': mixed_context,
        'request_cannot_reject_stale_workspace': late_write,
        'scope': 'backend boundary only; not an official-UI reproduction or concurrency stress test',
    }, ensure_ascii=False, indent=2))
