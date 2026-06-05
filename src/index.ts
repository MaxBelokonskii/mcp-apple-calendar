import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerTools } from "./tools/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/index.js → ../bin/calendar-helper
const binPath =
  process.env.CALENDAR_HELPER_PATH ??
  join(here, "..", "bin", "calendar-helper");

const server = new McpServer({ name: "apple-calendar", version: "0.1.0" });
registerTools(server, binPath);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
