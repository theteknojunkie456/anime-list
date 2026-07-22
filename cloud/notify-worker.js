/**
 * WatchList — Web Push notification worker (Cloudflare Workers)
 *
 * Independent from cloud/sync-worker.js. Do not share the KV namespace.
 *
 * Responsibilities:
 *   A) HTTP API  — /subscribe, /unsubscribe, /update  (CORS enabled)
 *   B) SCHEDULED — every 15 min: poll AniList airing schedules, push notify
 *   C) WEB PUSH  — RFC 8291 (aes128gcm) + RFC 8292 (VAPID) via WebCrypto
 *
 * Runtime env:
 *   env.VAPID_PUBLIC_KEY   (var)    base64url 65-byte 0x04||X||Y P-256 point
 *   env.VAPID_SUBJECT      (var)    e.g. "mailto:you@example.com"
 *   env.VAPID_PRIVATE_KEY  (secret) base64url 32-byte P-256 scalar (JWK "d")
 *   env.SUBS               (KV)     subscription store, keys "sub:<sha256hex>"
 */

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

/** Uint8Array | ArrayBuffer -> base64url string (no padding). */
function b64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (or standard base64) string -> Uint8Array. */
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad === 2) s += "==";
  else if (pad === 3) s += "=";
  else if (pad === 1) throw new Error("invalid base64url length");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Concatenate a list of Uint8Arrays into one. */
function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);

/** SHA-256 hex digest of a string. */
async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(str));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// ---------------------------------------------------------------------------
// HKDF (RFC 5869) via WebCrypto HMAC-SHA-256
// ---------------------------------------------------------------------------

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

/**
 * HKDF: Extract-then-Expand. length must be <= 32 (single expand block),
 * which holds for all Web Push uses (PRK=32, CEK=16, NONCE=12).
 */
async function hkdf(salt, ikm, info, length) {
  const prk = await hmacSha256(salt, ikm); // HKDF-Extract
  const okm = await hmacSha256(prk, concatBytes(info, new Uint8Array([1]))); // HKDF-Expand, T(1)
  return okm.slice(0, length);
}

// ---------------------------------------------------------------------------
// VAPID public key -> JWK x/y
// ---------------------------------------------------------------------------

/** From base64url 65-byte 0x04||X||Y point, derive {x, y} base64url coords. */
function publicKeyToXY(vapidPublicKeyB64url) {
  const pub = b64urlDecode(vapidPublicKeyB64url);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point (0x04||X||Y)");
  }
  return {
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
  };
}

// ---------------------------------------------------------------------------
// VAPID JWT (ES256, RFC 8292)
// ---------------------------------------------------------------------------

async function makeVapidJwt(audience, env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: nowSec + 43200, // 12h
    sub: env.VAPID_SUBJECT,
  };

  const signingInput =
    b64urlEncode(utf8(JSON.stringify(header))) +
    "." +
    b64urlEncode(utf8(JSON.stringify(payload)));

  const { x, y } = publicKeyToXY(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: env.VAPID_PRIVATE_KEY,
    x,
    y,
    ext: true,
  };

  const privKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // WebCrypto ECDSA returns raw r||s (64 bytes) — exactly JOSE ES256 format.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privKey,
    utf8(signingInput)
  );

  return signingInput + "." + b64urlEncode(sig);
}

// ---------------------------------------------------------------------------
// Web Push payload encryption (RFC 8291 aes128gcm) + send
// ---------------------------------------------------------------------------

/**
 * Encrypt + POST a Web Push message.
 * Returns the HTTP status code from the push service.
 */
