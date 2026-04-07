/**
 * /functions/upload.js
 *
 * Handles POST multipart/form-data uploads.
 * Validates the event access key, generates a unique file ID,
 * and writes the object to the R2 bucket.
 *
 * Env bindings required (set in wrangler.toml or Pages dashboard):
 *   - WEDDING_BUCKET  : R2 bucket binding
 *   - ALLOWED_KEYS    : comma-separated list of valid event keys  (e.g. "wedding2024,photo2024")
 */

const MAX_FILE_SIZE = 52_428_800; // 50 MB

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── CORS preflight ──────────────────────────────────────────────────────
  const corsHeaders = getCorsHeaders(request);

  // ── Parse multipart body ────────────────────────────────────────────────
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid multipart body' }, 400, corsHeaders);
  }

  // ── Access key validation ───────────────────────────────────────────────
  const eventKey = formData.get('event');
  if (!isKeyValid(eventKey, env)) {
    return jsonResponse({ error: 'Invalid or missing event key' }, 403, corsHeaders);
  }

  // ── File extraction ─────────────────────────────────────────────────────
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'No file provided' }, 400, corsHeaders);
  }

  // ── Size guard ──────────────────────────────────────────────────────────
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_SIZE) {
    return jsonResponse({ error: 'File exceeds 50 MB limit' }, 413, corsHeaders);
  }

  // ── MIME type whitelist ─────────────────────────────────────────────────
  const contentType = file.type || 'application/octet-stream';
  if (!isAllowedType(contentType)) {
    return jsonResponse({ error: 'Unsupported file type' }, 415, corsHeaders);
  }

  // ── Generate unique key ─────────────────────────────────────────────────
  // Pattern: uploads/{timestamp}_{random}.{ext}
  const ext = getExtension(file.name, contentType);
  const ts  = Date.now();
  const rnd = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const r2Key = `uploads/${ts}_${rnd}.${ext}`;

  // ── Store in R2 ─────────────────────────────────────────────────────────
  try {
    await env.WEDDING_BUCKET.put(r2Key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        originalName: file.name.slice(0, 255), // cap length
        uploadedAt: new Date().toISOString(),
        eventKey,
      },
    });
  } catch (err) {
    console.error('R2 put error:', err);
    return jsonResponse({ error: 'Storage write failed' }, 500, corsHeaders);
  }

  return jsonResponse({
    success: true,
    key: r2Key,
    contentType,
    size: bytes.byteLength,
  }, 201, corsHeaders);
}

// Handle CORS preflight OPTIONS requests
export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function isKeyValid(key, env) {
  if (!key) return false;
  const allowedKeys = (env.ALLOWED_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  // If no keys are configured, block all uploads
  if (allowedKeys.length === 0) return false;
  return allowedKeys.includes(key.trim());
}

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/mov',
]);

function isAllowedType(contentType) {
  // Match base type without parameters
  const base = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_TYPES.has(base);
}

const MIME_TO_EXT = {
  'image/jpeg':     'jpg',
  'image/png':      'png',
  'image/webp':     'webp',
  'image/gif':      'gif',
  'image/heic':     'heic',
  'image/heif':     'heif',
  'image/avif':     'avif',
  'video/mp4':      'mp4',
  'video/quicktime': 'mov',
  'video/webm':     'webm',
  'video/mov':      'mov',
};

function getExtension(filename, contentType) {
  // Try MIME map first
  const fromMime = MIME_TO_EXT[contentType.split(';')[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  // Fall back to filename extension
  const parts = (filename || '').split('.');
  if (parts.length > 1) return parts.pop().toLowerCase().slice(0, 6);
  return 'bin';
}

function getCorsHeaders(request) {
  // In production you'd restrict this to your Pages domain
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
