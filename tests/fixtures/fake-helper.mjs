#!/usr/bin/env node
// Читает JSON-команду из stdin, отвечает каноничным JSON в stdout.
let buf = "";
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  let cmd;
  try {
    cmd = JSON.parse(buf);
  } catch {
    process.stdout.write(
      JSON.stringify({ ok: false, code: "BAD_INPUT", error: "bad json" })
    );
    return;
  }
  if (cmd.command === "list-calendars") {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        data: [{ id: "c1", title: "Home", writable: true, isDefault: true }],
      })
    );
  } else if (cmd.command === "boom") {
    process.stdout.write(
      JSON.stringify({ ok: false, code: "NOT_FOUND", error: "nope" })
    );
  } else if (cmd.command === "echo") {
    process.stdout.write(JSON.stringify({ ok: true, data: cmd.args }));
  } else {
    process.stdout.write("not json at all");
  }
});
