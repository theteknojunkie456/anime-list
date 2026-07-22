#!/usr/bin/env node
/**
 * Announce the current RELEASE to every notification subscriber.
 *
 * Reads the RELEASE block straight out of index.html (single source of truth —
 * the same notes users see in the in-app "What's new" sheet), turns it into a
 * short push body, and POSTs it to the notify worker's /broadcast endpoint.
 *
 *   NOTIFY_ADMIN_TOKEN=xxaa node scripts/announce.mjs
 *
 * Env:
 *   NOTIFY_ADMIN_TOKEN  (required) must match the worker's ADMIN_TOKEN secret
 *   NOTIFY_URL          (optional) override the worker origin
 *
 * Idempotent by version: the push tag is watchlist-update-<RELEASE.v>, so a
 * re-run for the same version collapses into the one banner rather than nagging.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, "..", "index.html");
const NOTIFY_URL = process.env.NOTIFY_URL || "https://watchlist-notify.muhammad-dac.workers.dev";
const TOKEN = process.env.NOTIFY_ADMIN_TOKEN;

function fail(msg) { console.error("announce: " + msg); process.exit(1); }

// Pull `const RELEASE = { ... };` out of the HTML and evaluate just that literal.
function extractRelease(html) {
  const m = html.match(/const RELEASE\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) fail("could not find RELEASE in index.html");
  // The literal is plain data (strings/arrays). Function-wrap so it's evaluated
  // in isolation, not the page context.
  try { return Function("return (" + m[1] + ");")(); }
  catch (e) { fail("RELEASE is not a plain literal: " + e.message); }
}

const stripTags = (s) => String(s).replace(/<[^>]+>/g, "");

async function main() {
  if (!TOKEN) fail("NOTIFY_ADMIN_TOKEN is required");
  const html = await readFile(INDEX, "utf8");
  const rel = extractRelease(html);
  const title = stripTags(rel.title || "WatchList update");
  // Notes → one compact line. Keep it short; push bodies get truncated by the OS.
  let body = (rel.notes || []).map(stripTags).join(" • ");
  if (body.length > 350) body = body.slice(0, 347) + "…";

  const res = await fetch(NOTIFY_URL + "/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: TOKEN,
      title,
      body,
      tag: "watchlist-update-" + (rel.v || "x"),
      url: "/",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) fail("broadcast failed (" + res.status + "): " + JSON.stringify(out));
  console.log(`announced "${title}" (v${rel.v}) → sent ${out.sent}, expired ${out.dead}, failed ${out.failed}, of ${out.total}`);
}

main().catch((e) => fail(e && e.message));
