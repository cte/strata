import { describe, expect, test } from "bun:test";
import { formatCliVersion } from "../version.js";

describe("formatCliVersion", () => {
  test("prints plain release versions", () => {
    expect(formatCliVersion({ version: "1.2.3", dev: false })).toBe("strata 1.2.3");
  });

  test("includes git sha for dev versions", () => {
    expect(formatCliVersion({ version: "1.2.3", dev: true, gitSha: "abc123def456" })).toBe(
      "strata 1.2.3-dev+abc123def456",
    );
  });

  test("marks dirty dev versions", () => {
    expect(
      formatCliVersion({ version: "1.2.3", dev: true, gitSha: "abc123def456", dirty: true }),
    ).toBe("strata 1.2.3-dev+abc123def456.dirty");
  });
});
