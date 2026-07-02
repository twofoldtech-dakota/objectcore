// Self-service publish (POST /v1/plugins) — the heaviest write path: the HTTP
// analogue of the release pipeline. Ports + adapters, the same shape as the catalog
// sources/sinks and the eval Judge: an `OidcVerifier` port (MockOidcVerifier for
// gate tests; GitHubOidcVerifier for the live path), a pure `authorizePollicy`/
// `parsePublish`, and a `toStoredPlugin` that hands the result to the `CatalogStore`
// write port. The provenance gate is re-enforced at the route (registry-server),
// reusing @objectcore/release's `requiresProvenance` so the rule is single-sourced.
//
// The server NEVER re-runs git: the publisher (release CI, holding a GitHub Actions
// OIDC token) supplies the manifest + pin coordinates it already computed. The `ref`
// is recomputed server-side via `releaseTag` — not trusted from the client.

import type { PluginManifest, WorkspacePlugin } from "./types";
import type { StoredPlugin } from "./sources";
import { validateSchema } from "./schema";
import { releaseTag } from "./tags";

// ── OIDC verification (the port + two adapters) ────────────────────────────────

/** The verified claims we care about. GitHub Actions tokens carry many more; this is
 *  the subset the publish policy checks. Index signature keeps the rest accessible. */
export interface OidcClaims {
  iss: string;
  aud: string;
  /** "owner/repo" the workflow ran in. */
  repository?: string;
  /** e.g. "repo:owner/repo:ref:refs/heads/main". */
  sub?: string;
  /** The git ref the workflow ran on, e.g. "refs/heads/main". */
  ref?: string;
  exp?: number;
  nbf?: number;
  [k: string]: unknown;
}

/** The verifier port: turn a bearer token into trusted claims, or throw. */
export interface OidcVerifier {
  verify(token: string): Promise<OidcClaims>;
}

/** Deterministic, offline verifier for tests / CI without a live IdP — the publish
 *  analogue of MockJudge / InMemoryCatalogStore. Maps known tokens to claims. */
export class MockOidcVerifier implements OidcVerifier {
  constructor(private readonly fixture: Record<string, OidcClaims> = {}) {}
  async verify(token: string): Promise<OidcClaims> {
    const claims = this.fixture[token];
    if (!claims) throw new Error("MockOidcVerifier: unknown token");
    return claims;
  }
}

/** Minimal JWK shape (Bun's types don't expose a `JsonWebKey` global; importKey
 *  structurally checks the object). */
interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

// Returns an ArrayBuffer-backed view (no annotation -> Uint8Array<ArrayBuffer>, which
// crypto.subtle.verify's BufferSource param requires).
function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/** The live verifier: validates a GitHub Actions OIDC JWT (RS256) against the
 *  issuer's JWKS via Web Crypto — no JWT dependency (registry-core stays dep-free,
 *  the same posture as the hand-rolled schema check). Only the JWKS fetch is the
 *  untested network path (like AnthropicJudge); the JWT checks themselves (alg,
 *  signature, exp/nbf, kid resolution) run against an injectable key source and are
 *  gate-tested offline. Fails CLOSED: any malformed token, unknown key, bad
 *  signature, wrong alg, or missing/past expiry throws -> the route returns 401.
 *  iss/aud/repository/ref are checked by {@link authorizePublish}, not here. */
export class GitHubOidcVerifier implements OidcVerifier {
  private jwks: { at: number; keys: Jwk[] } | null = null;
  private lastForcedAt = 0;
  /** Junk kids from unauthenticated callers must not become a JWKS fetch per
   *  request: at most one forced (rotation) refetch per cooldown window. */
  private static readonly FORCE_REFRESH_COOLDOWN_MS = 30_000;

  private readonly fetchJwks: (issuer: string) => Promise<Jwk[]>;

  constructor(
    private readonly issuer = "https://token.actions.githubusercontent.com",
    private readonly jwksTtlMs = 10 * 60 * 1000,
    /** Injectable key source (tests run the JWT logic offline); defaults to the
     *  issuer's live /.well-known/jwks. */
    fetchJwks?: (issuer: string) => Promise<Jwk[]>,
  ) {
    this.fetchJwks =
      fetchJwks ??
      (async (iss) => {
        const res = await fetch(`${iss.replace(/\/+$/, "")}/.well-known/jwks`);
        if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
        const body = (await res.json()) as { keys: Jwk[] };
        return body.keys;
      });
  }

