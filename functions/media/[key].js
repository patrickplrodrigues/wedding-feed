/**
 * /functions/media/[key].js
 *
 * Proxies private R2 objects to the browser.
 * Supports:
 *   - Range requests  (needed for video seeking)
 *   - ETags & 304 Not Modified
 *   - Long-lived cache headers on immutable media
 *
 * Route: GET /functions/media/:key
 * The :key is URL-encoded so it can contain slashes (uploads/...)
 *
 * Env bindings:
 *   - WEDDING_BUCKET : R2 bucket binding
 */

export async function onRequestGet(context) {
  const { request, env, params } = context;

  // Reconstruct the full key (params.key may be a single segment or array)
  const rawKey = Array.isArray(params.key)
    ? params.key.join('/')
    : params.key ?? '';

  const r2Key = decodeURIComponent(rawKey);

  if (!r2Key.startsWith('uploads/')) {
    return new Response('Not found', { status: 404 });
  }

  // ── Conditional GET (ETag / If-None-Match) ─────────────────────────────
  const ifNoneMatch = request.headers.get('If-None-Match');

  // ── Range support (critical for video) ─────────────────────────────────
  const rangeHeader = request.headers.get('Range');

  let object;
  try {
    if (rangeHeader) {
      object = await env.WEDDING_BUCKET.get(r2Key, {
        range: rangeHeader,
        onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch } : undefined,
      });
    } else {
      object = await env.WEDDING_BUCKET.get(r2Key, {
        onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch } : undefined,
      });
    }
  } catch (err) {
    console.error('R2 get error:', err);
    return new Response('Storage error', { status: 500 });
  }

  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  // ── 304 Not Modified ───────────────────────────────────────────────────
  if (object.status === 304) {
    return new Response(null, { status: 304 });
  }

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  const etag = object.httpEtag;

  const headers = {
    'Content-Type': contentType,
    // Immutable — the key includes a timestamp+uuid so content never changes
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': etag,
    // Allow embedding in <img> and <video> from same origin
    'Cross-Origin-Resource-Policy': 'same-site',
  };

  // ── Range response ─────────────────────────────────────────────────────
  if (rangeHeader && object.range) {
    const { offset, length } = object.range;
    const total = object.size;

    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${total}`;
    headers['Content-Length'] = String(length);
    headers['Accept-Ranges'] = 'bytes';

    return new Response(object.body, {
      status: 206,
      headers,
    });
  }

  // ── Full response ──────────────────────────────────────────────────────
  headers['Content-Length'] = String(object.size);
  headers['Accept-Ranges'] = 'bytes';

  return new Response(object.body, {
    status: 200,
    headers,
  });
}