async function sendPush(subscription, payloadObj, env) {
  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin; // scheme + host

  // --- VAPID auth header ---
  const jwt = await makeVapidJwt(audience, env);
  const authHeader = `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;

  // --- keys/inputs ---
  const clientPub = b64urlDecode(subscription.keys.p256dh); // 65 bytes
  const authSecret = b64urlDecode(subscription.keys.auth); // 16 bytes
  if (clientPub.length !== 65 || clientPub[0] !== 0x04) {
    throw new Error("subscription.keys.p256dh is not a 65-byte P-256 point");
  }
  if (authSecret.length !== 16) {
    throw new Error("subscription.keys.auth must be 16 bytes");
  }

  // --- ephemeral ECDH keypair (application server key) ---
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey)
  ); // 65 bytes

  // --- ECDH shared secret ---
  const clientPubKey = await crypto.subtle.importKey(
    "raw",
    clientPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPubKey },
      ephemeral.privateKey,
      256
    )
  ); // 32 bytes

  // --- key derivation (RFC 8291 §3.3) ---
  // PRK_key: salt=auth, ikm=ecdhSecret, info="WebPush: info\0"||clientPub||ephemeralPub
  const keyInfo = concatBytes(
    utf8("WebPush: info\x00"),
    clientPub,
    ephemeralPubRaw
  );
  const prkKey = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt16 = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt16,
    prkKey,
    utf8("Content-Encoding: aes128gcm\x00"),
    16
  );
  const nonce = await hkdf(
    salt16,
    prkKey,
    utf8("Content-Encoding: nonce\x00"),
    12
  );

  // --- plaintext = payload || 0x02 (record delimiter, single record, no pad) ---
  const payloadBytes = utf8(JSON.stringify(payloadObj));
  const plaintext = concatBytes(payloadBytes, new Uint8Array([0x02]));

  // --- AES-128-GCM encrypt (ciphertext includes 16-byte tag) ---
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      plaintext
    )
  );

  // --- aes128gcm content-coding header + body (RFC 8188 §2.1) ---
  // salt(16) || rs(uint32 BE) || idlen(uint8) || keyid(=ephemeralPub 65) || ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false); // record size, big-endian
  const idlen = new Uint8Array([0x41]); // 65
  const body = concatBytes(salt16, rs, idlen, ephemeralPubRaw, ciphertext);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: authHeader,
    },
    body,
  });

  return res.status;
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function subKey(endpoint) {
  return sha256Hex(endpoint).then((h) => "sub:" + h);
}

function isValidSubscription(sub) {
  return (
    sub &&
    typeof sub === "object" &&
    typeof sub.endpoint === "string" &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === "string" &&
    typeof sub.keys.auth === "string"
  );
}

function normalizeAnimeIds(ids) {
  if (!Array.isArray(ids)) return null;
  const out = [];
  for (const v of ids) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}

async function handleSubscribe(body, env) {
  if (!isValidSubscription(body.subscription)) {
    return json({ ok: false, error: "invalid subscription" }, 400);
  }
  const animeIds = normalizeAnimeIds(body.animeIds);
  if (animeIds === null) {
    return json({ ok: false, error: "animeIds must be an array of numbers" }, 400);
  }
  const tz = typeof body.tz === "string" ? body.tz : null;
  const key = await subKey(body.subscription.endpoint);
  const record = {
    subscription: {
      endpoint: body.subscription.endpoint,
      keys: {
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
    },
    animeIds,
    tz,
    notified: {},
  };
  await env.SUBS.put(key, JSON.stringify(record));
  return json({ ok: true });
}

async function handleUnsubscribe(body, env) {
  if (typeof body.endpoint !== "string" || !body.endpoint) {
    return json({ ok: false, error: "endpoint required" }, 400);
  }
  const key = await subKey(body.endpoint);
  await env.SUBS.delete(key);
  return json({ ok: true });
}

async function handleUpdate(body, env) {
  if (typeof body.endpoint !== "string" || !body.endpoint) {
    return json({ ok: false, error: "endpoint required" }, 400);
  }
  const animeIds = normalizeAnimeIds(body.animeIds);
  if (animeIds === null) {
    return json({ ok: false, error: "animeIds must be an array of numbers" }, 400);
  }
  const key = await subKey(body.endpoint);
  const raw = await env.SUBS.get(key);
  if (!raw) {
    return json({ ok: false, error: "subscription not found" }, 404);
  }
  const record = JSON.parse(raw);
  record.animeIds = animeIds;
  // Drop notified entries for ids no longer tracked (keeps map tidy).
  if (record.notified && typeof record.notified === "object") {
    const keep = {};
    for (const id of animeIds) {
      if (record.notified[id] !== undefined) keep[id] = record.notified[id];
    }
    record.notified = keep;
  } else {
    record.notified = {};
  }
  await env.SUBS.put(key, JSON.stringify(record));
  return json({ ok: true });
}

async function handleFetch(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);

  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "invalid body" }, 400);
  }

  switch (url.pathname) {
    case "/subscribe":
      return handleSubscribe(body, env);
    case "/unsubscribe":
      return handleUnsubscribe(body, env);
    case "/update":
      return handleUpdate(body, env);
    case "/test":
      return handleTest(body, env);
    case "/broadcast":
      return handleBroadcast(body, env);
    case "/join":
      return handleJoin(body, env);
    case "/status":
      return handleStatus(body, env);
    case "/members":
      return handleMembers(body, env);
    case "/approve":
      return handleDecide(body, env, "approved");
    case "/deny":
      return handleDecide(body, env, "denied");
    case "/invite":
      return handleInvite(body, env);
    case "/admin-register":
      return handleAdminRegister(body, env);
    case "/cap":
      return handleSetCap(body, env);
    case "/message":
      return handleMessageGet(env);
    case "/message-set":
      return handleMessageSet(body, env);
    default:
      return json({ ok: false, error: "not found" }, 404);
  }
}

/**
 * Send a push to one subscription on demand.
 *
 * Without this, the only proof notifications work is waiting for an episode to
 * air — which, for a list of mostly finished shows, can be weeks. Silence then
 * reads as "broken" when it usually means "nothing aired". This makes the whole
 * chain (VAPID signing → Apple/Google push service → service worker) verifiable
 * in two seconds.
 */
async function handleTest(body, env) {
  if (typeof body.endpoint !== "string" || !body.endpoint) {
    return json({ ok: false, error: "endpoint required" }, 400);
  }
  const key = await subKey(body.endpoint);
  const raw = await env.SUBS.get(key);
  if (!raw) {
    return json({ ok: false, error: "subscription not found" }, 404);
  }
  const record = JSON.parse(raw);

  let status;
  try {
    status = await sendPush(
      record.subscription,
      {
        title: "WatchList",
        body: "Notifications are working — you'll hear from us when an episode drops.",
        url: "/",
        tag: "watchlist-test",
      },
      env,
    );
  } catch (e) {
    return json({ ok: false, error: "push failed: " + (e && e.message) }, 502);
  }

  // The push service is the authority on whether an endpoint is still alive;
  // a dead one should clean itself up here rather than linger in KV forever.
  if (status === 404 || status === 410) {
    await env.SUBS.delete(key);
    return json({ ok: false, error: "subscription expired", status }, 410);
  }
  if (status < 200 || status >= 300) {
    return json({ ok: false, error: "push rejected", status }, 502);
  }
  return json({ ok: true, tracking: (record.animeIds || []).length });
}

/**
 * Broadcast one push to EVERY subscriber — used to announce a new app version.
 *
 * Guarded by a shared secret (env.ADMIN_TOKEN): without it, anyone who found the
 * URL could push a banner to every user. Send it as `token` in the body; a
 * missing or wrong token is a 401, and if the secret isn't configured at all the
 * endpoint stays disabled rather than open.
 *
 * Reaches everyone who ENABLED notifications — a real system notification even
 * when the app is closed. Users who never turned notifications on can't receive
 * a push (there's no subscription); they still get the in-app "What's new" sheet
 * on next open. That split is a web-push fact, not a choice.
 */
async function handleBroadcast(body, env) {
  if (!env.ADMIN_TOKEN) {
    return json({ ok: false, error: "broadcast disabled (no ADMIN_TOKEN set)" }, 503);
  }
  if (body.token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const title = typeof body.title === "string" && body.title ? body.title : "WatchList";
  const bodyText = typeof body.body === "string" ? body.body : "";
  if (!bodyText) {
    return json({ ok: false, error: "body text required" }, 400);
  }
  const tag = typeof body.tag === "string" && body.tag ? body.tag : "watchlist-update";
  const url = typeof body.url === "string" && body.url ? body.url : "/";

  const subs = await loadAllSubs(env);
  let sent = 0, dead = 0, failed = 0;
  // Small batches with a pause — the same courtesy the scheduled sender shows the
  // push services, so a broadcast to many users doesn't hammer them.
  for (const batch of chunk(subs, 50)) {
    for (const { key, record } of batch) {
      let status;
      try {
        status = await sendPush(record.subscription, { title, body: bodyText, url, tag }, env);
      } catch (e) {
        failed++;
        continue;
      }
      if (status === 404 || status === 410) {
        await env.SUBS.delete(key);
        dead++;
      } else if (status >= 200 && status < 300) {
        sent++;
      } else {
        failed++;
      }
    }
    await sleep(200);
  }
  return json({ ok: true, sent, dead, failed, total: subs.length });
}

// ---------------------------------------------------------------------------
// MEMBERSHIP — invite-only network with admin approval
// ---------------------------------------------------------------------------
//
// The public page opens for anyone (a static site can't stop that), but the
// NETWORK — cloud sync, notifications, friends, admin messages — is gated to
// devices the admin approves. Manual approval is the point: it's the bot filter
// and it caps the network at real people you recognise.
//
// KV (in SUBS), all with distinct prefixes so they never collide with "sub:":
//   dev:<deviceId>   {id,status:'pending'|'approved'|'denied',name,invite,joinedAt,decidedAt}
//   inv:<code>       {code,mode:'request'|'auto',uses,maxUses,createdAt}
//   admin:endpoint   the admin's push endpoint, so joins can ping just them
//
// deviceId is a client-generated opaque token. It isn't a secret — approval is
// the gate, not the id — so trusting it as a KV key is fine here.

const DEFAULT_CAP = 50;
// The cap lives in KV so the admin can raise/lower it from the control center
// without a redeploy. Absent/invalid → the default.
async function getCap(env) {
  const raw = await env.SUBS.get("cfg:cap");
  const n = parseInt(raw, 10);
  return n > 0 ? n : DEFAULT_CAP;
}
const devKey = (id) => "dev:" + String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

async function countApproved(env) {
  let cursor, n = 0;
  do {
    const page = await env.SUBS.list({ prefix: "dev:", cursor });
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (raw) { try { if (JSON.parse(raw).status === "approved") n++; } catch {} }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return n;
}

// A device announces itself. New devices land 'pending' (or 'approved' if they
// carried a valid auto-invite), and the admin is pinged once about a new request.
async function handleJoin(body, env) {
  const id = String(body.deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return json({ ok: false, error: "deviceId required" }, 400);
  const key = devKey(id);
  const existing = await env.SUBS.get(key);
  if (existing) {
    // Already known — just report status, don't re-notify.
    const rec = JSON.parse(existing);
    return json({ ok: true, status: rec.status, name: rec.name || "" });
  }

  // Optional invite: an 'auto' code approves on the spot (still counts toward the
  // cap); a 'request' code just tags where they came from.
  let status = "pending", inviteCode = "";
  if (body.invite) {
    const iraw = await env.SUBS.get("inv:" + String(body.invite).slice(0, 40));
    if (iraw) {
      const inv = JSON.parse(iraw);
      inviteCode = inv.code;
      if (inv.maxUses && inv.uses >= inv.maxUses) {
        // used up — falls through as a plain pending request
      } else {
        inv.uses = (inv.uses || 0) + 1;
        await env.SUBS.put("inv:" + inv.code, JSON.stringify(inv));
        if (inv.mode === "auto" && (await countApproved(env)) < (await getCap(env))) status = "approved";
      }
    }
  }

  const rec = {
    id, status,
    name: String(body.name || "").slice(0, 40),
    source: String(body.source || "").slice(0, 40),   // how they heard about it
    invite: inviteCode,
    joinedAt: Date.now(),
  };
  await env.SUBS.put(key, JSON.stringify(rec));

  // Ping the admin about a genuinely new pending request (best-effort).
  if (status === "pending") {
    try {
      const aep = await env.SUBS.get("admin:endpoint");
      if (aep) {
        const asub = JSON.parse(aep);
        await sendPush(asub, {
          title: "WatchList — new join request",
          body: (rec.name || "Someone") + " wants in. Open the admin panel to approve.",
          url: "/", tag: "wl-join",
        }, env);
      }
    } catch {}
  }
  return json({ ok: true, status });
}

// Client polls this to know whether the network is open to it yet.
async function handleStatus(body, env) {
  const raw = await env.SUBS.get(devKey(body.deviceId));
  if (!raw) return json({ ok: true, status: "unknown" });
  const rec = JSON.parse(raw);
  return json({ ok: true, status: rec.status });
}

// --- admin-only below (all guarded by ADMIN_TOKEN) ---

function adminOK(body, env) { return env.ADMIN_TOKEN && body.token === env.ADMIN_TOKEN; }

// The admin's own device registers its push endpoint here, so join requests can
// notify just them rather than broadcasting.
async function handleAdminRegister(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!body.subscription || !body.subscription.endpoint) return json({ ok: false, error: "subscription required" }, 400);
  await env.SUBS.put("admin:endpoint", JSON.stringify(body.subscription));
  return json({ ok: true });
}

async function handleMembers(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  let cursor; const devs = [];
  do {
    const page = await env.SUBS.list({ prefix: "dev:", cursor });
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (raw) { try { devs.push(JSON.parse(raw)); } catch {} }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  devs.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
  const approved = devs.filter((d) => d.status === "approved").length;
  return json({ ok: true, devices: devs, approved, cap: await getCap(env) });
}

async function handleDecide(body, env, status) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const key = devKey(body.deviceId);
  const raw = await env.SUBS.get(key);
  if (!raw) return json({ ok: false, error: "device not found" }, 404);
  const cap = await getCap(env);
  if (status === "approved" && (await countApproved(env)) >= cap) {
    return json({ ok: false, error: "at capacity (" + cap + ")" }, 409);
  }
  const rec = JSON.parse(raw);
  rec.status = status; rec.decidedAt = Date.now();
  await env.SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true, status });
}

async function handleInvite(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  // Short readable code; 'request' (default) sends a request you approve, 'auto'
  // approves on use (for people you trust to share it).
  const code = (Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const inv = {
    code,
    mode: body.mode === "auto" ? "auto" : "request",
    uses: 0,
    maxUses: Number(body.maxUses) || 0, // 0 = unlimited
    createdAt: Date.now(),
  };
  await env.SUBS.put("inv:" + code, JSON.stringify(inv));
  return json({ ok: true, code, mode: inv.mode });
}

// Admin raises/lowers the member cap live.
async function handleSetCap(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const n = parseInt(body.cap, 10);
  if (!(n > 0) || n > 100000) return json({ ok: false, error: "cap must be 1–100000" }, 400);
  await env.SUBS.put("cfg:cap", String(n));
  return json({ ok: true, cap: n });
}

// ---------------------------------------------------------------------------
// ON-SCREEN MESSAGE — an admin card everyone's app shows
// ---------------------------------------------------------------------------
// Not a push — an in-app card. The admin sets one; every client fetches it on
// load/focus and shows it (a note, or a "watch anime on ___" nudge with a link).
// Clients skip a card whose id they've already dismissed, so it shows once.

// Public: clients poll this to get the current card (no auth).
async function handleMessageGet(env) {
  const raw = await env.SUBS.get("cfg:message");
  return json({ ok: true, message: raw ? JSON.parse(raw) : null });
}
// Admin: set (or clear) the current card.
async function handleMessageSet(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (body.clear) { await env.SUBS.delete("cfg:message"); return json({ ok: true, cleared: true }); }
  const msg = {
    id: "m" + Date.now(),
    title: String(body.title || "").slice(0, 80),
    body: String(body.body || "").slice(0, 280),
    ctaLabel: String(body.ctaLabel || "").slice(0, 40),
    ctaUrl: String(body.ctaUrl || "").slice(0, 400),
    at: Date.now(),
  };
  if (!msg.title && !msg.body) return json({ ok: false, error: "title or body required" }, 400);
  await env.SUBS.put("cfg:message", JSON.stringify(msg));
  return json({ ok: true, message: msg });
}

// ---------------------------------------------------------------------------
// SCHEDULED — AniList airing poll + notify
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** List every "sub:" record from KV, following pagination cursors. */
async function loadAllSubs(env) {
  const records = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw);
        records.push({ key: k.name, record });
      } catch {
        // skip corrupt entry
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Query AniList for airing schedules of the given media ids within
 * [afterSec, beforeSec]. Handles >50 ids via chunking + sequential delays.
 * Returns array of { mediaId, episode, airingAt, title }.
 */
async function fetchAiredSchedules(ids, afterSec, beforeSec) {
  const query = `
    query ($ids: [Int], $after: Int, $before: Int) {
      Page(perPage: 50) {
        airingSchedules(
          mediaId_in: $ids
          airingAt_greater: $after
          airingAt_lesser: $before
        ) {
          mediaId
          episode
          airingAt
          media { title { romaji english } }
        }
      }
    }`;

  const results = [];
  const batches = chunk(ids, 50);
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(700); // be gentle with AniList rate limits

    let res;
    try {
      res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { ids: batches[i], after: afterSec, before: beforeSec },
        }),
      });
    } catch (e) {
      console.error("AniList fetch error", e);
      continue;
    }

    if (res.status === 429) {
      const retry = Number(res.headers.get("Retry-After") || "2");
      await sleep((Number.isFinite(retry) ? retry : 2) * 1000);
      i--; // retry this batch
      continue;
    }
    if (!res.ok) {
      console.error("AniList non-OK", res.status);
      continue;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      continue;
    }
    const schedules = data?.data?.Page?.airingSchedules || [];
    for (const s of schedules) {
      const title =
        s.media?.title?.english ||
        s.media?.title?.romaji ||
        `Anime #${s.mediaId}`;
      results.push({
        mediaId: s.mediaId,
        episode: s.episode,
        airingAt: s.airingAt,
        title,
      });
    }
  }
  return results;
}