  private async keys(forceRefresh = false): Promise<Jwk[]> {
    const now = Date.now();
    const fresh = this.jwks !== null && now - this.jwks.at < this.jwksTtlMs;
    if (forceRefresh) {
      if (now - this.lastForcedAt < GitHubOidcVerifier.FORCE_REFRESH_COOLDOWN_MS) {
        return this.jwks?.keys ?? [];
      }
      this.lastForcedAt = now;
    } else if (fresh) {
      return this.jwks!.keys;
    }
    const keys = await this.fetchJwks(this.issuer);
    this.jwks = { at: now, keys };
    return keys;
  }

  async verify(token: string): Promise<OidcClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed JWT");
    const [h, p, sig] = parts;

    const header = JSON.parse(b64urlToString(h)) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") throw new Error(`unsupported alg: ${header.alg}`); // reject none/HS*

    let jwk = (await this.keys()).find((k) => k.kid === header.kid);
    if (!jwk) {
      // Key rotation: the kid may be newer than the cached set — refetch once
      // (cooldown-guarded) before failing, so a rotation is not a jwksTtlMs outage.
      jwk = (await this.keys(true)).find((k) => k.kid === header.kid);
      if (!jwk) throw new Error(`unknown kid: ${header.kid}`);
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) throw new Error("signature verification failed");

    const claims = JSON.parse(b64urlToString(p)) as OidcClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    // exp is REQUIRED: a signed token without one would otherwise live forever.
    // GitHub Actions tokens always carry it, so nothing legitimate breaks.
    if (typeof claims.exp !== "number" || nowSec >= claims.exp) {
      throw new Error("token expired or missing exp");
    }
    if (typeof claims.nbf === "number" && nowSec < claims.nbf) throw new Error("token not yet valid");
    return claims;
  }
}

// ── Authorization policy (pure) ────────────────────────────────────────────────

/** Who may publish: a token from the expected issuer + audience whose `repository`
 *  claim is allowlisted. Configured from env in prod.ts (inert until set). */
export interface PublishPolicy {
  issuer: string;
  audience: string;
  allowedRepositories: string[];
  /** When set, the token's `ref` claim must match one of these (e.g.
   *  "refs/heads/main"). GitHub mints id-tokens for ANY workflow on ANY branch of an
   *  allowlisted repo, so without a ref restriction a PR-branch workflow bypasses the
   *  release gate. Missing ref claim = rejected — fail closed. */
  allowedRefs?: string[];
}

export type AuthzResult = { ok: true } | { ok: false; error: string };

/** Pure check of verified claims against the policy. Rejects an absent repository
 *  (or, when refs are restricted, an absent ref) claim — can't authorize what we
 *  can't identify; fail closed. */
export function authorizePublish(claims: OidcClaims, policy: PublishPolicy): AuthzResult {
  if (claims.iss !== policy.issuer) return { ok: false, error: "untrusted issuer" };
  if (claims.aud !== policy.audience) return { ok: false, error: "wrong audience" };
  const repo = typeof claims.repository === "string" ? claims.repository : undefined;
  if (!repo) return { ok: false, error: "missing repository claim" };
  if (!policy.allowedRepositories.includes(repo)) {
    return { ok: false, error: `repository not allowed: ${repo}` };
  }
  if (policy.allowedRefs?.length) {
    const ref = typeof claims.ref === "string" ? claims.ref : undefined;
    if (!ref) return { ok: false, error: "missing ref claim" };
    if (!policy.allowedRefs.includes(ref)) {
      return { ok: false, error: `ref not allowed: ${ref}` };
    }
  }
  return { ok: true };
}

/** Bind a published `repoUrl` to the verified OIDC `repository` claim: an allowlisted
 *  repo must not publish pins pointing at a repo it doesn't control (a spoofed pin
 *  serves attacker content at install time). Case-insensitive; tolerates a trailing
 *  ".git" and trailing slashes — anything else is a mismatch, fail closed. */
export function repoUrlMatchesClaim(repoUrl: string, repository: string): boolean {
  const norm = repoUrl.toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
  return norm === `https://github.com/${repository.toLowerCase()}`;
}

// ── Request shape + strict parse (pure) ────────────────────────────────────────

/** The publish request body. `ref` is intentionally NOT accepted — it is recomputed
 *  from name+version. `bundlesMcp` lets the publisher declare a root `.mcp.json` the
 *  server can't see (the disk half of the provenance gate). */
export interface PublishRequest {
  manifest: PluginManifest;
  relDir: string;
  version: string;
  sha: string;
  repoUrl: string;
  channel?: string;
  bundlesMcp?: boolean;
  provenance?: unknown;
}

export interface ValidatedPublish {
  manifest: PluginManifest;
  relDir: string;
  version: string;
  sha: string;
  ref: string;
  repoUrl: string;
  channel: string;
  bundlesMcp: boolean;
  /** Shape-checked by parsePublish: a plain JSON object, bounded in size — never
   *  null/primitive/array, so the route's `=== undefined` provenance gate is sound. */
  provenance?: Record<string, unknown>;
}

