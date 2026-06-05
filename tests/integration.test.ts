import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runHelper, HelperError } from "../src/helper.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "calendar-helper");

const hasBin = existsSync(bin);
const d = hasBin ? describe : describe.skip;

d("integration (macOS, requires Calendar access)", () => {
  let hasAccess = false;
  beforeAll(async () => {
    try {
      const r = (await runHelper(bin, "request-access")) as { granted: boolean };
      hasAccess = r.granted;
    } catch {
      hasAccess = false;
    }
  });

  it("create → get → update → delete round trip", async () => {
    if (!hasAccess) {
      console.warn("skip: no calendar access");
      return;
    }
    const created = (await runHelper(bin, "create-event", {
      title: "MCP integration test",
      startDate: "2026-06-15T10:00:00+03:00",
      endDate: "2026-06-15T11:00:00+03:00",
      alarms: [{ minutesBefore: 10 }],
    })) as { id: string; title: string };
    expect(created.id).toBeTruthy();

    const fetched = (await runHelper(bin, "get-event", {
      id: created.id,
    })) as { title: string };
    expect(fetched.title).toBe("MCP integration test");

    const updated = (await runHelper(bin, "update-event", {
      id: created.id,
      title: "MCP integration test (edited)",
    })) as { title: string };
    expect(updated.title).toBe("MCP integration test (edited)");

    const del = (await runHelper(bin, "delete-event", {
      id: created.id,
    })) as { deleted: boolean };
    expect(del.deleted).toBe(true);

    await expect(
      runHelper(bin, "get-event", { id: created.id })
    ).rejects.toBeInstanceOf(HelperError);
  });
});
