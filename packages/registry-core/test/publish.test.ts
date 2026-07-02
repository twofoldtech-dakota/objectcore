import { test, expect } from "bun:test";
import {
  authorizePublish,
  parsePublish,
  repoUrlMatchesClaim,
  toStoredPlugin,
  MockOidcVerifier,
  type OidcClaims,
  type PublishPolicy,
} from "../src/publish";

const policy: PublishPolicy = {
  issuer: "https://token.actions.githubusercontent.com",
  audience: "objectcore-registry",
  allowedRepositories: ["twofoldtech-dakota/objectcore"],
};

const goodClaims: OidcClaims = {
  iss: policy.issuer,
  aud: policy.audience,
  repository: "twofoldtech-dakota/objectcore",
};

const goodBody = {
  manifest: { name: "hello-objectcore", version: "0.1.0", description: "Demo", keywords: ["demo"] },
  relDir: "hello-objectcore",
  version: "0.1.0",
  sha: "abc1234",
  repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
};

// ── authorizePublish ──────────────────────────────────────────────────────────

test("authorizePublish accepts a token from the trusted issuer/audience/repo", () => {
  expect(authorizePublish(goodClaims, policy)).toEqual({ ok: true });
});

test("authorizePublish rejects a wrong issuer / audience / repo / missing repo", () => {
  expect(authorizePublish({ ...goodClaims, iss: "https://evil" }, policy).ok).toBe(false);
  expect(authorizePublish({ ...goodClaims, aud: "someone-else" }, policy).ok).toBe(false);
  expect(authorizePublish({ ...goodClaims, repository: "attacker/fork" }, policy).ok).toBe(false);
  const { repository, ...noRepo } = goodClaims;
  expect(authorizePublish(noRepo as OidcClaims, policy).ok).toBe(false);
});

test("authorizePublish without allowedRefs accepts any ref (back-compat)", () => {
  expect(authorizePublish({ ...goodClaims, ref: "refs/heads/anything" }, policy)).toEqual({ ok: true });
});

test("authorizePublish restricts refs when allowedRefs is set — missing ref fails closed", () => {
  const refPolicy: PublishPolicy = { ...policy, allowedRefs: ["refs/heads/main"] };
  expect(authorizePublish({ ...goodClaims, ref: "refs/heads/main" }, refPolicy)).toEqual({ ok: true });

  const wrongBranch = authorizePublish({ ...goodClaims, ref: "refs/heads/attacker-branch" }, refPolicy);
  expect(wrongBranch.ok).toBe(false);
  if (!wrongBranch.ok) expect(wrongBranch.error).toMatch(/ref not allowed/);

  const noRef = authorizePublish(goodClaims, refPolicy); // GitHub always sets ref; absence = fail closed
  expect(noRef.ok).toBe(false);
  if (!noRef.ok) expect(noRef.error).toMatch(/missing ref claim/);
});

test("repoUrlMatchesClaim binds the pin to the repository claim (case-insensitive, .git tolerated)", () => {
  const repo = "twofoldtech-dakota/objectcore";
  expect(repoUrlMatchesClaim("https://github.com/twofoldtech-dakota/objectcore", repo)).toBe(true);
  expect(repoUrlMatchesClaim("https://github.com/Twofoldtech-Dakota/ObjectCore.git", repo)).toBe(true);
  expect(repoUrlMatchesClaim("https://github.com/twofoldtech-dakota/objectcore/", repo)).toBe(true);
  expect(repoUrlMatchesClaim("https://github.com/attacker/objectcore", repo)).toBe(false);
  expect(repoUrlMatchesClaim("https://evil.example/twofoldtech-dakota/objectcore", repo)).toBe(false);
  expect(repoUrlMatchesClaim("https://github.com/twofoldtech-dakota/objectcore", "")).toBe(false);
});

test("MockOidcVerifier maps known tokens and throws on unknown", async () => {
  const v = new MockOidcVerifier({ "tok-ok": goodClaims });
  expect(await v.verify("tok-ok")).toEqual(goodClaims);
  await expect(v.verify("nope")).rejects.toThrow(/unknown token/);
});

// ── parsePublish ──────────────────────────────────────────────────────────────

test("parsePublish accepts a well-formed body and computes ref server-side", () => {
  const r = parsePublish(goodBody);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.ref).toBe("hello-objectcore--v0.1.0"); // never trusted from client
    expect(r.value.channel).toBe("stable");
    expect(r.value.bundlesMcp).toBe(false);
    expect(toStoredPlugin(r.value)).toMatchObject({
      relDir: "hello-objectcore",
      version: "0.1.0",
      sha: "abc1234",
      ref: "hello-objectcore--v0.1.0",
      repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
    });
  }
});

test("parsePublish rejects unknown fields, bad name/version/sha/url, mismatched manifest version", () => {
  expect(parsePublish({ ...goodBody, surprise: 1 }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, manifest: { name: "Not_Kebab" } }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, version: "not-semver" }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, sha: "zzz" }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, repoUrl: "ftp://x" }).ok).toBe(false);
  expect(
    parsePublish({ ...goodBody, manifest: { name: "hello-objectcore", version: "9.9.9" } }).ok,
  ).toBe(false);
});

test("parsePublish reuses the strict manifest schema floor (unknown manifest field)", () => {
  const r = parsePublish({ ...goodBody, manifest: { name: "hello-objectcore", repositry: "typo" } });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/unknown manifest field/);
});

test("parsePublish rejects non-object / oversized provenance (presence alone must not clear the gate)", () => {
  expect(parsePublish({ ...goodBody, provenance: null }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, provenance: "x" }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, provenance: 1 }).ok).toBe(false);
  expect(parsePublish({ ...goodBody, provenance: [{ ref: "att://x" }] }).ok).toBe(false);
  const oversized = parsePublish({ ...goodBody, provenance: { blob: "x".repeat(9000) } });
  expect(oversized.ok).toBe(false);
  if (!oversized.ok) expect(oversized.error).toMatch(/provenance exceeds/);
});

test("parsePublish carries bundlesMcp + provenance through", () => {
  const r = parsePublish({ ...goodBody, bundlesMcp: true, provenance: { ref: "att://x" } });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.bundlesMcp).toBe(true);
    expect(r.value.provenance).toEqual({ ref: "att://x" });
  }
});
