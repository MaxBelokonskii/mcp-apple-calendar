import { spawn } from "node:child_process";

export class HelperError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HelperError";
    this.code = code;
  }
}

export interface HelperResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

export function runHelper(
  binPath: string,
  command: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => reject(new HelperError("INTERNAL", e.message)));
    child.on("close", () => {
      let parsed: HelperResponse;
      try {
        parsed = JSON.parse(out);
      } catch {
        reject(new HelperError("INTERNAL", `Bad helper output: ${out || err}`));
        return;
      }
      if (parsed.ok) resolve(parsed.data);
      else
        reject(
          new HelperError(parsed.code ?? "INTERNAL", parsed.error ?? "Unknown error")
        );
    });
    child.stdin.write(JSON.stringify({ command, args }));
    child.stdin.end();
  });
}
