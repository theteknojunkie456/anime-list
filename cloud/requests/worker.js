// A private request board. One person, one passphrase, no accounts.
//
// The passphrase is never stored or compared as a string: PASS_HASH holds a
// SHA-256 of it, and the check is constant-time. A successful login mints an
// HMAC-signed cookie with an expiry inside the signature, so a stolen cookie
// dies on its own and nothing server-side has to be revoked.
const COOKIE = 'wlq';
const TTL = 30 * 24 * 3600 * 1000;   // stay signed in for a month

const enc = new TextEncoder();
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Length-independent, value-independent comparison. Overkill for one user on a
// rate-limited endpoint, but it costs nothing and removes the question.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function mintToken(env) {
  const exp = Date.now() + TTL;
  return `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
}
async function validToken(env, tok) {
  if (!tok || !tok.includes('.')) return false;
  const [exp, sig] = tok.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, exp));
}
function cookieOf(req) {
  const raw = req.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const authed = await validToken(env, cookieOf(req));

    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!env.PASS_HASH || !env.SESSION_SECRET) return json({ error: 'not configured' }, 503);
      let pass = '';
      try { pass = String((await req.json()).pass || ''); } catch {}
      // A wrong guess costs a second. One user never notices; a script does.
      await new Promise((r) => setTimeout(r, 1000));
      if (!safeEqual(await sha256Hex(pass), env.PASS_HASH)) return json({ error: 'wrong passphrase' }, 401);
      const tok = await mintToken(env);
      return json({ ok: true }, 200, {
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(tok)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}`,
      });
    }

    if (url.pathname === '/api/logout' && req.method === 'POST')
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });

    if (url.pathname.startsWith('/api/')) {
      if (!authed) return json({ error: 'unauthorized' }, 401);

      if (url.pathname === '/api/reqs' && req.method === 'GET') {
        const list = await env.REQS.list({ prefix: 'r:' });
        const items = await Promise.all(list.keys.map(async (k) => {
          try { return JSON.parse(await env.REQS.get(k.name)); } catch { return null; }
        }));
        return json({ items: items.filter(Boolean).sort((a, b) => b.at - a.at) });
      }

      if (url.pathname === '/api/reqs' && req.method === 'POST') {
        let b = {};
        try { b = await req.json(); } catch {}
        const title = String(b.title || '').trim().slice(0, 140);
        if (!title) return json({ error: 'title required' }, 400);
        const item = {
          id: crypto.randomUUID(),
          title,
          body: String(b.body || '').slice(0, 4000),
          kind: ['theme', 'feature', 'bug', 'idea', 'other'].includes(b.kind) ? b.kind : 'other',
          status: 'open',
          at: Date.now(),
        };
        await env.REQS.put('r:' + item.at + ':' + item.id, JSON.stringify(item));
        return json({ ok: true, item });
      }

      if (url.pathname === '/api/status' && req.method === 'POST') {
        let b = {};
        try { b = await req.json(); } catch {}
        const status = ['open', 'doing', 'done', 'parked'].includes(b.status) ? b.status : null;
        if (!status || !b.id) return json({ error: 'bad request' }, 400);
        const list = await env.REQS.list({ prefix: 'r:' });
        const key = list.keys.find((k) => k.name.endsWith(':' + b.id));
        if (!key) return json({ error: 'not found' }, 404);
        const item = JSON.parse(await env.REQS.get(key.name));
        item.status = status;
        await env.REQS.put(key.name, JSON.stringify(item));
        return json({ ok: true, item });
      }

      if (url.pathname === '/api/delete' && req.method === 'POST') {
        let b = {};
        try { b = await req.json(); } catch {}
        const list = await env.REQS.list({ prefix: 'r:' });
        const key = list.keys.find((k) => k.name.endsWith(':' + (b.id || '')));
        if (key) await env.REQS.delete(key.name);
        return json({ ok: true });
      }

      return json({ error: 'bad path' }, 404);
    }

    return new Response(PAGE(authed), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Nothing here loads anything external, so say so.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  },
};

const PAGE = (authed) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1214"><title>Requests</title>
<style>
:root{--bg:#0f1214;--panel:#171b1f;--sunk:#0b0e10;--ink:#e7ebed;--ink2:#9faab2;--ink3:#6f7a82;
 --rule:#262d32;--accent:#59b398;--warn:#c98470;--r:13px;
 --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
 --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#eef0f2;--panel:#fff;--sunk:#e3e7ea;--ink:#12161a;
 --ink2:#495259;--ink3:#79838b;--rule:#d2d8dd;--accent:#2a6b5a;--warn:#9e5340}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;
 padding:0 20px calc(env(safe-area-inset-bottom,0) + 56px)}
.wrap{max-width:720px;margin:0 auto}
header{display:flex;align-items:baseline;gap:12px;padding:38px 0 20px;border-bottom:1px solid var(--rule)}
h1{font-size:23px;letter-spacing:-.02em;margin:0;font-weight:700}
header .sub{font-family:var(--mono);font-size:11px;color:var(--ink3);letter-spacing:.05em;text-transform:uppercase}
header button{margin-left:auto}
button{font:inherit;cursor:pointer;border-radius:99px;border:1px solid var(--rule);
 background:var(--panel);color:var(--ink);padding:7px 14px;font-size:13px}
