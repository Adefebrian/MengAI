// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// web_fetch support: SSRF guard (public hosts only, every redirect hop is
// re-checked), a 2 MB streaming body cap, a hard timeout, and HTML reduced
// to readable text with Bun's HTMLRewriter (linear, no regex backtracking).
import { isIP } from "node:net";

export type Lookup = (hostname: string) => Promise<string[]>;

export const defaultLookup: Lookup = async (hostname) => {
  const res = await Bun.dns.lookup(hostname, { family: 0 });
  return res.map((r) => r.address);
};

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}

function v4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPublicV4(ip: string): boolean {
  const p = v4Parts(ip);
  if (!p) return false;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** expands an IPv6 literal to 8 hextets (embedded IPv4 tail supported) */
function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return null;
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = v4Parts(last);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)));
  const head = parse(halves[0]!);
  let words = head;
  if (halves.length === 2) {
    const rest = parse(halves[1]!);
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    words = [...head, ...new Array<number>(fill).fill(0), ...rest];
  }
  if (words.length !== 8 || words.some((w) => Number.isNaN(w))) return null;
  return words;
}

function isPublicV6(ip: string): boolean {
  const w = v6Hextets(ip);
  if (!w) return false;
  const embedded = () => `${w[6]! >> 8}.${w[6]! & 255}.${w[7]! >> 8}.${w[7]! & 255}`;
  if (w.slice(0, 7).every((x) => x === 0)) return false; // :: and ::1
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isPublicV4(embedded()); // IPv4-mapped
  if (w[0] === 0x64 && w[1] === 0xff9b) return isPublicV4(embedded()); // NAT64
  if (w[0] === 0x2002) return isPublicV4(`${w[1]! >> 8}.${w[1]! & 255}.${w[2]! >> 8}.${w[2]! & 255}`); // 6to4
  if ((w[0]! & 0xffc0) === 0xfe80) return false; // link-local
  if ((w[0]! & 0xfe00) === 0xfc00) return false; // unique local
  if ((w[0]! & 0xff00) === 0xff00) return false; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x2001 && w[1] === 0) return false; // teredo
  if (w[0] === 0x100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return false; // discard
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind === 6) return isPublicV6(ip);
  return false;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Throws unless the URL is http(s) on a public host whose every address is public. */
export async function assertPublicUrl(raw: string | URL, lookup: Lookup = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new WebFetchError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebFetchError("only http and https URLs are allowed");
  if (url.username || url.password) throw new WebFetchError("URLs with credentials are not allowed");
  if (!ALLOWED_PORTS.has(url.port)) throw new WebFetchError(`port ${url.port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new WebFetchError("URL has no host");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new WebFetchError("private, loopback and link-local addresses are blocked");
    return url;
  }
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new WebFetchError("local host names are blocked");
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new WebFetchError(`could not resolve ${host}`);
  }
  if (addresses.length === 0) throw new WebFetchError(`could not resolve ${host}`);
  if (!addresses.every(isPublicAddress)) throw new WebFetchError(`${host} resolves to a private address; blocked`);
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "-", ndash: "-", hellip: "...", copy: "(c)", reg: "(R)", laquo: '"', raquo: '"', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      if (code === 0x2014 || code === 0x2013) return "-";
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

const SKIP = "script, style, noscript, template, svg, iframe, canvas, object, head, button, select";
const BLOCKS = "p, div, section, article, header, footer, main, aside, nav, ul, ol, table, tr, blockquote, pre, figure, form, hr, dl, dt, dd";
const MAX_LINKS = 150;

/** HTML to readable text: title, headings as #, list items as -, links as text (url). */
export function htmlToText(html: string, base?: string): string {
  const parts: string[] = [];
  let skip = 0;
  let title = "";
  let links = 0;
  const rw = new HTMLRewriter()
    .on(SKIP, {
      element(el) {
        if (!el.canHaveContent || el.selfClosing) return;
        skip++;
        el.onEndTag(() => {
          skip--;
        });
      },
    })
    .on("title", {
      text(t) {
        if (title.length < 300) title += t.text;
      },
    })
    .on(BLOCKS, {
      element(el) {
        parts.push("\n");
        if (el.canHaveContent && !el.selfClosing) el.onEndTag(() => void parts.push("\n"));
      },
    })
    .on("br", { element: () => void parts.push("\n") })
    .on("li", { element: () => void parts.push("\n- ") })
    .on("h1, h2, h3, h4, h5, h6", {
      element(el) {
        parts.push(`\n\n${"#".repeat(Number(el.tagName.slice(1)) || 1)} `);
        if (el.canHaveContent && !el.selfClosing) el.onEndTag(() => void parts.push("\n"));
      },
    })
    .on("td, th", { element: () => void parts.push(" ") })
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href") ?? "";
        if (links >= MAX_LINKS || skip > 0 || !el.canHaveContent || el.selfClosing) return;
        let abs: string | null = null;
        try {
          const u = new URL(decodeEntities(href), base);
          if (u.protocol === "http:" || u.protocol === "https:") abs = u.href;
        } catch {
          abs = null;
        }
        if (!abs) return;
        links++;
        el.onEndTag(() => void parts.push(` (${abs})`));
      },
    })
    .onDocument({
      text(t) {
        if (skip === 0) parts.push(t.text);
      },
    });
  rw.transform(html);
  const body = decodeEntities(parts.join(""))
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const t = decodeEntities(title).replace(/\s+/g, " ").trim();
  return t ? `${t}\n\n${body}` : body;
}

export interface FetchReadableOptions {
  maxBytes: number;
  timeoutMs: number;
  maxChars: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
  maxRedirects?: number;
}

export interface Fetched {
  url: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
}

async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (size + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { bytes: out, truncated };
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-javascript|ld\+json|rss\+xml|atom\+xml|xhtml\+xml)|[\w.+-]+\/[\w.-]+\+(json|xml))/i;

export async function fetchReadable(raw: string, opts: FetchReadableOptions): Promise<Fetched> {
  const doFetch = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url = await assertPublicUrl(raw, lookup);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await doFetch(url.href, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { "user-agent": "MengAI-research/0.1", accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.5" },
      });
    } catch (e) {
      if (timeout.aborted) throw new WebFetchError(`timed out after ${Math.round(opts.timeoutMs / 1000)} s`);
      if (opts.signal?.aborted) throw new WebFetchError("aborted");
      throw new WebFetchError(`request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => undefined);
      if (hop >= (opts.maxRedirects ?? 5)) throw new WebFetchError("too many redirects");
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url), lookup);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !TEXTUAL.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new WebFetchError(`unsupported content type ${contentType.split(";")[0]}`);
    }
    const { bytes, truncated } = await readCapped(res, opts.maxBytes);
    let text = decodeBody(bytes, contentType);
    if (/html/i.test(contentType) || (!contentType && /^\s*<(!doctype html|html)/i.test(text))) text = htmlToText(text, url.href);
    let cut = truncated;
    if (text.length > opts.maxChars) {
      text = text.slice(0, opts.maxChars);
      cut = true;
    }
    return { url: url.href, status: res.status, contentType: contentType.split(";")[0] ?? "", text, truncated: cut };
  }
}
