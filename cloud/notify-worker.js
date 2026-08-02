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
    mangaIds: normalizeAnimeIds(body.mangaIds) || [],
    tz,
    notified: {},
    chapters: {},
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
  // Manga rides alongside. Anime has an airing schedule; manga has only a
  // chapter COUNT, so tracking here means noticing when that count goes up.
  const mangaIds = normalizeAnimeIds(body.mangaIds);
  if (mangaIds !== null) {
    record.mangaIds = mangaIds;
    if (record.chapters && typeof record.chapters === "object") {
      const keep = {};
      for (const id of mangaIds) if (record.chapters[id] !== undefined) keep[id] = record.chapters[id];
      record.chapters = keep;
    } else record.chapters = {};
  }
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
    case "/titles-set":
      return handleTitlesSet(body, env);
    case "/rename":
      return handleRename(body, env);
    case "/approve":
      return handleDecide(body, env, "approved");
    case "/deny":
      return handleDecide(body, env, "denied");
    case "/invite":
      return handleInvite(body, env);
    case "/forget":
      return handleForget(body, env);
    case "/admin-register":
      return handleAdminRegister(body, env);
    case "/cap":
      return handleSetCap(body, env);
    case "/message":
      return handleMessageGet(body, env);
    case "/message-set":
      return handleMessageSet(body, env);
    case "/sources":
      return handleSourcesGet(env);
    case "/sources-set":
      return handleSourcesSet(body, env);
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
// Let the admin label a device. Names are optional and often absent — someone
// grandfathered in never typed one — so the roster needs a way to say "this is
// Faiz" without waiting on the user. An alias set here wins over any name they
// send later, so it never gets clobbered.
async function handleRename(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const id = String(body.deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return json({ ok: false, error: "deviceId required" }, 400);
  const key = devKey(id);
  const raw = await env.SUBS.get(key);
  if (!raw) return json({ ok: false, error: "not found" }, 404);
  const rec = JSON.parse(raw);
  const alias = String(body.alias || "").slice(0, 40).trim();
  if (alias) rec.alias = alias; else delete rec.alias;
  await env.SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true, alias: rec.alias || "" });
}
// A device id lives in localStorage, and iOS throws a home-screen app's
// localStorage away — on eviction, after a stretch of not opening it, when
// storage is cleared. The app then generates a fresh id, the server sees someone
// it has never met, and the admin gets ANOTHER "wants in" for a person who has
// been a member for weeks. That is where a roster of fourteen anonymous rows
// comes from, not from people opening the app.
//
// The sync code and the friend code are the same kind of secret but survive
// differently — they're written down, shared, and restored from a backup — so
// they act as a stable identity. If either one already belongs to a record, this
// device IS that person: the record moves to the new id, and nobody is notified.
const idxKey = (v) => "idn:" + String(v).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
async function adoptByIdentity(id, body, env) {
  const ids = [body.sync, body.fcode].filter(v => typeof v === "string" && v.length >= 10);
  for (const v of ids) {
    const prevId = await env.SUBS.get(idxKey(v));
    if (!prevId || prevId === id) continue;
    const raw = await env.SUBS.get(devKey(prevId));
    if (!raw) continue;
    const rec = JSON.parse(raw);
    rec.id = id;
    rec.rejoinedAt = Date.now();
    rec.devices = Math.min(50, (rec.devices || 1) + 1);   // how many times this person has been re-issued an id
    await env.SUBS.put(devKey(id), JSON.stringify(rec));
    await env.SUBS.delete(devKey(prevId));                // one person, one row
    for (const v2 of ids) await env.SUBS.put(idxKey(v2), id);
    return rec;
  }
  return null;
}
async function rememberIdentity(id, body, env) {
  for (const v of [body.sync, body.fcode]) {
    if (typeof v === "string" && v.length >= 10) await env.SUBS.put(idxKey(v), id);
  }
}
async function handleJoin(body, env) {
  const id = String(body.deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return json({ ok: false, error: "deviceId required" }, 400);
  const key = devKey(id);
  const existing = await env.SUBS.get(key);
  if (!existing) {
    const adopted = await adoptByIdentity(id, body, env);
    if (adopted) return json({ ok: true, status: adopted.status, name: adopted.alias || adopted.name || "", rejoined: true });
  }
  if (existing) {
    // Already known — report status, don't re-notify. But do fill in a name if we
    // never got one: grandfathered devices register as "(existing)", which is why
    // the roster was a list of placeholders. A real name arriving later should
    // land, while a name the admin set by hand is never overwritten.
    const rec = JSON.parse(existing);
    const incoming = String(body.name || "").slice(0, 40).trim();
    const placeholder = !rec.name || rec.name === "(existing)";
    if (incoming && placeholder && !rec.alias) {
      rec.name = incoming;
      await env.SUBS.put(key, JSON.stringify(rec));
    }
    await rememberIdentity(id, body, env);
    return json({ ok: true, status: rec.status, name: rec.alias || rec.name || "" });
  }

  // A PROBE is the app asking "where do I stand?" on launch, before the person
  // has seen the join screen. It must never create anything: registering here is
  // what filled the roster with nameless pending rows and pushed the admin a
  // request for someone who had not asked for anything yet. Unknown device +
  // probe = say so and write nothing.
  if (body.probe) return json({ ok: true, status: "unknown", probe: true });

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
  await rememberIdentity(id, body, env);

  // Tell the admin about EVERY new person. It only fired for pending before, so
  // anyone arriving through an auto-approve invite joined invisibly — the admin
  // had no idea their app had gained a user.
  try {
    const aep = await env.SUBS.get("admin:endpoint");
    if (aep) {
      const asub = JSON.parse(aep);
      const who = rec.name || "Someone";
      const heard = rec.source ? " (heard: " + rec.source + ")" : "";
      const payload = status === "pending"
        ? { title: "Someone wants in", body: who + " requested access" + heard + ". Approve them in Admin.", url: "/?admin=members", tag: "wl-join-" + id }
        : { title: "New member", body: who + " joined with an invite" + heard + ".", url: "/?admin=members", tag: "wl-join-" + id };
      await sendPush(asub, payload, env);
    }
  } catch {}
  return json({ ok: true, status });
}

// Client polls this to know whether the network is open to it yet.
// Presence rides on the poll the app already makes — no extra request, and no
// extra endpoint. The write is coalesced to once every PRESENCE_EVERY_MS because
// KV on the free plan allows 1,000 writes a day account-wide, and an app left
// open in a tab polls 720 times a day on its own.
const PRESENCE_EVERY_MS = 5 * 60000;

async function handleStatus(body, env) {
  const raw = await env.SUBS.get(devKey(body.deviceId));
  if (!raw) return json({ ok: true, status: "unknown" });
  const rec = JSON.parse(raw);
  let dirty = false;
  if (rec.status === "approved" && Date.now() - (rec.lastSeen || 0) > PRESENCE_EVERY_MS) {
    rec.lastSeen = Date.now();
    dirty = true;
  }
  // The old "mess with" redirect is gone. Any record still carrying one is
  // cleaned up the first time that device checks in, so nothing lingers.
  if (rec.prank || rec.pranked) { delete rec.prank; delete rec.pranked; dirty = true; }
  // Renamed titles ride along the same poll. Passive, so no trigger count — just
  // a clock, and the admin can put the real names back at any time.
  let titles = null;
  if (rec.titles) {
    if (rec.titles.until && Date.now() > rec.titles.until) { delete rec.titles; dirty = true; }
    else titles = rec.titles;
  }
  if (dirty) await env.SUBS.put(devKey(body.deviceId), JSON.stringify(rec));
  return json({ ok: true, status: rec.status, titles });
}

// Admin: rename the titles one device sees. `all` renames every title; `map`
// renames specific ones by AniList id. Cosmetic only — the device keeps the real
// names for storage, sync and watch links, so nothing it saves is corrupted.
async function handleTitlesSet(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const key = devKey(body.deviceId);
  const raw = await env.SUBS.get(key);
  if (!raw) return json({ ok: false, error: "not found" }, 404);
  const rec = JSON.parse(raw);
  if (body.clear) {
    delete rec.titles;
    await env.SUBS.put(key, JSON.stringify(rec));
    return json({ ok: true, cleared: true });
  }
  const all = String(body.all || "").slice(0, 120);
  const map = {};
  if (body.map && typeof body.map === "object") {
    for (const k of Object.keys(body.map).slice(0, 200)) {
      const v = String(body.map[k] || "").slice(0, 120);
      if (v) map[String(k).slice(0, 24)] = v;
    }
  }
  if (!all && !Object.keys(map).length) return json({ ok: false, error: "nothing to rename" }, 400);
  const mins = Math.max(1, Math.min(720, parseInt(body.minutes, 10) || 720));
  const prev = (rec.titles && rec.titles.map) || {};
  rec.titles = { all, map: { ...prev, ...map }, until: Date.now() + mins * 60000 };
  await env.SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true, titles: rec.titles });
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