export type PublishParseResult =
  | { ok: true; value: ValidatedPublish }
  | { ok: false; error: string };

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_SHA = /^[0-9a-f]{7,64}$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** Provenance is a reference (sha/run/attestation URL), not a bundle — cap the
 *  stored blob so the gate can't be satisfied with megabytes of junk. */
const MAX_PROVENANCE_BYTES = 8192;
const ALLOWED = new Set(["manifest", "relDir", "version", "sha", "repoUrl", "channel", "bundlesMcp", "provenance"]);

/** Strict, pure validation/shaping of an untrusted publish body. Reuses the catalog's
 *  `validateSchema` so the published manifest faces the SAME strict floor as a
 *  Git-sourced one (unknown fields + wrong types rejected). Never throws. */
export function parsePublish(input: unknown): PublishParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "publish request must be a JSON object" };
  }
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown field: ${k}` };
  }

  if (typeof o.manifest !== "object" || o.manifest === null || Array.isArray(o.manifest)) {
    return { ok: false, error: "manifest must be an object" };
  }
  const manifest = o.manifest as PluginManifest;
  if (typeof manifest.name !== "string" || !KEBAB.test(manifest.name)) {
    return { ok: false, error: "manifest.name must be a kebab-case string" };
  }
  if (typeof o.relDir !== "string" || !KEBAB.test(o.relDir)) {
    return { ok: false, error: "relDir must be a kebab-case string" };
  }
  // Same strict manifest floor as the catalog (single-sourced).
  const wp: WorkspacePlugin = { manifest, dir: "", relDir: o.relDir };
  const schemaErrs = validateSchema([wp]).filter((i) => i.level === "error");
  if (schemaErrs.length) {
    return { ok: false, error: `manifest: ${schemaErrs.map((e) => e.message).join("; ")}` };
  }

  if (typeof o.version !== "string" || !SEMVER.test(o.version)) {
    return { ok: false, error: "version must be a semver string" };
  }
  if (manifest.version !== undefined && manifest.version !== o.version) {
    return { ok: false, error: "manifest.version must match the published version" };
  }
  if (typeof o.sha !== "string" || !HEX_SHA.test(o.sha)) {
    return { ok: false, error: "sha must be a hex commit sha" };
  }
  if (typeof o.repoUrl !== "string" || !/^https?:\/\//.test(o.repoUrl)) {
    return { ok: false, error: "repoUrl must be an http(s) URL" };
  }

  let channel = "stable";
  if (o.channel !== undefined) {
    if (typeof o.channel !== "string" || !KEBAB.test(o.channel)) {
      return { ok: false, error: "channel must be a kebab-case string" };
    }
    channel = o.channel;
  }
  let bundlesMcp = false;
  if (o.bundlesMcp !== undefined) {
    if (typeof o.bundlesMcp !== "boolean") return { ok: false, error: "bundlesMcp must be a boolean" };
    bundlesMcp = o.bundlesMcp;
  }

  // Presence-only would let `provenance: null` (or any junk) clear the MCP
  // attestation gate — require a plain object and bound it.
  let provenance: Record<string, unknown> | undefined;
  if (o.provenance !== undefined) {
    if (typeof o.provenance !== "object" || o.provenance === null || Array.isArray(o.provenance)) {
      return { ok: false, error: "provenance must be a JSON object" };
    }
    if (JSON.stringify(o.provenance).length > MAX_PROVENANCE_BYTES) {
      return { ok: false, error: `provenance exceeds ${MAX_PROVENANCE_BYTES} bytes serialized` };
    }
    provenance = o.provenance as Record<string, unknown>;
  }

  return {
    ok: true,
    value: {
      manifest,
      relDir: o.relDir,
      version: o.version,
      sha: o.sha,
      ref: releaseTag(manifest.name, o.version), // server-computed, not trusted
      repoUrl: o.repoUrl,
      channel,
      bundlesMcp,
      provenance,
    },
  };
}

/** The validated publish as the `CatalogStore` write port stores it — the same
 *  `StoredPlugin` shape `RegistryDbSink` produces, so reads re-derive identically.
 *  This finally populates the long-unused `provenance` column. */
export function toStoredPlugin(v: ValidatedPublish): StoredPlugin {
  return {
    manifest: v.manifest,
    relDir: v.relDir,
    version: v.version,
    sha: v.sha,
    ref: v.ref,
    repoUrl: v.repoUrl,
    provenance: v.provenance,
  };
}
