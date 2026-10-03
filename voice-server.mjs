// Optional dev server for REPS voice pitch practice. Requires Node 20.12+, no dependencies.
// Serves the static site and exposes GET /api/voice/signed-url, so a *private* ElevenLabs
// agent can be used without exposing the API key to the browser.
//
// Put your ElevenLabs settings in demo-reps/.env (copy .env.example), then:
//   node voice-server.mjs
//   open http://localhost:8787/demo.html
//
// .env values:
//   ELEVENLABS_AGENT_ID  required. With only this, the page connects to the agent directly (public agent).
//   ELEVENLABS_API_KEY   optional. With it, the page gets a short-lived signed URL instead, so the
//                        agent can be private. The key stays on the server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env file: rely on the shell environment */ }
const PORT = Number(process.env.PORT || 8787);
const { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } = process.env;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/voice/signed-url') {
    if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID' }));
    }
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(await r.text());
  }

  // Hand the page its config from .env: signed URLs if there is an API key, else the public agent ID.
  if (url.pathname === '/voice-config.js' && ELEVENLABS_AGENT_ID) {
    const cfg = ELEVENLABS_API_KEY ? { signedUrlEndpoint: '/api/voice/signed-url' } : { agentId: ELEVENLABS_AGENT_ID };
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(`window.REPS_VOICE_CONFIG=${JSON.stringify(cfg)};`);
  }

  const path = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  // Never serve dotfiles (.env, .git, …).
  if (!path.startsWith(ROOT) || /(^|[\\/])\./.test(path.slice(ROOT.length))) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`REPS voice server on http://localhost:${PORT}/demo.html`);
  console.log(ELEVENLABS_AGENT_ID ? `ElevenLabs agent ${ELEVENLABS_AGENT_ID} (${ELEVENLABS_API_KEY ? 'private, signed URLs' : 'public'})` : 'No ELEVENLABS_AGENT_ID in .env: paste the agent ID on the call screen instead.');
});