button.primary{background:var(--accent);border-color:transparent;color:#06110d;font-weight:700}
@media(prefers-color-scheme:light){button.primary{color:#fff}}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
form{display:grid;gap:10px;padding:22px 0}
input,textarea,select{font:inherit;width:100%;background:var(--sunk);color:var(--ink);
 border:1px solid var(--rule);border-radius:var(--r);padding:11px 13px}
textarea{min-height:96px;resize:vertical}
.row{display:flex;gap:10px}.row select{flex:0 0 132px}.row button{flex:0 0 auto}
.err{color:var(--warn);font-size:13px;min-height:19px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:0}
li{border-top:1px solid var(--rule);padding:15px 0;display:grid;gap:5px}
.t{font-weight:650;letter-spacing:-.01em}
.b{color:var(--ink2);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.m{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:var(--mono);font-size:10.5px;
 color:var(--ink3);letter-spacing:.04em;text-transform:uppercase}
.pill{padding:2px 7px;border-radius:5px;border:1px solid var(--rule)}
.s-open{color:var(--accent);border-color:currentColor}
.s-doing{color:#d3a24c;border-color:currentColor}
.s-done{color:var(--ink3);text-decoration:line-through}
.s-parked{color:var(--ink3)}
.m .sp{margin-left:auto;display:flex;gap:6px}
.m button{padding:3px 9px;font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.04em}
.empty{color:var(--ink3);padding:34px 0;text-align:center;font-size:14px}
.login{max-width:340px;margin:16vh auto 0;display:grid;gap:12px}
.login h1{text-align:center}.login p{text-align:center;color:var(--ink3);font-size:13px;margin:0}
</style></head><body><div class="wrap">
${authed ? `
<header><h1>Requests</h1><span class="sub">private</span>
  <button onclick="logout()">Sign out</button></header>
<form onsubmit="return add(event)">
  <input id="title" placeholder="What do you want?" maxlength="140" autocomplete="off" required>
  <textarea id="body" placeholder="Any detail — colours, behaviour, where it goes. Optional." maxlength="4000"></textarea>
  <div class="row">
    <select id="kind">
      <option value="feature">Feature</option><option value="theme">Theme</option>
      <option value="bug">Bug</option><option value="idea">Idea</option><option value="other">Other</option>
    </select>
    <button class="primary" type="submit" style="flex:1">Add request</button>
  </div>
  <div class="err" id="err" role="status"></div>
</form>
<ul id="list"></ul>
<div class="empty" id="empty" hidden>Nothing yet. The box above is the whole app.</div>
<script>
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>{const d=Math.floor((Date.now()-t)/86400000);
  return d<1?'today':d===1?'yesterday':d<30?d+'d ago':new Date(t).toLocaleDateString();};
async function api(p,o){const r=await fetch(p,o);if(r.status===401){location.reload();return null}return r.json()}
async function load(){
  const d=await api('/api/reqs');if(!d)return;
  const items=d.items||[];
  $('#empty').hidden=items.length>0;
  $('#list').innerHTML=items.map(i=>\`<li>
    <div class="t">\${esc(i.title)}</div>
    \${i.body?\`<div class="b">\${esc(i.body)}</div>\`:''}
    <div class="m"><span class="pill">\${esc(i.kind)}</span>
      <span class="pill s-\${esc(i.status)}">\${esc(i.status)}</span>
      <span>\${when(i.at)}</span>
      <span class="sp">
        \${['open','doing','done','parked'].filter(s=>s!==i.status)
            .map(s=>\`<button onclick="setStatus('\${i.id}','\${s}')">\${s}</button>\`).join('')}
        <button onclick="del('\${i.id}')">delete</button>
      </span></div></li>\`).join('');
}
async function add(e){
  e.preventDefault();
  const title=$('#title').value.trim();if(!title)return false;
  $('#err').textContent='';
  const d=await api('/api/reqs',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title,body:$('#body').value,kind:$('#kind').value})});
  if(d&&d.error){$('#err').textContent=d.error;return false}
  $('#title').value='';$('#body').value='';load();return false;
}
async function setStatus(id,status){await api('/api/status',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})});load()}
async function del(id){await api('/api/delete',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});load()}
async function logout(){await fetch('/api/logout',{method:'POST'});location.reload()}
load();
</script>` : `
<div class="login">
  <h1>Requests</h1>
  <p>Private. Enter the passphrase.</p>
  <form onsubmit="return go(event)">
    <input id="pass" type="password" placeholder="Passphrase" autocomplete="current-password" required autofocus>
    <button class="primary" type="submit" style="width:100%">Enter</button>
    <div class="err" id="err" role="status"></div>
  </form>
</div>
<script>
async function go(e){
  e.preventDefault();
  const err=document.getElementById('err');err.textContent='Checking\\u2026';
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pass:document.getElementById('pass').value})});
  const d=await r.json().catch(()=>({}));
  if(d.ok)location.reload(); else err.textContent=d.error||'Try again';
  return false;
}
</script>`}
</div></body></html>`;
