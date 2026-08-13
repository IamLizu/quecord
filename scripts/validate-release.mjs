import { appendFileSync, readFileSync } from "node:fs";

const tag = process.env.RELEASE_TAG;
const semverTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!tag || !semverTag.test(tag)) {
  throw new Error(`Release tag "${tag ?? ""}" is not valid SemVer`);
}

const version = tag.startsWith("v") ? tag.slice(1) : tag;
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (packageJson.version !== version) {
  throw new Error(
    `Release tag version ${version} does not match package.json version ${packageJson.version}`,
  );
}

const distTag = version.includes("-") ? "next" : "latest";
console.log(`Validated ${tag}; npm dist-tag will be ${distTag}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\ndist-tag=${distTag}\n`,
  );
}
