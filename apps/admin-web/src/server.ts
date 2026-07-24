import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listBookIds, loadBookFromManifest, saveBookManifest } from "@yimi-pen/content";
import type { Book } from "@yimi-pen/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const BOOKS_ROOT = path.join(ROOT, "content/books");
const PORT = Number(process.env.ADMIN_PORT ?? 5173);
const PUBLIC = path.join(__dirname, "public");

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

async function serveStatic(res: http.ServerResponse, filePath: string) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json",
    };
    res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (pathname === "/api/books" && req.method === "GET") {
      const ids = await listBookIds(BOOKS_ROOT);
      const books = [];
      for (const id of ids) {
        const book = await loadBookFromManifest(path.join(BOOKS_ROOT, id));
        books.push({
          id: book.id,
          title: book.title,
          version: book.version,
          language: book.language,
          pageCount: book.pages.length,
        });
      }
      return json(res, 200, { books });
    }

    const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
    if (bookMatch && req.method === "GET") {
      const id = decodeURIComponent(bookMatch[1]!);
      const book = await loadBookFromManifest(path.join(BOOKS_ROOT, id));
      return json(res, 200, book);
    }

    if (bookMatch && req.method === "PUT") {
      const id = decodeURIComponent(bookMatch[1]!);
      const body = await readBody(req);
      const book = JSON.parse(body) as Book;
      if (book.id !== id) {
        return json(res, 400, { error: "id mismatch" });
      }
      await saveBookManifest(path.join(BOOKS_ROOT, id), book);
      return json(res, 200, { ok: true });
    }

    if (pathname === "/" || pathname === "/index.html") {
      return serveStatic(res, path.join(PUBLIC, "index.html"));
    }

    if (pathname.startsWith("/static/")) {
      return serveStatic(res, path.join(PUBLIC, pathname.slice("/static/".length)));
    }

    res.writeHead(404).end("Not found");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[admin] Yimi Pen admin at http://127.0.0.1:${PORT}`);
  console.log(`[admin] content root: ${BOOKS_ROOT}`);
});