// Admin: delete a device record outright. There was no way to remove one, so a
// roster that filled up with re-registrations could only grow.
async function handleForget(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const id = String(body.deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return json({ ok: false, error: "deviceId required" }, 400);
  await env.SUBS.delete(devKey(id));
  return json({ ok: true, forgotten: id });
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
// Cards are stored per platform so web and iOS are independent: the admin can put a
// card on one, clear it on one, or manage both together. The client asks for its own
// platform's card (body.p). "cfg:message" is the pre-split legacy key, still honored
// as a fallback so a card set before this change keeps showing until replaced.
async function handleMessageGet(body, env) {
  const p = (body && (body.p === "ios" || body.p === "web")) ? body.p : "web";
  let raw = await env.SUBS.get("cfg:msg:" + p);
  if (!raw) raw = await env.SUBS.get("cfg:message");   // legacy single-slot fallback
  return json({ ok: true, message: raw ? JSON.parse(raw) : null });
}
// Admin: set (or clear) the card, scoped to the chosen platform(s).
async function handleMessageSet(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  // Android is its own target now. The APK is a wrapper around the same site, so
  // it reports as its own platform rather than hiding inside "web" — otherwise a
  // card meant for phone users lands on desktops too.
  const PLATFORMS = ["web", "ios", "android"];
  const targets = PLATFORMS.includes(body.target) ? [body.target] : PLATFORMS;
  if (body.clear) {
    await Promise.all([...targets.map(p => env.SUBS.delete("cfg:msg:" + p)), env.SUBS.delete("cfg:message")]);
    return json({ ok: true, cleared: true, target: body.target || "all" });
  }
  const msg = {
    id: "m" + Date.now(),
    title: String(body.title || "").slice(0, 80),
    body: String(body.body || "").slice(0, 280),
    ctaLabel: String(body.ctaLabel || "").slice(0, 40),
    ctaUrl: String(body.ctaUrl || "").slice(0, 400),
    target: PLATFORMS.includes(body.target) ? body.target : "all",
    at: Date.now(),
  };
  if (!msg.title && !msg.body) return json({ ok: false, error: "title or body required" }, 400);
  await Promise.all(targets.map(p => env.SUBS.put("cfg:msg:" + p, JSON.stringify(msg))));
  await env.SUBS.delete("cfg:message");   // supersede any legacy single-slot card
  return json({ ok: true, message: msg });
}

// ---------------------------------------------------------------------------
// ADMIN-CURATED SOURCES — the streaming services the admin recommends to the
// whole network. Everyone starts with the built-ins hidden (a clean Watch
// slate), so this is how the admin seeds working sources for all 50 members at
// once instead of each person configuring their own. Clients apply a list once
// per id (they unhide exactly these names), then it just shows in Watch.
// ---------------------------------------------------------------------------

// Public: clients poll this for the current recommended set (no auth).
async function handleSourcesGet(env) {
  const raw = await env.SUBS.get("cfg:sources");
  return json({ ok: true, sources: raw ? JSON.parse(raw) : null });
}
// Admin: replace (or clear) the recommended set. `list` = [{name,url}].
async function handleSourcesSet(body, env) {
  if (!adminOK(body, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (body.clear) { await env.SUBS.delete("cfg:sources"); return json({ ok: true, cleared: true }); }
  const list = (Array.isArray(body.list) ? body.list : [])
    .map((s) => ({ name: String(s && s.name || "").slice(0, 60), url: String(s && s.url || "").slice(0, 400) }))
    .filter((s) => s.name && /^https?:\/\//i.test(s.url))
    .slice(0, 40);
  if (!list.length) return json({ ok: false, error: "at least one source required" }, 400);
  const set = { id: "s" + Date.now(), list, at: Date.now() };
  await env.SUBS.put("cfg:sources", JSON.stringify(set));
  return json({ ok: true, sources: set });
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

/**
 * Manga has no airing schedule — AniList publishes a chapter COUNT and nothing
 * about when the next one lands. So this notices the count going up, which is
 * the honest version of "a chapter is out": it follows AniList's data, which
 * itself trails a real release by a day or two.
 */
async function fetchMangaChapters(ids) {
  const out = new Map();
  for (const batch of chunk(ids, 50)) {
    const q = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:MANGA){id chapters title{romaji english}}}}`;
    let data = null;
    try {
      const r = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: q, variables: { ids: batch } }),
      });
      if (r.status === 429) { await sleep(5000); continue; }
      data = await r.json().catch(() => null);
    } catch { /* leave this batch for the next run */ }
    const media = data?.data?.Page?.media || [];
    for (const m of media) {
      if (!m || !m.id || !m.chapters) continue;
      out.set(m.id, { chapters: m.chapters, title: (m.title && (m.title.english || m.title.romaji)) || "A series" });
    }
    await sleep(700);
  }
  return out;
}

async function notifyNewChapters(env, subs) {
  const idSet = new Set();
  for (const { record } of subs) for (const id of record.mangaIds || []) idSet.add(id);
  const ids = [...idSet];
  if (!ids.length) return;

  const now = await fetchMangaChapters(ids);
  if (!now.size) return;

  for (const { key, record } of subs) {
    if (!record.chapters || typeof record.chapters !== "object") record.chapters = {};
    let dirty = false, expired = false;
    for (const id of record.mangaIds || []) {
      const cur = now.get(id);
      if (!cur) continue;
      const seen = record.chapters[id];
      // First time we've seen this series: remember the count, say nothing.
      // Otherwise every manga on every list would announce itself on day one.
      if (seen === undefined) { record.chapters[id] = cur.chapters; dirty = true; continue; }
      if (cur.chapters <= seen) continue;
      const res = await sendPush(record.subscription, {
        title: cur.title,
        body: `Chapter ${cur.chapters} is out`,
        url: "/",
        tag: "wl-ch-" + id,
      }, env);
      if (res && res.expired) { expired = true; break; }
      record.chapters[id] = cur.chapters;
      dirty = true;
      await sleep(250);
    }
    if (expired) { await env.SUBS.delete(key); continue; }
    if (dirty) await env.SUBS.put(key, JSON.stringify(record));
  }
}

async function handleScheduled(env) {
  const subs = await loadAllSubs(env);
  if (subs.length === 0) return;
  // Manga first and independently: an early return in the airing pass (nothing
  // aired in the last 40 minutes, which is most runs) must not skip it.
  try { await notifyNewChapters(env, subs); } catch (e) {}

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
        // Deep-link straight at the show in their list, rather than the home
        // screen — the whole point of the alert is "go watch this one".
        url: `/?show=${mediaId}`,
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
