// What the sample crew built: the warung-kas daily sales report with its
// new CSV export, as a tiny static site. build.ts writes these files to
// dist/demo-site/, so Open in new tab has a real page to open, and the
// sample run's live preview shows the same page in its frame. In the frame
// it is a srcdoc (a page on the engine or the website refuses to be framed,
// by design), styled only through the linked stylesheet, so it renders
// under the strict CSP of either server. No script, no network.
export const DEMO_SITE_PATH = "/demo-site/";
/** the page itself: a folder path would get the SPA's index.html from the engine */
export const DEMO_SITE_PAGE = `${DEMO_SITE_PATH}index.html`;

const ROWS: Array<[time: string, item: string, qty: number, total: number]> = [
  ["07:12", "Kopi susu", 3, 45_000],
  ["08:40", "Nasi uduk, extra tempe", 2, 38_000],
  ["10:05", "Teh tarik", 4, 40_000],
  ["12:31", "Mie goreng \"spesial\"", 2, 50_000],
  ["15:18", "Pisang goreng, 6 pcs", 1, 18_000],
];

const idr = (n: number) => `Rp ${n.toLocaleString("en-US").replace(/,/g, ".")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const DEMO_SITE_CSV = ["time,item,qty,total_idr", ...ROWS.map(([t, item, q, total]) => `${t},"${item.replace(/"/g, '""')}",${q},${total}`)].join("\r\n") + "\r\n";

export const DEMO_SITE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Warung Kas, daily sales</title>
    <link rel="stylesheet" href="${DEMO_SITE_PATH}site.css" />
  </head>
  <body>
    <header class="top">
      <span class="brand">Warung Kas</span>
      <span class="tab">Daily sales</span>
    </header>
    <main class="page">
      <div class="head">
        <div>
          <h1>Daily sales</h1>
          <p class="sub">Tuesday 29 September 2026, 5 sales</p>
        </div>
        <a class="export" href="${DEMO_SITE_PATH}sales-2026-09-29.csv" download>Export CSV</a>
      </div>
      <div class="scroll">
        <table>
          <thead><tr><th scope="col">Time</th><th scope="col">Item</th><th scope="col" class="n">Qty</th><th scope="col" class="n">Total</th></tr></thead>
          <tbody>
${ROWS.map(([t, item, q, total]) => `            <tr><td class="n">${t}</td><td>${esc(item)}</td><td class="n">${q}</td><td class="n">${idr(total)}</td></tr>`).join("\n")}
          </tbody>
          <tfoot><tr><th scope="row" colspan="3">Day total</th><td class="n">${idr(ROWS.reduce((s, r) => s + r[3], 0))}</td></tr></tfoot>
        </table>
      </div>
      <p class="note">Fields with a comma or a quote are quoted in the CSV, so the file opens cleanly in any spreadsheet.</p>
    </main>
  </body>
</html>
`;

export const DEMO_SITE_CSS = `*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1b1b; background: #fafaf9; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; background: #ffffff; border-bottom: 1px solid #e4e2dd; }
.brand { font-weight: 600; }
.tab { font-size: 15px; font-weight: 500; color: #5f5b54; }
.page { max-width: 880px; margin: 0 auto; padding: 24px 20px 48px; display: grid; gap: 16px; }
.head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
h1 { margin: 0; font-size: 28px; line-height: 36px; font-weight: 600; letter-spacing: -0.02em; }
.sub, .note { margin: 0; font-size: 13px; line-height: 20px; color: #5f5b54; }
.export { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 8px; background: #1b1b1b; color: #ffffff; text-decoration: none; font-weight: 500; }
.export:hover { background: #33312d; }
.export:focus-visible { outline: 2px solid #1b1b1b; outline-offset: 2px; }
.scroll { overflow-x: auto; background: #ffffff; border: 1px solid #e4e2dd; border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid #efede8; white-space: nowrap; }
thead th { font-size: 13px; font-weight: 500; color: #5f5b54; }
tfoot th, tfoot td { border-bottom: 0; font-weight: 600; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
td.n:first-child { text-align: left; }
`;