async function handleScheduled(env) {
  const subs = await loadAllSubs(env);
  if (subs.length === 0) return;

  // Union of tracked ids.
  const idSet = new Set();
  for (const { record } of subs) {
    for (const id of record.animeIds || []) idSet.add(id);
  }
  const ids = [...idSet];
  if (ids.length === 0) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - 2400; // 40 min window (> 15 min cadence)

  const aired = await fetchAiredSchedules(ids, windowStart, nowSec);
  if (aired.length === 0) return;

  // Index latest aired episode per mediaId (in case of multiple in window).
  const byMedia = new Map();
  for (const a of aired) {
    const prev = byMedia.get(a.mediaId);
    if (!prev || a.episode > prev.episode) byMedia.set(a.mediaId, a);
  }

  for (const { key, record } of subs) {
    if (!record.notified || typeof record.notified !== "object") {
      record.notified = {};
    }
    let dirty = false;
    let expired = false;

    for (const mediaId of record.animeIds || []) {
      const airing = byMedia.get(mediaId);
      if (!airing) continue;
      const already = record.notified[mediaId];
      if (already === airing.episode) continue; // already notified this ep

      const payload = {
        title: airing.title,
        body: `Episode ${airing.episode} is out!`,
        url: "/",
        tag: `aired-${mediaId}-${airing.episode}`,
      };

      let status;
      try {
        status = await sendPush(record.subscription, payload, env);
      } catch (e) {
        console.error("sendPush error", mediaId, e);
        continue;
      }

      if (status === 404 || status === 410) {
        // Subscription gone — remove it and stop pushing to it.
        expired = true;
        break;
      }
      if (status >= 200 && status < 300) {
        record.notified[mediaId] = airing.episode;
        dirty = true;
      } else {
        console.error("push failed", mediaId, status);
      }
    }

    if (expired) {
      await env.SUBS.delete(key);
    } else if (dirty) {
      await env.SUBS.put(key, JSON.stringify(record));
    }
  }
}

// ---------------------------------------------------------------------------
// Worker entrypoints
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env);
    } catch (e) {
      console.error("fetch handler error", e);
      return json({ ok: false, error: "internal error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};

// Exported for local self-test harness (harmless in Workers runtime).
export const __test__ = {
  b64urlEncode,
  b64urlDecode,
  concatBytes,
  hkdf,
  publicKeyToXY,
  makeVapidJwt,
  sha256Hex,
};
