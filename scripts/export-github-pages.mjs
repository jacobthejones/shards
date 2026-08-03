import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("dist/client");
const serverUrl = new URL("../dist/server/index.js", import.meta.url);
serverUrl.searchParams.set("export", `${process.pid}-${Date.now()}`);
const { default: handler } = await import(serverUrl.href);

const exportRoute = async (requestPath, outputPath) => {
  const response = await handler(new Request(`http://localhost${requestPath}`, {
    headers: { accept: "text/html" },
  }));
  if (!response.ok) throw new Error(`Could not export ${requestPath} (${response.status})`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await response.text());
};

// Vinext's static exporter currently skips the root route when basePath is set,
// even though the production handler can render it correctly. Materialize the
// HTML entry point from that same handler before Pages deployment.
await exportRoute("/shards/", path.join(outputRoot, "index.html"));
