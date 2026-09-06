import hashlib, json, os
from datetime import datetime, timezone
root = r'D:\KE Project\knowledge-editor'
binDir = os.path.join(root, 'desktop', 'src-tauri', 'binaries')
distDir = os.path.join(root, 'frontend', 'dist-build')
manifest = {'schemaVersion': 1, 'built_at': datetime.now(timezone.utc).isoformat(), 'artifacts': []}
sumLines = []
def add(p, rel):
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    manifest['artifacts'].append({'path': rel, 'size': os.path.getsize(p), 'sha256': h})
    sumLines.append(h + '  ' + rel)
for f in os.listdir(binDir):
    if f.startswith('knowledgeeditor-backend-') and f.endswith('.exe'):
        add(os.path.join(binDir, f), 'desktop/src-tauri/binaries/' + f)
for dp, _, fs in os.walk(distDir):
    for f in fs:
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        add(p, rel)
with open(os.path.join(binDir, 'versions.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=4)
with open(os.path.join(binDir, 'manifest.sha256'), 'w') as f:
    f.write('\n'.join(sumLines) + '\n')
print('artifacts:', len(manifest['artifacts']))
print('sidecar sha[:16]:', manifest['artifacts'][0]['sha256'][:16])
