import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runHelper, HelperError } from "../src/helper.js";

const here = dirname(fileURLToPath(import.meta.url));
const fake = join(here, "fixtures", "fake-helper.mjs");

describe("runHelper", () => {
  it("returns data on ok response", async () => {
    const data = await runHelper(fake, "list-calendars");
    expect(data).toEqual([
      { id: "c1", title: "Home", writable: true, isDefault: true },
    ]);
  });

  it("passes args through to the helper", async () => {
    const data = await runHelper(fake, "echo", { a: 1, b: "x" });
    expect(data).toEqual({ a: 1, b: "x" });
  });

  it("throws HelperError with code on failure", async () => {
    await expect(runHelper(fake, "boom")).rejects.toMatchObject({
      name: "HelperError",
      code: "NOT_FOUND",
      message: "nope",
    });
  });

  it("throws on unparseable helper output", async () => {
    await expect(runHelper(fake, "garbage")).rejects.toBeInstanceOf(HelperError);
  });
});
