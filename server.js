const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Database ----------
const db = new Database(path.join(__dirname, 'links.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    poster TEXT,
    player TEXT NOT NULL DEFAULT 'html5',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertStmt = db.prepare(
  'INSERT INTO links (id, url, poster, player) VALUES (?, ?, ?, ?)'
);
const getStmt = db.prepare('SELECT * FROM links WHERE id = ?');

// ---------- Basic SSRF guard ----------
// Blocks obviously-internal hosts. Not exhaustive — see README for
// production hardening advice (DNS-rebind protection, allowlists, etc).
function isBlockedHost(hostname) {
  const blocked = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
  ];
  if (blocked.includes(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

function isValidVideoUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (isBlockedHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API: create a hidden link ----------
app.post('/api/generate', (req, res) => {
  const { url, poster, player } = req.body || {};

  if (!url || !isValidVideoUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http(s) video URL.' });
  }
  if (poster && !isValidVideoUrl(poster)) {
    return res.status(400).json({ error: 'Poster URL looks invalid.' });
  }
  const allowedPlayers = ['html5', 'plyr', 'artplayer'];
  const chosenPlayer = allowedPlayers.includes(player) ? player : 'html5';

  const id = nanoid(8);
  insertStmt.run(id, url, poster || null, chosenPlayer);

  const base = `${req.protocol}://${req.get('host')}`;
  const playLink = `${base}/v/${id}`;
  const embedCode = `<iframe src="${playLink}" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;

  res.json({ id, link: playLink, embedCode });
});

// ---------- Player page (what the hidden link points to) ----------
app.get('/v/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).send(renderNotFound());

  const streamUrl = `/stream/${row.id}`; // proxied — real URL never appears in the HTML
  res.set('Content-Type', 'text/html').send(renderPlayerPage(row.player, streamUrl, row.poster));
});

// ---------- Proxy stream (hides the real origin, supports seeking) ----------
app.get('/stream/:id', async (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).end();

  try {
    const upstreamHeaders = {};
    if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

    const upstream = await fetch(row.url, { headers: upstreamHeaders });

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    if (!upstream.headers.get('accept-ranges')) res.set('Accept-Ranges', 'bytes');

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel().catch(() => {}));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).send('Could not fetch the source video.');
  }
});

// ---------- Templates ----------
function renderPlayerPage(player, streamUrl, poster) {
  const safePoster = poster ? poster.replace(/"/g, '&quot;') : '';
  let head = '';
  let body = '';

  if (player === 'plyr') {
    head = `
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/plyr/3.7.8/plyr.css"/>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/plyr/3.7.8/plyr.min.js"></script>`;
    body = `<video id="p" playsinline controls ${safePoster ? `poster="${safePoster}"` : ''}>
      <source src="${streamUrl}" type="video/mp4">
    </video>
    <script>new Plyr('#p');</script>`;
  } else if (player === 'artplayer') {
    head = `<script src="https://cdnjs.cloudflare.com/ajax/libs/artplayer/5.1.7/artplayer.js"></script>`;
    body = `<div id="art"></div>
    <script>
      new Artplayer({
        container: '#art',
        url: "${streamUrl}",
        ${safePoster ? `poster: "${safePoster}",` : ''}
        volume: 0.8, autoplay: false, pip: true, setting: true,
        fullscreen: true, playbackRate: true,
      });
    </script>`;
  } else {
    body = `<video controls playsinline ${safePoster ? `poster="${safePoster}"` : ''}>
      <source src="${streamUrl}" type="video/mp4">
      Your browser does not support the video tag.
    </video>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>html,body{margin:0;background:#000;height:100%}
  video,#art{width:100%;height:100%;object-fit:contain;background:#000}</style>
  ${head}</head><body>${body}</body></html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title>
  <style>body{background:#0a0a14;color:#9d97c4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
  </head><body>Link not found or has been removed.</body></html>`;
}

app.listen(PORT, () => {
  console.log(`Hidden Link server running on http://localhost:${PORT}`);
});
