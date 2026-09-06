import json, threading, queue, time, urllib.request, base64, sys
import websocket

def connect():
    for attempt in range(30):
        try:
            d = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json'))
            pages = [t for t in d if t.get('type') == 'page']
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('CDP not reachable')

ws_url = connect()
mid = 0
pending = {}
ws = websocket.create_connection(ws_url, timeout=30)

def reader():
    while True:
        try:
            m = json.loads(ws.recv())
        except Exception:
            return
        if 'id' in m and m['id'] in pending:
            pending.pop(m['id']).put(m.get('result', {}))

threading.Thread(target=reader, daemon=True).start()

def js(e):
    global mid
    mid += 1
    q = queue.Queue()
    pending[mid] = q
    ws.send(json.dumps({'id': mid, 'method': 'Runtime.evaluate', 'params': {'expression': e, 'returnByValue': True}}))
    return q.get(timeout=20).get('result', {}).get('value')

def shot(path, clip=None):
    global mid
    mid += 1
    q = queue.Queue()
    pending[mid] = q
    params = {'format': 'png'}
    if clip:
        params['clip'] = clip
    ws.send(json.dumps({'id': mid, 'method': 'Page.captureScreenshot', 'params': params}))
    data = q.get(timeout=30).get('data')
    with open(path, 'wb') as f:
        f.write(base64.b64decode(data))
    return len(data)

# wait editor ready
for _ in range(30):
    if js("!!document.querySelector('.ProseMirror')"):
        break
    time.sleep(1)
print('editor ready:', js("!!document.querySelector('.ProseMirror')"))

# ensure right panel open
js("document.querySelectorAll('button')[0] && (function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===''); return true})()")

# expand right panel if collapsed
state = js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.title && x.title.includes('展开右侧面板')); if(b){b.click(); return 'expanded'} return 'already'})()")
time.sleep(1)
print('right panel:', state)

# verify toolbar icon count (svg in toolbar)
print('toolbar svg icons:', js("document.querySelectorAll('[class*=ProseMirror] ~ * svg').length"))

# check toolbar still renders all buttons
print('toolbar text:', js("(()=>{const b=document.body.innerText; return ['粗体','斜体','引用','行内公式','注释','信息块','模块','表格','附件','撤销','重做'].filter(x=>!b.includes(x))})()"))

# check no emoji remains in toolbar buttons
print('emoji in toolbar:', js("(()=>{const bar=document.querySelector('div.flex.h-\\\\[52px\\\\]'); if(!bar) return 'no bar'; const t=bar.innerText; return [...t].filter(c=>c.codePointAt(0)>0x1F000).join('')})()"))

shot('/mnt/d/KE Project/1b-light.png')
print('shot saved')
