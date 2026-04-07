# 💍 Wedding Live Photo Feed

A zero-friction, Instagram-style live photo feed built on Cloudflare's edge stack.
Guests scan a QR code → instant feed view → tap `+` → upload photos. No app, no login.

---

## Project structure

```
wedding-feed/
├── index.html                   # SPA — grid feed + upload drawer
├── wrangler.toml                # Cloudflare config (buckets, env vars)
├── _routes.json                 # Pages routing
└── functions/
    ├── upload.js                # POST /functions/upload   → writes to R2
    ├── list.js                  # GET  /functions/list     → returns JSON list
    └── media/
        └── [key].js             # GET  /functions/media/:key → proxies R2 object
```

---

## Quick start (5 minutes)

### 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 2. Create your R2 bucket

```bash
wrangler r2 bucket create wedding-photos
# For a separate preview/test bucket:
wrangler r2 bucket create wedding-photos-preview
```

### 3. Configure `wrangler.toml`

Edit the two values:

```toml
[vars]
# Comma-separated list of valid event keys.
# Share this with guests via the URL: https://your-site.pages.dev?event=wedding2024
ALLOWED_KEYS = "wedding2024,emma-luca-2024"
```

Change these to something harder to guess before the event!

### 4. Deploy to Cloudflare Pages

**Option A — CLI (fastest):**

```bash
wrangler pages deploy . --project-name wedding-feed
```

**Option B — Git integration (recommended for production):**

1. Push this repo to GitHub / GitLab.
2. In the Cloudflare dashboard → Pages → Create a project → Connect to Git.
3. Set build command: _(leave empty — no build step)_
4. Set output directory: `.`
5. After first deploy, go to **Settings → Functions → R2 bucket bindings** and add:
   - Variable name: `WEDDING_BUCKET`
   - R2 bucket: `wedding-photos`
6. Go to **Settings → Environment variables** and add:
   - `ALLOWED_KEYS` = `wedding2024,emma-luca-2024`

### 5. Generate a QR code for guests

```
https://wedding-feed.pages.dev?event=wedding2024
```

Use any QR code generator (e.g. qr-code-generator.com) with this URL.
Print and place on every table. Guests tap the code → instant feed.

---

## How the access key works

The `?event=` query parameter is a simple shared secret.

- The browser sends it as a form field with every upload request.
- `functions/upload.js` checks it against `ALLOWED_KEYS` (your env var).
- No match → `403 Forbidden`. No upload succeeds without the key.
- The feed (`/functions/list`) is **public** — anyone with the URL can view photos.
  If you want a private feed too, add the same key check to `list.js`.

> **Security note:** This is "URL security" — sufficient to prevent bots and
> randos, but anyone with the QR code URL can upload. For a wedding, that's
> exactly what you want.

---

## Making the bucket public (optional, faster media delivery)

By default, media is served through the `/functions/media/[key]` proxy
(a Cloudflare Worker). This works perfectly but adds ~1 Worker invocation
per image load.

For better performance on large events:

1. In Cloudflare R2 dashboard → your bucket → **Settings → Public access**
2. Add a custom domain, e.g. `media.yourdomain.com`
3. In `wrangler.toml`, uncomment and set:
   ```toml
   PUBLIC_BUCKET_URL = "https://media.yourdomain.com"
   ```
4. Redeploy. The list endpoint now returns direct CDN URLs — zero Worker hops.

---

## Customising the UI

Open `index.html` and find these easy customisations:

```html
<!-- Change the couple's names -->
<h1 class="logo text-xl">Emma & Luca</h1>

<!-- Change the page title -->
<title>💍 Our Wedding · Live Photos</title>
```

CSS variables at the top of `<style>`:

```css
:root {
  --gold: #b89a6a;        /* accent colour — change to your wedding palette */
  --gold-light: #d4b896;
  --cream: #faf7f2;       /* page background */
  --charcoal: #1a1814;    /* text */
  --muted: #7c7368;       /* secondary text */
}
```

Refetch interval (how often the feed auto-refreshes for live guests):

```js
const CONFIG = {
  REFETCH_INTERVAL_MS: 15_000,  // 15 seconds — lower = more live, more R2 reads
  MAX_FILE_SIZE_MB: 50,
};
```

---

## Cost estimate

For a 200-person wedding, uploading ~500 photos (avg 4 MB):

| Resource | Usage | Cost |
|---|---|---|
| R2 storage | 2 GB | ~$0.03/month |
| R2 Class A ops (writes) | 500 | ~$0.00 (free tier: 1M/month) |
| R2 Class B ops (reads) | ~5,000 | ~$0.00 (free tier: 10M/month) |
| Pages Functions | ~50,000 invocations | Free (100K/day free) |
| **Total** | | **~$0** |

Cloudflare's free tier covers a wedding comfortably. R2 egress is always free.

---

## Local development

```bash
# Install dependencies (none! pure Cloudflare runtime)
wrangler pages dev . --r2=WEDDING_BUCKET

# Open http://localhost:8788?event=test2024
```

Wrangler spins up a local R2 emulator — no real bucket needed for dev.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Photos not appearing | Check `WEDDING_BUCKET` binding in Pages dashboard |
| 403 on upload | Confirm `ALLOWED_KEYS` env var matches your `?event=` param |
| Video won't play | Browser needs Range request support — `media/[key].js` handles this |
| Feed shows old photos | `Cache-Control` on list is 10s — wait or hit Refresh button |
| Images not loading | If using public bucket, confirm `PUBLIC_BUCKET_URL` has no trailing slash |
