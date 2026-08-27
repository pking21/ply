# Hidden Link Generator

A small Node.js app that turns any direct video URL (archive.org, direct .mp4, etc.)
into a real, shareable short link like `https://yourdomain.com/v/AbC12345`, plus
ready-to-paste `<iframe>` embed code.

The original video URL is **never exposed** in the page source — the server proxies
the video bytes through `/stream/:id`, so viewers and "view source" only ever see
your own domain.

## What's inside

```
hidden-link-app/
├── server.js        # Express server: API, player page, proxy streaming
├── public/
│   └── index.html   # The form UI (the one in your screenshot)
├── links.db          # SQLite database (auto-created on first run)
├── package.json
└── README.md
```

## Run it locally

```bash
npm install
node server.js
```

Then open **http://localhost:3000** in your browser, fill the form, and click
**GENERATE LINK**.

## How it works

1. `POST /api/generate` — validates the video URL, saves `{url, poster, player}`
   to SQLite under a random 8-character ID, and returns:
   - `link`: `https://yourdomain.com/v/<id>`
   - `embedCode`: a ready `<iframe>` snippet
2. `GET /v/:id` — serves a minimal player page (HTML5 video / Plyr / ArtPlayer)
   that points its `<source>` at `/stream/:id`, **not** the real URL.
3. `GET /stream/:id` — looks up the real URL and proxies it through your server,
   forwarding `Range` headers so seeking/scrubbing still works.

## Deploying so the link works for anyone (not just your machine)

Pick whichever you're most comfortable with:

### Option A — Render.com (free tier, easiest)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Deploy. Render gives you a public URL like `https://your-app.onrender.com` —
   that's now your base link (`https://your-app.onrender.com/v/AbC12345`).

### Option B — Railway.app
1. Push to GitHub, then **New Project → Deploy from GitHub repo** on
   [railway.app](https://railway.app).
2. Railway auto-detects Node and runs `npm install && node server.js`.
3. Generate a public domain from the service settings.

### Option C — Your own VPS (DigitalOcean, EC2, etc.)
```bash
git clone <your-repo>
cd hidden-link-app
npm install
npm install -g pm2        # keeps the server alive after you disconnect
pm2 start server.js --name hidden-link
```
Put Nginx or Caddy in front for HTTPS and your own domain.

> **Note on the database:** SQLite (`links.db`) is a single file — fine for
> personal or low-traffic use. Render/Railway free tiers may reset the
> filesystem on redeploy, which would wipe old links. For links that must
> survive redeploys, swap in a hosted database (e.g. Postgres via Supabase/Neon)
> — ask me and I can adapt the code.

## Security notes before making this public

- The server fetches whatever URL you give it (`/stream/:id` proxies it). A basic
  guard already blocks obvious internal addresses (`localhost`, `10.x`, `192.168.x`,
  etc.), but if you expose this publicly to *other* people (not just yourself),
  consider adding: an allowlist of trusted source domains, rate limiting, and a
  max-file-size/timeout on the proxy fetch.
- There's no authentication on `/api/generate` — anyone with access to the form
  can create links. Add a login or API key if this will be public-facing.
