// Static preview server: a tiny Bun.serve on 127.0.0.1 for projects with a
// plain index.html. GET and HEAD only; the Host must be 127.0.0.1 or
// localhost on its own port (a DNS rebinding page cannot read the files);
// dot segments, dotfiles, encoded separators and symlinks out of the folder
// answer 404. Extensionless misses fall back to index.html for built SPAs.
import { realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { StaticServer } from "./ports";

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

async function fileAt(path: string): Promise<string | null> {
  const s = await stat(path).catch(() => null);
  if (!s) return null;
  if (s.isDirectory()) return fileAt(join(path, "index.html"));
  return s.isFile() ? path : null;
}

const plain = (status: number, text: string, extra: Record<string, string> = {}) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", ...extra } });

/** The request handler, separate from the listener so tests can drive it without a port. */
export function createStaticHandler(dir: string, port: number): (req: Request) => Promise<Response> {
  const rootP = realpath(dir);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async (req) => {
    if (!hosts.has((req.headers.get("host") ?? "").toLowerCase())) return plain(403, "Forbidden");
    if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "Method not allowed", { allow: "GET, HEAD" });
    const root = await rootP;
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return plain(404, "Not found");
    }
    if (path.includes("\0") || path.includes("\\")) return plain(404, "Not found");
    const segments = path.split("/").filter(Boolean);
    if (segments.some((s) => s === "." || s === ".." || s.startsWith("."))) return plain(404, "Not found");
    const target = resolve(root, ...segments);
    if (!inside(target, root)) return plain(404, "Not found");
    let found = await fileAt(target);
    if (!found && !extname(target)) found = await fileAt(join(root, "index.html"));
    const real = found ? await realpath(found).catch(() => null) : null;
    if (!real || !inside(real, root)) return plain(404, "Not found");
    const file = Bun.file(real);
    return new Response(req.method === "HEAD" ? null : file, {
      headers: { "content-type": file.type || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" },
    });
  };
}

export function serveStatic(dir: string, port: number): StaticServer {
  const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 30, fetch: createStaticHandler(dir, port) });
  return {
    port: server.port ?? port,
    stop: () => server.stop(true),
  };
}
