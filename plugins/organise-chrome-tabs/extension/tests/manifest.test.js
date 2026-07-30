import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest is valid MV3 and requests only the expected permissions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["storage", "tabGroups", "tabs"].sort(),
  );
  assert.equal("host_permissions" in manifest, false);
});
