import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
});
const packDirectory = mkdtempSync(path.join(tmpdir(), "billing-package-"));
const packOut = execFileSync(
    "pnpm",
    ["pack", "--pack-destination", packDirectory],
    {
        cwd: root,
        encoding: "utf8",
    },
);
const packedName = packOut
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);
if (!packedName) {
    throw new Error(`pnpm pack did not print a tarball:\n${packOut}`);
}
const tarball = path.isAbsolute(packedName)
    ? packedName
    : path.join(packDirectory, path.basename(packedName));
const dir = mkdtempSync(path.join(tmpdir(), "billing-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
        {
            name: "consumer",
            type: "module",
            private: true,
            packageManager: "pnpm@10.22.0",
            pnpm: { ignoredBuiltDependencies: ["esbuild"] },
        },
        null,
        2,
    ),
);
execFileSync("pnpm", ["add", tarball, "--ignore-scripts"], {
    cwd: dir,
    stdio: "inherit",
});
const pkg = JSON.parse(
    readFileSync(
        path.join(dir, "node_modules/@codelitdev/billing/package.json"),
        "utf8",
    ),
);
if (JSON.stringify(pkg.exports).includes("src/")) {
    throw new Error("src export present");
}
if (!pkg.exports["./core"]?.import) {
    throw new Error("missing core export");
}
writeFileSync(
    path.join(dir, "assert.mjs"),
    `
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideCheckoutTransition, money } from "@codelitdev/billing/core";
import { toPublicCatalog } from "@codelitdev/billing/catalog";
import { drizzleBillingAdapter } from "@codelitdev/billing/drizzle";
import { createContractFake, runBillingProviderContract } from "@codelitdev/billing/testing";

const m = money(4900, "usd");
if (m.currency !== "USD" || m.amountMinor !== 4900) throw new Error("money");
const denied = decideCheckoutTransition("completed", "open", {
  now: new Date(),
  expiresAt: new Date(),
});
if (denied.allowed) throw new Error("illegal transition accepted");
const view = toPublicCatalog(1, [{
  key: "pro_month",
  revision: 1,
  plan: "pro",
  interval: "month",
  currency: "USD",
  amountMinor: 4900,
  provider: "fake",
  providerProductId: "pdt_pro_month",
  providerTrialDays: 14,
}], true);
if (JSON.stringify(view).includes("pdt_")) throw new Error("provider id leaked");
const adapterInstance = drizzleBillingAdapter(
  { transaction: async (fn) => fn({}) },
  { schema: {}, clock: { now: () => new Date() } },
);
if (typeof adapterInstance.insertSubscriptionProjection !== "function") {
  throw new Error("insertSubscriptionProjection missing from packed drizzle export");
}
if (typeof adapterInstance.getSubscriptionProjection !== "function") {
  throw new Error("getSubscriptionProjection missing from packed drizzle export");
}
const packedRoot = join(dirname(fileURLToPath(import.meta.url)), "node_modules/@codelitdev/billing");
const engineSrc = readFileSync(join(packedRoot, "dist/workflows/engine.js"), "utf8");
const drizzleSrc = readFileSync(join(packedRoot, "dist/adapters/drizzle/index.js"), "utf8");
if (!drizzleSrc.includes("insertSubscriptionProjection")) {
  throw new Error("packed drizzle adapter missing insertSubscriptionProjection");
}
if (engineSrc.includes("recovered@example.com")) {
  throw new Error("packed workflows still hardcode recovered@example.com");
}
if (!engineSrc.includes("record.subscriptionId")) {
  throw new Error("packed webhook worker does not retrieve envelope subscriptionId");
}
const { adapter, helpers } = createContractFake();
await runBillingProviderContract(adapter, helpers);
console.log("packed-exports-ok");
`,
);
execFileSync("node", [path.join(dir, "assert.mjs")], {
    cwd: dir,
    stdio: "inherit",
});
console.log(`tarball=${tarball}`);
console.log(`consumer=${dir}`);
