// Offline tests for GitHubOidcVerifier's pure JWT logic (F51). Only the JWKS fetch is
// network; everything else — alg pinning, signature verification, exp/nbf, kid
// resolution + the rotation refetch — runs against an injected key source. Keys and
// tokens are minted in-test with Web Crypto (no fixtures, no network, deterministic
// modulo the test host's clock, which the claims are built from).

import { test, expect, beforeAll } from "bun:test";
import { GitHubOidcVerifier } from "../src/publish";

const KID = "test-key-1";

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const encJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const nowSec = () => Math.floor(Date.now() / 1000);
const goodPayload = () => ({
  iss: "https://token.actions.githubusercontent.com",
  aud: "objectcore-registry",
  repository: "twofoldtech-dakota/objectcore",
  exp: nowSec() + 300,
});

async function signJwt(header: unknown, payload: unknown): Promise<string> {
  const h = encJson(header);
  const p = encJson(payload);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

/** A verifier whose key source is the in-test JWK — the network path is never hit. */
function verifierWith(keySets: Record<string, unknown>[][]): { v: GitHubOidcVerifier; calls: () => number } {
  let call = 0;
  const v = new GitHubOidcVerifier(
    "https://token.actions.githubusercontent.com",
    10 * 60 * 1000,
    async () => keySets[Math.min(call++, keySets.length - 1)] as never,
  );
  return { v, calls: () => call };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID };
});

test("verify accepts a valid RS256 token and returns its claims", async () => {
  const { v } = verifierWith([[publicJwk]]);
  const payload = goodPayload();
  const claims = await v.verify(await signJwt({ alg: "RS256", kid: KID }, payload));
  expect(claims.repository).toBe("twofoldtech-dakota/objectcore");
  expect(claims.exp).toBe(payload.exp);
});

test("verify rejects alg none / HS256 before touching keys", async () => {
  const { v, calls } = verifierWith([[publicJwk]]);
  await expect(v.verify(await signJwt({ alg: "none", kid: KID }, goodPayload()))).rejects.toThrow(/unsupported alg/);
  await expect(v.verify(await signJwt({ alg: "HS256", kid: KID }, goodPayload()))).rejects.toThrow(/unsupported alg/);
  expect(calls()).toBe(0); // rejected before any key lookup
});

test("verify rejects malformed tokens", async () => {
  const { v } = verifierWith([[publicJwk]]);
  await expect(v.verify("")).rejects.toThrow(/malformed JWT/);
  await expect(v.verify("only.two")).rejects.toThrow(/malformed JWT/);
});

test("verify rejects an expired token (boundary: exp === now is expired)", async () => {
  const { v } = verifierWith([[publicJwk]]);
  const expired = await signJwt({ alg: "RS256", kid: KID }, { ...goodPayload(), exp: nowSec() - 10 });
  await expect(v.verify(expired)).rejects.toThrow(/token expired/);
  const boundary = await signJwt({ alg: "RS256", kid: KID }, { ...goodPayload(), exp: nowSec() });
  await expect(v.verify(boundary)).rejects.toThrow(/token expired/);
});

test("verify rejects a token with no exp — a signed token must not live forever", async () => {
  const { v } = verifierWith([[publicJwk]]);
  const { exp: _exp, ...noExp } = goodPayload();
  const token = await signJwt({ alg: "RS256", kid: KID }, noExp);
  await expect(v.verify(token)).rejects.toThrow(/missing exp/);
});

test("verify rejects a not-yet-valid token (future nbf)", async () => {
  const { v } = verifierWith([[publicJwk]]);
  const token = await signJwt({ alg: "RS256", kid: KID }, { ...goodPayload(), nbf: nowSec() + 300 });
  await expect(v.verify(token)).rejects.toThrow(/not yet valid/);
});

test("verify rejects a tampered signature", async () => {
  const { v } = verifierWith([[publicJwk]]);
  const [h, p, sig] = (await signJwt({ alg: "RS256", kid: KID }, goodPayload())).split(".");
  const flippedSig = (sig![0] === "A" ? "B" : "A") + sig!.slice(1); // first char = 6 real bits
  await expect(v.verify(`${h}.${p}.${flippedSig}`)).rejects.toThrow(/signature verification failed/);
});

test("an unknown kid forces ONE JWKS refetch (key rotation), then succeeds", async () => {
  // First key set is stale (empty); the forced refetch returns the rotated-in key.
  const { v, calls } = verifierWith([[], [publicJwk]]);
  const claims = await v.verify(await signJwt({ alg: "RS256", kid: KID }, goodPayload()));
  expect(claims.repository).toBe("twofoldtech-dakota/objectcore");
  expect(calls()).toBe(2); // initial fetch + exactly one forced refresh
});

test("a still-unknown kid after the refetch fails, and junk kids cannot fetch per-request (cooldown)", async () => {
  const { v, calls } = verifierWith([[publicJwk]]);
  const junk = await signJwt({ alg: "RS256", kid: "no-such-kid" }, goodPayload());
  await expect(v.verify(junk)).rejects.toThrow(/unknown kid/);
  const after = calls(); // initial fetch + the one forced refresh
  expect(after).toBe(2);
  // A second junk kid inside the 30s cooldown must not trigger another fetch.
  await expect(v.verify(junk)).rejects.toThrow(/unknown kid/);
  expect(calls()).toBe(after);
});
