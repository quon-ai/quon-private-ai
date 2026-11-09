/**
 * Minimal Node HTTP server for the TanStack Start production bundle.
 * Serves dist/ without requiring node_modules on the host.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../dist/server/server.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const clientRoot = join(root, "dist/client");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  // application/wasm is required for WebAssembly streaming compilation (the
  // self-hosted ONNX Runtime under /ort/).
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function serveStatic(pathname) {
  const filePath = join(clientRoot, pathname.replace(/^\//, ""));
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const data = await readFile(filePath);
    return new Response(data, {
      headers: { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" },
    });
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    let response;

    // Static-first for GET/HEAD: any real file under dist/client (hashed
    // /assets/*, /favicon.svg, the self-hosted /ort/* ONNX runtime, ...) is served
    // directly; everything else (SSR routes) falls through to the app handler.
    // `new URL` already normalizes away `..`, so serveStatic can't escape the root.
    response = method === "GET" || method === "HEAD" ? await serveStatic(url.pathname) : null;
    if (!response) {
      const body = await readBody(req);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: body && !["GET", "HEAD"].includes(method) ? body : undefined,
      });
      response = await handler.fetch(request, {}, {});
    }

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } else {
      res.end();
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`QUON frontend listening on http://${host}:${port}`);
});
