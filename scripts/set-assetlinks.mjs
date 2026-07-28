#!/usr/bin/env node
/**
 * Write .well-known/assetlinks.json for the Android app.
 *
 * Without this file the wrapper runs with Chrome's URL bar pinned across the
 * top — it works, but it reads as a browser, not an app. With it, Android
 * verifies that this site and that APK belong to the same owner and the bar
 * disappears. The proof is the APK's signing certificate fingerprint, which
 * only exists once the APK has been signed — hence a script rather than a
 * checked-in file with a made-up value.
 *
 *   node scripts/set-assetlinks.mjs <SHA256_FINGERPRINT> [package.name]
 *
 * The fingerprint is the "SHA-256 Certificate Fingerprint" PWABuilder shows
 * after packaging (or: keytool -list -v -keystore your.keystore). Colons and
 * case don't matter — they're normalised here.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", ".well-known", "assetlinks.json");
const DEFAULT_PKG = "io.github.theteknojunkie456.animelist";

const raw = process.argv[2];
const pkg = process.argv[3] || DEFAULT_PKG;

if (!raw) {
  console.error("usage: node scripts/set-assetlinks.mjs <SHA256_FINGERPRINT> [package.name]");
  process.exit(1);
}

const fp = raw.trim().toUpperCase().replace(/[^0-9A-F]/g, "").match(/.{2}/g)?.join(":") || "";
if (fp.split(":").length !== 32) {
  console.error(`that doesn't look like a SHA-256 fingerprint (got ${fp.split(":").length} bytes, expected 32)`);
  process.exit(1);
}

const body = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: [fp] },
  },
];

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(body, null, 2) + "\n");
console.log(`wrote .well-known/assetlinks.json\n  package: ${pkg}\n  sha256 : ${fp}`);
console.log("\nCommit and push, then verify it's live:");
console.log("  curl -s https://theteknojunkie456.github.io/anime-list/.well-known/assetlinks.json");
