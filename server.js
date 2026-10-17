// TabProxy - zero-dependency web proxy (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PREFIX = '/proxy?url=';
const jar = new Map(); // host -> Map(cookieName -> value)

const abs = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };
const wrap = (u, base) => {
  if (!u) return u;
  const t = u.trim();
  if (/^(data:|javascript:|mailto:|tel:|#|blob:|about:)/i.test(t)) return u;
  const a = abs(t, base);
  return a ? PREFIX + encodeURIComponent(a) : u;
};

function rewriteCSS(css, base) {
  return css
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, u) => `url(${q}${wrap(u, base)}${q})`)
    .replace(/@import\s+(['"])(.*?)\1/gi, (m, q, u) => `@import ${q}${wrap(u, base)}${q}`);
}

const clientScript = (base) => `<script>(function(){
var BASE=${JSON.stringify(base)};
var P='/proxy?url=';
function px(u){try{if(u==null)return u;u=String(u);if(/^(data:|javascript:|mailto:|tel:|#|blob:|about:)/i.test(u))return u;
if(u.indexOf(P)===0||u.indexOf(location.origin+P)===0)return u;
var a=new URL(u,BASE).href;return /^https?:/i.test(a)?P+encodeURIComponent(a):u;}catch(e){return u;}}
var of=window.fetch;if(of)window.fetch=function(i,o){try{if(typeof i==='string'||i instanceof URL)i=px(i);else if(i&&i.url)i=new Request(px(i.url),i);}catch(e){}return of.call(this,i,o);};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=px(u);return xo.apply(this,arguments);};
var wo=window.open;window.open=function(u){return wo.call(window,px(u));};
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(/^(src|href|action|poster)$/i.test(n))v=px(v);return sa.call(this,n,v);};
[[HTMLImageElement,'src'],[HTMLScriptElement,'src'],[HTMLIFrameElement,'src'],[HTMLSourceElement,'src'],[HTMLMediaElement,'src'],[HTMLLinkElement,'href'],[HTMLAnchorElement,'href']].forEach(function(p){
try{var d=Object.getOwnPropertyDescriptor(p[0].prototype,p[1]);if(!d||!d.set)return;Object.defineProperty(p[0].prototype,p[1],{get:d.get,set:function(v){d.set.call(this,px(v));},configurable:true});}catch(e){}});
['pushState','replaceState'].forEach(function(k){var o=history[k];history[k]=function(s,t,u){try{if(u)BASE=new URL(u,BASE).href;report();}catch(e){}try{return o.call(history,s,t);}catch(e){}};});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');
if(a.target==='_blank'||a.target==='_new'){a.target='_self';}
var n=px(h);if(n!==h)a.setAttribute('href',n);},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.getAttribute)return;
var m=(f.method||'get').toLowerCase();var act=f.getAttribute('action')||BASE;
if(m==='get'){e.preventDefault();var real;try{var raw=act.indexOf(P)===0?decodeURIComponent(act.slice(P.length)):new URL(act,BASE).href;real=new URL(raw,BASE);}catch(x){return;}
new FormData(f).forEach(function(v,k){if(typeof v==='string')real.searchParams.set(k,v);});location.href=P+encodeURIComponent(real.href);}
else{f.setAttribute('action',act);}},true);
function report(){try{parent.postMessage({type:'tp-nav',url:BASE,title:document.title},'*');}catch(e){}}
window.addEventListener('load',report);
new MutationObserver(report).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
report();
})();</script>`;

function rewriteHTML(html, base) {
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/\s(integrity|nonce|crossorigin)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  html = html.replace(/(\s(?:href|src|action|poster|data-src)=)(?:"([^"]*)"|'([^']*)')/gi, (m, attr, d, s) => {
    const v = (d !== undefined ? d : s).replace(/&amp;/g, '&');
    return `${attr}"${wrap(v, base).replace(/"/g, '&quot;')}"`;
  });
  html = html.replace(/(\ssrcset=)(?:"([^"]*)"|'([^']*)')/gi, (m, attr, d, s) => {
    const v = d !== undefined ? d : s;
    const out = v.split(',').map(part => {
      const bits = part.trim().split(/\s+/);
      bits[0] = wrap(bits[0], base);
      return bits.join(' ');
    }).join(', ');
    return `${attr}"${out}"`;
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, c) => a + rewriteCSS(css, base) + c);
  html = html.replace(/(\sstyle=)(?:"([^"]*)"|'([^']*)')/gi, (m, attr, d, s) => `${attr}"${rewriteCSS(d !== undefined ? d : s, base)}"`);
  const script = clientScript(base);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + script);
  return script + html;
}

function cookieHeader(host) {
  const c = jar.get(host);
  if (!c) return undefined;
  return [...c].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(host, setCookies) {
  if (!setCookies || !setCookies.length) return;
  if (!jar.has(host)) jar.set(host, new Map());
  const c = jar.get(host);
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    if (i > 0) c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res) {
  const p = req.url.split('?')[0];
  const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleProxy(req, res, target) {
  const body = await new Promise(r => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });
  const url = new URL(target);
  const headers = {
    'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'accept': req.headers['accept'] || '*/*',
    'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['range']) headers['range'] = req.headers['range'];
  const ck = cookieHeader(url.host);
  if (ck) headers['cookie'] = ck;
  headers['referer'] = url.origin + '/';

  const hasBody = !['GET', 'HEAD'].includes(req.method) && body.length;
  const upstream = await fetch(url, { method: req.method, headers, body: hasBody ? body : undefined, redirect: 'manual' });
  storeCookies(url.host, upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : []);

  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
    res.writeHead(302, { Location: wrap(upstream.headers.get('location'), url.href) });
    return res.end();
  }

  const out = {};
  const skip = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'strict-transport-security', 'connection', 'keep-alive']);
  upstream.headers.forEach((v, k) => { if (!skip.has(k.toLowerCase())) out[k] = v; });
  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await upstream.arrayBuffer());

  if (ct.includes('text/html')) {
    res.writeHead(upstream.status, out);
    return res.end(rewriteHTML(buf.toString('utf8'), url.href));
  }
  if (ct.includes('text/css')) {
    res.writeHead(upstream.status, out);
    return res.end(rewriteCSS(buf.toString('utf8'), url.href));
  }
  res.writeHead(upstream.status, out);
  res.end(buf);
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/proxy') {
      const target = u.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end('Bad url'); }
      return await handleProxy(req, res, target);
    }
    // Fallback: a page requested a root-relative URL that slipped past rewriting
    const ref = req.headers.referer || '';
    const m = ref.match(/\/proxy\?url=([^&]+)/);
    if (m && u.pathname !== '/' && !fs.existsSync(path.join(__dirname, 'public', u.pathname))) {
      const real = abs(u.pathname + u.search, decodeURIComponent(m[1]));
      if (real) { res.writeHead(307, { Location: PREFIX + encodeURIComponent(real) }); return res.end(); }
    }
    serveStatic(req, res);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + e.message);
  }
}).listen(PORT, () => console.log(`TabProxy running at http://localhost:${PORT}`));
