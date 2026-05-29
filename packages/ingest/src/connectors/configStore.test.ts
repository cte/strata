import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getConnectorConfigPath,
  listConnectorConfigProfiles,
  readDefaultConnectorConfigProfile,
  sanitizeConnectorConfig,
  setDefaultConnectorConfigProfile,
  writeConnectorConfigProfile,
} from "../connectors.js";

describe("connector config store", () => {
  test("stores non-secret connector defaults and tracks the default profile", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-connector-config-"));
    try {
      const first = await writeConnectorConfigProfile({
        connector: "slack",
        id: "team-sync",
        label: "Team sync",
        config: {
          channels: "eng,product",
          includePrivateChannels: true,
          maxThreads: 100,
          mode: "sync",
        },
        makeDefault: true,
        repoRoot,
        now: new Date("2026-05-27T10:00:00.000Z"),
      });

      expect(first).toMatchObject({
        id: "team-sync",
        isDefault: true,
        config: {
          channels: "eng,product",
          includePrivateChannels: true,
          maxThreads: 100,
          mode: "sync",
        },
      });

      await writeConnectorConfigProfile({
        connector: "slack",
        id: "low-impact",
        config: { channelRegex: "^team-", maxChannels: 10 },
        repoRoot,
        now: new Date("2026-05-27T11:00:00.000Z"),
      });
      const defaultProfile = await readDefaultConnectorConfigProfile("slack", repoRoot);
      expect(defaultProfile?.id).toBe("team-sync");

      await setDefaultConnectorConfigProfile({
        connector: "slack",
        id: "low-impact",
        repoRoot,
      });
      const profiles = await listConnectorConfigProfiles("slack", repoRoot);
      expect(profiles.map((profile) => [profile.id, profile.isDefault])).toEqual([
        ["low-impact", true],
        ["team-sync", false],
      ]);

      const file = await readFile(getConnectorConfigPath("slack", repoRoot), "utf8");
      expect(file).toContain('"channelRegex": "^team-"');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("rejects schema and nested secret fields", () => {
    expect(() =>
      sanitizeConnectorConfig("granola", {
        apiToken: "secret_should_not_store",
      }),
    ).toThrow("apiToken");

    expect(() =>
      sanitizeConnectorConfig("slack", {
        headers: {
          authorization: "Bearer secret_should_not_store",
        },
      }),
    ).toThrow("headers.authorization");
  });
});
