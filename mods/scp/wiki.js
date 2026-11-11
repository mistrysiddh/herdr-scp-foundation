// SCP wiki access: the article index and one article's fields, fetched live and cached.
// Text is CC BY-SA 3.0 (each article has its own authors); nothing from it is shipped here.

const BASE = "https://scp-wiki.wikidot.com";
export const wikiUrl = (n) => `${BASE}/scp-${n}`;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

const cache = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be unavailable */ } },
};

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "herdr-scp-foundation-layout (personal use)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// [{ n: "002", title: "The \"Living\" Room" }, ...] for SCP-001 to 999 (Series 1).
export async function loadIndex() {
  const hit = cache.get("scp.wiki.index.v1");
  if (hit?.length) return hit;
  const html = await get(`${BASE}/scp-series`);
  const out = [];
  const re = /<li><a href="\/scp-(\d{3})">SCP-\d{3}<\/a> - ([^<]*)/g;
  for (let m; (m = re.exec(html)); ) out.push({ n: m[1], title: decode(m[2]).trim() });
  if (!out.length) throw new Error("index not found");
  cache.set("scp.wiki.index.v1", out);
  return out;
}

export const cachedArticle = (n) => cache.get(`scp.wiki.a.${n}`);

const text = (html) => decode(html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|tr|blockquote)>/gi, "\n\n").replace(/<li[^>]*>/gi, "\n• ")
  .replace(/<[^>]+>/g, ""))
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// Item #, Object Class, Special Containment Procedures, Description (+ rating) from an article page.
export function parseArticle(html) {
  const rating = /class="number prw\d+">([+-]?\d+)</.exec(html)?.[1] ?? null;
  const start = html.indexOf('id="page-content"');
  if (start < 0) throw new Error("article body not found");
  let body = html.slice(start);
  const end = body.search(/<div class="(licensebox|page-tags|footer-wikiwalk)/);
  body = body.slice(0, end > 0 ? end : 60000);
  // up to two pictures hosted on the wiki's own file host, with their captions
  const images = [];
  const ire = /<img[^>]+src="(https:\/\/scp-wiki\.wdfiles\.com\/local--files\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|gif|webp))"[^>]*>([\s\S]{0,400})/gi;
  for (let m; images.length < 2 && (m = ire.exec(body)); ) {
    const cap = /scp-image-caption[^>]*>\s*<p>([\s\S]*?)<\/p>/i.exec(m[2]);
    if (!images.some((i) => i.url === m[1])) images.push({ url: m[1], caption: cap ? text(cap[1]) : "" });
  }
  const t = text(body.replace(/<div class="page-rate-widget-box">[\s\S]*?<\/div><\/div>/, ""));
  const at = t.search(/Item #:/i);
  const s = at >= 0 ? t.slice(at) : t;
  const pick = (label, next) => {
    const m = new RegExp(`${label}:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${next}):|$)`, "i").exec(s);
    return m ? m[1].trim() : null;
  };
  const item = pick("Item #", "Object Class|Containment Class|Special Containment Procedures|Description");
  const cls = pick("(?:Object|Containment) Class", "Special Containment Procedures|Description");
  const procedures = pick("Special Containment Procedures", "Description");
  const descAt = s.search(/\n\s*Description:/i);
  // the first paragraphs only: what follows is usually addenda, logs and reports
  const description = descAt >= 0
    ? s.slice(descAt).replace(/^\s*Description:?\s*/i, "").split(/\n{2,}/).filter((p) => !/cross-ref|docid|^view /i.test(p)).slice(0, 3).join("\n\n").trim()
    : null;
  return {
    item: item?.split("\n")[0] ?? null,
    cls: cls?.split("\n")[0]?.replace(/\s+/g, " ") ?? null,
    procedures: procedures && procedures.length > 1800 ? `${procedures.slice(0, 1800).trimEnd()} …` : procedures,
    description: description && description.length > 1800 ? `${description.slice(0, 1800).trimEnd()} …` : description,
    rating,
    images,
    at: Date.now(),
  };
}

// Pictures are saved under the app folder (cache/wiki/) because image() reads local files; a failed
// download just leaves that picture out. `sys` is { exec, appHome } from herdr.
async function saveImages(n, art, sys) {
  const dir = "cache/wiki";
  try { await sys.exec("mkdir", ["-p", `${sys.appHome()}/${dir}`]); } catch { return; }
  const saved = [];
  for (const [i, img] of (art.images ?? []).entries()) {
    const ext = /\.(jpe?g|png|gif|webp)$/i.exec(img.url)[1].toLowerCase();
    const rel = `${dir}/scp-${n}-${i}.${ext}`;
    try {
      const r = await sys.exec("curl", ["-sSL", "--proto", "=https", "--max-filesize", "5000000", "-m", "25", "-A", "herdr-scp-foundation-layout (personal use)", "-o", `${sys.appHome()}/${rel}`, img.url]);
      if (r.code === 0) saved.push({ path: rel, caption: img.caption });
    } catch { /* leave the picture out */ }
  }
  art.pics = saved;
}

export async function loadArticle(n, sys) {
  const hit = cachedArticle(n);
  if (hit) return hit;
  const art = parseArticle(await get(wikiUrl(n)));
  if (sys) await saveImages(n, art, sys);
  delete art.images;
  cache.set(`scp.wiki.a.${n}`, art);
  return art;
}
