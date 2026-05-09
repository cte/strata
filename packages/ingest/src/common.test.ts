import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadDotenv } from "./common.js";

test("loadDotenv skips dotenvx ciphertext values", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-dotenv-"));
  const envPath = path.join(repoRoot, ".env");
  const previousPlain = process.env["STRATA_DOTENV_TEST_PLAIN"];
  const previousEncrypted = process.env["STRATA_DOTENV_TEST_ENCRYPTED"];

  delete process.env["STRATA_DOTENV_TEST_PLAIN"];
  delete process.env["STRATA_DOTENV_TEST_ENCRYPTED"];

  try {
    await writeFile(
      envPath,
      ['STRATA_DOTENV_TEST_PLAIN="ok"', 'STRATA_DOTENV_TEST_ENCRYPTED="encrypted:abc123"', ""].join(
        "\n",
      ),
      "utf8",
    );

    await loadDotenv(envPath);

    expect(process.env["STRATA_DOTENV_TEST_PLAIN"]).toBe("ok");
    expect(process.env["STRATA_DOTENV_TEST_ENCRYPTED"]).toBeUndefined();
  } finally {
    if (previousPlain === undefined) {
      delete process.env["STRATA_DOTENV_TEST_PLAIN"];
    } else {
      process.env["STRATA_DOTENV_TEST_PLAIN"] = previousPlain;
    }
    if (previousEncrypted === undefined) {
      delete process.env["STRATA_DOTENV_TEST_ENCRYPTED"];
    } else {
      process.env["STRATA_DOTENV_TEST_ENCRYPTED"] = previousEncrypted;
    }
    await rm(repoRoot, { force: true, recursive: true });
  }
});
