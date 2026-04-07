/**
 * /functions/list.js
 *
 * Returns a JSON array of media items from the R2 bucket.
 * Each item contains a URL the browser can load directly.
 *
 * Strategy:
 *   - If the bucket is PUBLIC (R2 custom domain configured), we return
 *     `${env.PUBLIC_BUCKET_URL}/${key}` — zero latency, no signing needed.
 *   - If the bucket is PRIVATE, we route through /functions/media/[key].js
 *     which streams the object from R2. This is the safe default.
 *
 * Env bindings:
 *   - WEDDING_BUCKET   : R2 bucket binding
 *   - PUBLIC_BUCKET_URL: (optional) e.g. "https://media.yourdomain.com"
 *                        Leave unset to use the private proxy route.
 */

const MAX_ITEMS   = 300;  // hard cap to keep the feed snappy
const CACHE_TTL_S = 10;   // CDN cache for the list response

export async function onRequestGet(context) {
  const { env, request } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Origin',
  };

  // List objects in the uploads/ prefix, newest first
  let listed;
  try {
    listed = await env.WEDDING_BUCKET.list({
      prefix: 'uploads/',
      limit: MAX_ITEMS,
    });
  } catch (err) {
    console.error('R2 list error:', err);
    return new Response(JSON.stringify({ error: 'Could not list objects' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const usePublicUrl = Boolean(env.PUBLIC_BUCKET_URL);

  const items = listed.objects
    // Skip zero-byte marker keys
    .filter(obj => obj.size > 0)
    // Build response shape
    .map(obj => {
      const contentType = obj.httpMetadata?.contentType || guessContentType(obj.key);
      const url = usePublicUrl
        ? `${env.PUBLIC_BUCKET_URL.replace(/\/$/, '')}/${obj.key}`
        : `/media/${encodeURIComponent(obj.key)}`;

      return {
        key: obj.key,
        url,
        contentType,
        size: obj.size,
        uploaded: obj.uploaded?.toISOString?.() ?? null,
        // Expose original filename from custom metadata if present
        originalName: obj.customMetadata?.originalName ?? null,
      };
    })
    // Sort newest-first by upload time embedded in key name (timestamp prefix)
    .sort((a, b) => {
      const tsA = extractTimestamp(a.key);
      const tsB = extractTimestamp(b.key);
      return tsB - tsA;
    });

  return new Response(JSON.stringify(items), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Short CDN cache — balances freshness vs load
      'Cache-Control': `public, max-age=${CACHE_TTL_S}, stale-while-revalidate=30`,
      ...corsHeaders,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function extractTimestamp(key) {
  // Key pattern: uploads/{timestamp}_{random}.{ext}
  const match = key.match(/uploads\/(\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

const EXT_TO_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',  webp: 'image/webp',
  gif: 'image/gif',  heic: 'image/heic',
  heif: 'image/heif', avif: 'image/avif',
  mp4: 'video/mp4',  mov: 'video/quicktime',
  webm: 'video/webm',
};

function guessContentType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}
