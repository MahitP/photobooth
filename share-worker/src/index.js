// Hold it. share links. The site uploads a strip, GIF or video only when the user asks for a QR code;
// the phone that scans it gets a small page with the file and a Save button. Everything expires after 24 h.

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_BYTES = 24 * 1024 * 1024; // KV values max out at 25 MiB
const TTL = 24 * 60 * 60;
const SITE = 'https://photobooth.mahit.dev';
const ALLOWED_ORIGINS = [SITE, 'http://localhost:5173', 'http://127.0.0.1:5173'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = ALLOWED_ORIGINS.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : null;

    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });

    if (url.pathname === '/upload') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      if (!cors) return json({ error: 'forbidden' }, 403); // only the photobooth site may upload
      const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
      const ext = TYPES[type];
      if (!ext) return json({ error: 'unsupported type' }, 415, cors);
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
      const body = await request.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
      const id = randomId(12);
      await env.FILES.put(id, body, { expirationTtl: TTL, metadata: { type, ext } });
      return json({ url: `${url.origin}/f/${id}.${ext}`, expiresAt: Date.now() + TTL * 1000 }, 201, cors);
    }

    let m = url.pathname.match(/^\/raw\/([A-Za-z0-9]{12})$/);
    if (m && request.method === 'GET') {
      const { value, metadata } = await env.FILES.getWithMetadata(m[1], { type: 'stream' });
      if (!value) return gone();
      const download = url.searchParams.has('dl');
      return new Response(value, {
        headers: {
          'Content-Type': metadata.type,
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="hold-it-last-christmas.${metadata.ext}"`,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    m = url.pathname.match(/^\/f\/([A-Za-z0-9]{12})\.(png|jpg|gif|mp4|webm)$/);
    if (m && request.method === 'GET') return page(m[1], m[2]);

    if (url.pathname === '/' || url.pathname === '') return Response.redirect(SITE, 302);
    return gone();
  },
};

function randomId(n) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const SHELL = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Your strip · Hold it.</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&family=Pinyon+Script&display=swap" rel="stylesheet">
<style>
:root{--paper:#f3ece1;--ink:#2a2320;--soft:#6d6058;--red:#9d1c24}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:radial-gradient(120% 70% at 50% 0%,#6d161c,#2b070a 75%);color:var(--ink);font:500 18px/1.45 "Cormorant Garamond",Georgia,serif;display:grid;place-items:center;padding:24px 16px}
main{width:min(440px,100%);background:var(--paper);border-radius:22px;padding:22px 18px 20px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);text-align:center}
h1{font:400 54px/1 "Pinyon Script",cursive;color:var(--red);margin:0 0 4px}p{margin:0 0 14px;color:var(--soft);font-style:italic}
.media{display:block;width:100%;max-height:62dvh;object-fit:contain;border-radius:10px;background:#e8dfd2;margin:6px 0 16px}
.btn{display:block;width:100%;border:0;border-radius:999px;padding:15px 20px;font:600 18px "Cormorant Garamond",serif;background:var(--red);color:#fbf3e8;text-decoration:none;cursor:pointer}
.link{display:inline-block;margin-top:12px;color:var(--soft)}small{display:block;margin-top:14px;color:var(--soft);font-size:14px}
</style></head><body><main>${body}</main></body></html>`;

function page(id, ext) {
  const raw = `/raw/${id}`;
  const isVideo = ext === 'mp4' || ext === 'webm';
  const media = isVideo
    ? `<video class="media" src="${raw}" controls playsinline loop autoplay muted></video>`
    : `<img class="media" src="${raw}" alt="Your photo strip">`;
  const body = `<h1>ta-da!</h1><p>Here's your ${isVideo ? 'video' : ext === 'gif' ? 'live GIF' : 'strip'} from the booth.</p>
${media}
<button class="btn" id="save">Save to this phone</button>
<a class="link" href="${raw}?dl" download>or download the file</a>
<small>This link deletes itself 24 hours after it was made.</small>
<script>
const missing=()=>{document.querySelector('main').innerHTML='<h1>all gone</h1><p>This link has expired. Links last 24 hours.</p><a class="btn" href="${SITE}">Make a new strip</a>'};
document.querySelector('.media').addEventListener('error',missing);
document.getElementById('save').addEventListener('click',async()=>{
  try{const b=await (await fetch('${raw}')).blob();const f=new File([b],'hold-it-last-christmas.${ext}',{type:b.type});
    if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f]});return}}catch(e){if(e.name==='AbortError')return}
  location.href='${raw}?dl';
});
</script>`;
  return new Response(SHELL(body), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer' } });
}

function gone() {
  return new Response(SHELL(`<h1>all gone</h1><p>This link has expired. Links last 24 hours.</p><a class="btn" href="${SITE}">Make a new strip</a>`),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
