/**
 * Point Formula/gitrole.rb at one published npm tarball.
 *
 * The formula lives in synthesiseng/homebrew-tap. This updates the registry
 * tarball url, the first sha256, an optional version line, and other copies of
 * the previous X.Y.Z formula version. It does not create a formula.
 */

import fs from "node:fs";

const TARBALL_URL =
  /^([ \t]*url[ \t]+)(["'])https:\/\/registry\.npmjs\.org\/gitrole\/-\/gitrole-(?:(\d+\.\d+\.\d+)|#\{version\})\.tgz\2/m;

const SHA256_LINE = /^([ \t]*sha256[ \t]+)(["'])[a-fA-F0-9]{64}\2/m;

const VERSION_LINE = /^([ \t]*version[ \t]+)(["'])([^"']+)\2/m;

export function bumpFormulaText(text, { version, tarballUrl, sha256 }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    throw new Error(`package version must use X.Y.Z format; got ${version}`);
  }

  const expectedUrl = `https://registry.npmjs.org/gitrole/-/gitrole-${version}.tgz`;
  if (tarballUrl !== expectedUrl) {
    throw new Error(`tarball url must be ${expectedUrl}`);
  }

  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("sha256 must be 64 lowercase hex characters");
  }

  const urlMatch = text.match(TARBALL_URL);
  if (!urlMatch) {
    throw new Error(
      'Formula/gitrole.rb must declare url "https://registry.npmjs.org/gitrole/-/gitrole-<version>.tgz" or url "https://registry.npmjs.org/gitrole/-/gitrole-#{version}.tgz".',
    );
  }

  const literalVersion = urlMatch[3];
  const versionMatch = text.match(VERSION_LINE);
  const interpolatesVersion = urlMatch[0].includes("#{version}");

  if (interpolatesVersion && !versionMatch) {
    throw new Error(
      "Formula/gitrole.rb url interpolates #{version} but there is no version line to bump.",
    );
  }

  const previousVersion = literalVersion ?? versionMatch?.[3] ?? null;
  if (previousVersion !== null && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(previousVersion)) {
    throw new Error(`formula version must use X.Y.Z format; got ${previousVersion}`);
  }

  let next = text;

  if (!interpolatesVersion) {
    next = next.replace(TARBALL_URL, `$1$2${tarballUrl}$2`);
  }

  if (!SHA256_LINE.test(next)) {
    throw new Error("Formula/gitrole.rb is missing a sha256 line for the npm tarball.");
  }

  next = next.replace(SHA256_LINE, `$1$2${sha256}$2`);

  if (versionMatch) {
    next = next.replace(VERSION_LINE, `$1$2${version}$2`);
  }

  if (previousVersion && previousVersion !== version) {
    const escaped = previousVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(
      new RegExp(`(?<![\\w.])v?${escaped}(?![\\w.])`, "g"),
      (match) => (match.startsWith("v") ? `v${version}` : version),
    );
  }

  const urlLanded = next.includes(tarballUrl) || next.includes("gitrole-#{version}.tgz");
  if (!urlLanded || !next.includes(sha256)) {
    throw new Error("Formula update did not land the released url and sha256.");
  }

  if (versionMatch && !next.includes(`"${version}"`) && !next.includes(`'${version}'`)) {
    throw new Error("Formula update did not land the released version string.");
  }

  return { text: next, changed: next !== text };
}

function main() {
  const formulaPath = process.argv[2];
  const version = process.env.PACKAGE_VERSION;
  const tarballUrl = process.env.TARBALL_URL;
  const sha256 = process.env.TARBALL_SHA256;

  if (!formulaPath || !version || !tarballUrl || !sha256) {
    throw new Error(
      "usage: PACKAGE_VERSION=X.Y.Z TARBALL_URL=... TARBALL_SHA256=... node bump-homebrew-formula.mjs Formula/gitrole.rb",
    );
  }

  if (!fs.existsSync(formulaPath)) {
    throw new Error(
      "synthesiseng/homebrew-tap is missing Formula/gitrole.rb. Add that formula on the tap default branch before the next release. This job only updates its url, version, and sha256.",
    );
  }

  const current = fs.readFileSync(formulaPath, "utf8");
  const updated = bumpFormulaText(current, { version, tarballUrl, sha256 });

  if (!updated.changed) {
    console.log(`Formula/gitrole.rb already matches ${version}`);
    return;
  }

  fs.writeFileSync(formulaPath, updated.text);
  console.log(`Updated Formula/gitrole.rb to ${version}`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("bump-homebrew-formula.mjs")) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
