// SCP Foundation: the whole scp-foundation layout's custom parts, in roles.
//   header     paper document header: emblem, ITEM #, OBJECT CLASS (of the shown
//              site), redacted fields, breach alert, clickable clearance level
//   footer     classification strip: incident log or rotating notices, subject counts
//   pane       a pane's document header: DOC number, subject, redacted path, stamp
//   personnel  the agent list as personnel files
//   stamp      floating [DATA EXPUNGED] stamps over idle, unfocused panes
//   terminate  the Termination Order dialog (closing a pane)
//   login      the boot-style login screen (once per 30 minutes; scp.login replays it)
//   archive    the Incident Archive window;  article  the Special Containment Procedures
//
// Clearance (shared "scp.clearance", 1-5, default 4) decides what hovering a redaction
// bar can declassify; at level 5 everything is visible. Sidebar spaces, the tab bar
// and the Files/Changes panels are Herdr's own mods.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  props, spaces, agents, panes, run, home, shared, setShared, settings, playSound,
  setAgentOrder, openOverlay, closeOverlay, nextCommand, window as appWindow,
  exec, appHome, writeTextFile, readTextFile, notify, hc, knownAgents,
} from "herdr";
import { unitOf } from "./mtf.js";
import { loadIndex, loadArticle, cachedArticle, wikiUrl } from "./wiki.js";

const P = {
  paper: "#d6d6cf", paper2: "#c4c4bc", ink: "#0c0d0d", ink2: "#3a3d3c", rule: "#9a9d96",
  red: "#c8102e", black: "#050606", dark: "#111313", dark2: "#181a1a", edge: "#2a2d2d",
  text: "#d6d6cf", dim: "#7b7f7c", amber: "#d9a21b", green: "#6f9a52", bar: "#26292a",
  onRed: "#ffffff", darkPaper: false, // set per department by applyDept()
};
const MONO = "JetBrains Mono";
const CLEAR_KEY = "scp.clearance";
const LOG_KEY = "scp.log"; // [{ n, text, color, at }], the last KEEP incidents
const LOGIN_KEY = "scp.loginAt"; // ms of the last login screen; one per 30 minutes
const KEEP = 80;
// Incident colours are stored by meaning ("red", "amber", "green", "dim") so they follow the
// department; entries logged before that stored the Foundation hex values, mapped here.
const LEGACY_COLOR = { "#c8102e": "red", "#d9a21b": "amber", "#6f9a52": "green", "#7b7f7c": "dim" };
const semantic = (c) => ["red", "amber", "green", "dim"].find((k) => P[k] === c) ?? LEGACY_COLOR[c] ?? c;
const col = (c) => P[LEGACY_COLOR[c] ?? c] ?? c;
const logOf = () => (Array.isArray(shared(LOG_KEY)) ? shared(LOG_KEY) : []);
const stop = (_e, cx) => cx.stop_propagation();
const two = (n) => String(n).padStart(2, "0");
const t12 = (d, sec) => `${d.getHours() % 12 || 12}:${two(d.getMinutes())}${sec ? ":" + two(d.getSeconds()) : ""} ${d.getHours() < 12 ? "AM" : "PM"}`;

// ---- clearance ---------------------------------------------------------------

const level = () => Math.min(5, Math.max(1, Math.round(Number(shared(CLEAR_KEY)) || 4)));
const cycleLevel = () => setShared(CLEAR_KEY, (level() % 5) + 1);

// ---- drill, departments, first-seen times ------------------------------------

const DRILL_KEY = "scp.drill";   // ms when a breach drill began (0 = none)
const DRILL_MS = 20000;
const SEEN_KEY = "scp.seen";     // { address: ms first seen }, for time in containment
const DEPT_KEY = "scp.dept";     // index into DEPTS
// Each department recolours the whole UI: the accent, the "paper" of headers and windows,
// and the colour of text drawn on the accent. O5 turns the paper dark with gold ink.
const DEPTS = [
  { label: "FOUNDATION", theme: "scp-foundation", pal: { red: "#c8102e", onRed: "#ffffff", paper: "#d6d6cf", paper2: "#c4c4bc", ink: "#0c0d0d", ink2: "#3a3d3c", rule: "#9a9d96", black: "#050606", darkPaper: false } },
  { label: "MTF TACTICAL", theme: "scp-mtf", pal: { red: "#5f8f3f", onRed: "#ffffff", paper: "#cfd6c6", paper2: "#bcc5b0", ink: "#0b0e0a", ink2: "#354031", rule: "#94a089", black: "#050605", darkPaper: false } },
  { label: "ETHICS COMMITTEE", theme: "scp-ethics", pal: { red: "#4f7f9c", onRed: "#ffffff", paper: "#ccd3d9", paper2: "#b9c2ca", ink: "#0c0e10", ink2: "#36404a", rule: "#8f9aa4", black: "#050607", darkPaper: false } },
  { label: "O5 COUNCIL", theme: "scp-o5", pal: { red: "#d9a21b", onRed: "#120f05", paper: "#14120a", paper2: "#1f1c10", ink: "#e8d9a0", ink2: "#a89a62", rule: "#4a4122", black: "#a89a62", darkPaper: true } },
  { label: "OVERWATCH", theme: "scp-overwatch", pal: { red: "#6d7f92", onRed: "#ffffff", paper: "#cfd1cd", paper2: "#bbbdba", ink: "#0f1011", ink2: "#44484c", rule: "#939694", black: "#090a0b", darkPaper: false } },
  { label: "INTERNAL SECURITY", theme: "scp-internal", pal: { red: "#7d3c98", onRed: "#ffffff", paper: "#d1c9ce", paper2: "#bdb5ba", ink: "#100c11", ink2: "#473a4d", rule: "#968c95", black: "#0a070b", darkPaper: false } },
  { label: "TACTICAL RESPONSE", theme: "scp-tactical", pal: { red: "#d2691e", onRed: "#ffffff", paper: "#dbcebf", paper2: "#c7bbac", ink: "#140f0b", ink2: "#584334", rule: "#a29382", black: "#0d0906", darkPaper: false } },
  { label: "RECOVERY", theme: "scp-recovery", pal: { red: "#17847f", onRed: "#ffffff", paper: "#c4d1cb", paper2: "#b1beb7", ink: "#0b1010", ink2: "#334948", rule: "#869791", black: "#060a0a", darkPaper: false } },
  { label: "SECURITY", theme: "scp-security", pal: { red: "#2b4a8b", onRed: "#ffffff", paper: "#c7cacc", paper2: "#b3b7b9", ink: "#0c0d10", ink2: "#373d4a", rule: "#898e93", black: "#07080a", darkPaper: false } },
  { label: "ABNORMAL TECH", theme: "scp-tech", pal: { red: "#20b2d6", onRed: "#0c0c0c", paper: "#0b1416", paper2: "#0c1b1e", ink: "#bfe4ec", ink2: "#69a4b2", rule: "#10343d", black: "#69a4b2", darkPaper: true } },
  { label: "TEMPORAL", theme: "scp-temporal", pal: { red: "#8b6cf0", onRed: "#0c0c0c", paper: "#121018", paper2: "#171421", ink: "#dad2f3", ink2: "#9488bc", rule: "#2a2244", black: "#9488bc", darkPaper: true } },
  { label: "DISINFORMATION", theme: "scp-disinfo", pal: { red: "#c2185b", onRed: "#ffffff", paper: "#d9c4c6", paper2: "#c6b1b3", ink: "#130b0e", ink2: "#553341", rule: "#a0868b", black: "#0d0608", darkPaper: false } },
  { label: "MEDICAL", theme: "scp-medical", pal: { red: "#8b5a2b", onRed: "#ffffff", paper: "#d2ccc1", paper2: "#bfb9ad", ink: "#100e0c", ink2: "#4a4037", rule: "#989084", black: "#0a0807", darkPaper: false } },
  { label: "RESEARCH", theme: "scp-research", pal: { red: "#a08a2a", onRed: "#ffffff", paper: "#d5d2c0", paper2: "#c1bfad", ink: "#12100c", ink2: "#4e4a37", rule: "#9b9884", black: "#0b0a06", darkPaper: false } },
];
// Called at the start of every render and init so each role paints with the current department.
const OPTS_KEY = "scp.opts";
const OPT_DEFAULTS = { sounds: true, login: true, stamps: true, notices: true, lockdown: true, compact: false, paper: false };
const opts = () => ({ ...OPT_DEFAULTS, ...(shared(OPTS_KEY) && typeof shared(OPTS_KEY) === "object" ? shared(OPTS_KEY) : {}) });
// dark surfaces (sidebar blocks, footer) and the paper-mode versions of them
const BASE_SURFACE = { dark: "#111313", dark2: "#181a1a", edge: "#2a2d2d", text: "#d6d6cf", dim: "#7b7f7c", bar: "#26292a", amber: "#d9a21b", green: "#6f9a52" };
const PAPER_SURFACE = { dark: "#d6d6cf", dark2: "#c4c4bc", edge: "#9a9d96", text: "#0c0d0d", dim: "#5b5e5c", bar: "#b4b4ac", amber: "#8a5d00", green: "#3f6b27" };
// lockdown: every surface turns dark red while a subject is in breach
const LOCK_PAL = { red: "#ff4040", onRed: "#ffffff", paper: "#2a0b0e", paper2: "#3a1216", ink: "#ffd9d9", ink2: "#d98c8c", rule: "#6a2025", black: "#d98c8c", darkPaper: true, dark: "#160708", dark2: "#230b0e", edge: "#5a1d22", bar: "#4a1a1e" };
const lightPalette = (A) => ({ red: A, onRed: "#ffffff", paper: mix(A, "#dcdcd5", 0.12), paper2: mix(A, "#c6c6bf", 0.12), ink: mix(A, "#0a0a0a", 0.05), ink2: mix(A, "#3a3a3a", 0.2), rule: mix(A, "#9a9a94", 0.15), black: mix(A, "#050505", 0.04), darkPaper: false });
const isLockdown = () => opts().lockdown && (drilling() || agents().some((a) => a.status === "blocked"));
function applyDept() {
  const d = DEPTS[deptIdx()];
  Object.assign(P, opts().paper ? { ...PAPER_SURFACE, ...lightPalette(d.pal.red) } : { ...BASE_SURFACE, ...d.pal });
  if (isLockdown()) Object.assign(P, LOCK_PAL);
}
// Department wording: organisation name, motto and two extra footer notices each (same order as DEPTS).
const FLAVOR = [
  { org: "SCP FOUNDATION", motto: "SECURE · CONTAIN · PROTECT", notices: [] },
  { org: "MOBILE TASK FORCE", motto: "RESPOND · RECOVER · RETURN", notices: [["MTF UNITS ARE TO ANSWER TO THEIR", { r: "CALLSIGN" }, "ONLY."], ["NINE-TAILED FOX IS ALREADY", { r: "EN ROUTE" }]] },
  { org: "ETHICS COMMITTEE", motto: "WEIGH · ADVISE · DISSENT", notices: [["THE COMMITTEE HAS NOTED YOUR LAST ACTION AND", { r: "DISAPPROVES" }], ["ALL PROCEDURES ARE SUBJECT TO", { r: "ETHICAL REVIEW" }]] },
  { org: "O5 COUNCIL", motto: "WE DECIDE. YOU COMPLY.", notices: [["THE COUNCIL DOES NOT", { r: "EXPLAIN ITSELF" }], ["O5-" + "██", "HAS REVIEWED THIS TERMINAL."]] },
  { org: "OVERWATCH COMMAND", motto: "WATCHING THE WATCHERS", notices: [["OVERWATCH SEES ALL ACTIVITY ON THIS", { r: "CHANNEL" }], ["COMMAND STAFF HAVE BEEN", { r: "NOTIFIED" }]] },
  { org: "INTERNAL SECURITY", motto: "TRUST NO ONE · VERIFY EVERYONE", notices: [["THIS TERMINAL IS BEING", { r: "MONITORED" }], ["REPORT SUSPICIOUS COLLEAGUES TO", { r: "INTERNAL SECURITY" }]] },
  { org: "TACTICAL RESPONSE", motto: "FAST · QUIET · DECISIVE", notices: [["RESPONSE TEAMS ARE ON", { r: "STANDBY" }], ["RULES OF ENGAGEMENT ARE", { r: "CLASSIFIED" }]] },
  { org: "RECOVERY & CONTAINMENT", motto: "FIND · TAKE · HOLD", notices: [["ALL RECOVERED ITEMS MUST BE", { r: "TAGGED" }, "AND LOGGED."], ["DO NOT TOUCH THE ITEM. DO NOT", { r: "LOOK AT THE ITEM" }]] },
  { org: "SITE SECURITY", motto: "GUARD · LOCK · LOG", notices: [["KEYCARDS ARE TO BE WORN", { r: "AT ALL TIMES" }], ["DOORS ARE LOCKED. THIS IS", { r: "BY DESIGN" }]] },
  { org: "ABNORMAL TECHNOLOGIES", motto: "UNDERSTAND · BUILD · LABEL", notices: [["THE DEVICE IS NOT A TOY. IT IS ALSO NOT", { r: "A DEVICE" }], ["FIRMWARE UPDATES ARE", { r: "NOT RECOMMENDED" }]] },
  { org: "TEMPORAL ANOMALIES", motto: "WHEN YOU READ THIS IS NOT NOW", notices: [["THIS NOTICE WAS WRITTEN", { r: "TOMORROW" }], ["IF YOU ARE EARLY, PLEASE", { r: "WAIT" }]] },
  { org: "DISINFORMATION DEPT", motto: "WHAT PEOPLE KNOW IS OUR CHOICE", notices: [["NOTHING HAPPENED. THERE WAS NO", { r: "INCIDENT" }], ["THE OFFICIAL STORY IS A", { r: "GAS LEAK" }]] },
  { org: "MEDICAL & PSYCHOLOGY", motto: "TREAT · OBSERVE · SIGN OFF", notices: [["YOUR ANNUAL EVALUATION IS", { r: "OVERDUE" }], ["PLEASE REPORT ANY NEW", { r: "MEMORIES" }]] },
  { org: "RESEARCH DIVISION", motto: "QUESTION · TEST · LOG", notices: [["PLEASE LOG YOUR TEST RESULTS BEFORE THE", { r: "SUBJECT" }, "DOES."], ["PEER REVIEW IS CONDUCTED BY", { r: "THE SUBJECT" }]] },
];
const org = () => FLAVOR[deptIdx()].org;
const noticeList = () => [...NOTICES, ...FLAVOR[deptIdx()].notices];
// Blend two #rrggbb colours (t = share of `a`), for accent-tinted dark backgrounds.
function mix(a, b, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}
const deptIdx = () => Math.min(DEPTS.length - 1, Math.max(0, Math.round(Number(shared(DEPT_KEY)) || 0)));
const themeFor = (n) => DEPTS[n].theme; // the dark half; paper mode owns the light half (see setAppearance)
// Herdr keeps a light and a dark theme per layout and shows the one that matches the appearance, so the paper
// terminal works by switching the appearance in settings.json to "light" (and back, restoring what it was).
async function setAppearance(light) {
  const path = `${appHome()}/settings.json`;
  const raw = await readTextFile(path); // null when absent; writeTextFile needs it to detect a stale snapshot
  let cur = {};
  try { cur = raw ? JSON.parse(raw) : {}; } catch { cur = {}; }
  if (light) {
    if (cur.appearance !== "light") { setShared("scp.prevAppearance", cur.appearance ?? ""); cur.appearance = "light"; }
  } else if (cur.appearance === "light") {
    const prev = shared("scp.prevAppearance");
    if (prev) cur.appearance = prev; else delete cur.appearance;
  }
  await writeTextFile(path, JSON.stringify(cur, null, 2) + "\n", raw);
}
const setDept = (n) => {
  setShared(DEPT_KEY, n);
  setShared("scp.accent", DEPTS[n].pal.red); // read by scp-spaces for its selection marker
  run("app.theme", { name: themeFor(n) });
};
const cycleDept = () => setDept((deptIdx() + 1) % DEPTS.length);
const applyCompact = () => {
  const c = opts().compact;
  run("layout.resize", { id: "header", px: c ? 44 : 62 });
  run(c ? "layout.hide" : "layout.show", { id: "incidents" });
};
const setOpt = (k, v) => {
  setShared(OPTS_KEY, { ...opts(), [k]: v });
  if (k === "paper") {
    if (v) run("app.theme", { name: "scp-paper" }); // the light half
    setAppearance(Boolean(v)).catch((e) => console.log(`scp: appearance: ${e}`));
  }
  if (k === "compact") applyCompact();
};
const drilling = () => { const t = Number(shared(DRILL_KEY)) || 0; return t > 0 && Date.now() - t < DRILL_MS; };
const seenOf = () => (shared(SEEN_KEY) && typeof shared(SEEN_KEY) === "object" ? shared(SEEN_KEY) : {});

// ---- sound -------------------------------------------------------------------

function sfx(name) {
  if (settings()?.sounds?.enabled === false || !opts().sounds) return;
  // breach and contained have one variant per department; klaxon plays when lockdown begins
  const file = name === "breach" || name === "contained" ? `${name}-${deptIdx()}` : name;
  try { playSound(`mods/scp/sounds/${file}.mp3`); } catch (e) { console.log(`scp: sound ${name}: ${e}`); }
}

// ---- object class ------------------------------------------------------------

// Per site: APOLLYON (3+ breaches) > KETER (a breach) > EUCLID (working) >
// THAUMIEL (finished while unseen) > SAFE. Colours are for the paper header.
function classify(list) {
  const n = (st) => list.filter((a) => a.status === st).length;
  const c = (dark, light) => (P.darkPaper ? dark : light);
  if (n("blocked") >= 3) return { name: "APOLLYON", color: c("#ef3b4f", "#7a0a14") };
  if (n("blocked")) return { name: "KETER", color: c("#ef6a4a", P.red) };
  if (n("working")) return { name: "EUCLID", color: c(P.amber, "#8a5d00") };
  if (n("done")) return { name: "THAUMIEL", color: c("#9d86e0", "#4a3f8f") };
  return { name: "SAFE", color: c(P.green, "#3f6b27") };
}

const stampOf = (st) => ({
  working: { text: "UNDER OBSERVATION", color: P.amber },
  blocked: { text: "BREACH", color: P.red },
  done: { text: "RECONTAINED", color: P.green },
}[st] ?? { text: "CONTAINED", color: P.dim });

// ---- redaction ---------------------------------------------------------------

/**
 * A redaction bar. Black on black until hovered; hovering declassifies it only
 * when the clearance level reaches `need`, and level 5 shows everything.
 */
function redact(id, text, { bg = P.black, reveal = P.paper, size = 13, need = 1 } = {}) {
  const L = level();
  const open = L >= 5;
  const allowed = L >= need;
  return div().id(id).px(5).rounded(1).bg(bg).text_color(open ? reveal : bg)
    .font_family(MONO).font_weight(700).text_size(size).max_w(220).truncate()
    .tooltip(open ? "DECLASSIFIED" : allowed ? "CLASSIFIED: hover to declassify" : `INSUFFICIENT CLEARANCE: LEVEL ${need} REQUIRED`)
    .when(allowed && !open, (el) => el.hover((s) => s.text_color(reveal)))
    .when(!allowed, (el) => el.on_click(() => sfx("denied")))
    .child(text || "████████");
}

const field = (name, value) => v_flex().flex_none().gap(2)
  .child(div().font_family(MONO).text_size(9.5).text_color(P.ink2).child(name))
  .child(value);

const txt = (t, c = P.dim, w = 400, size = 10.5) =>
  div().flex_none().font_family(MONO).font_weight(w).text_size(size).text_color(c).child(t);

const folderOf = (cwd) => {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

const agentName = (a) => `${String(a.program?.name ?? a.app ?? "UNKNOWN").toUpperCase()} ${a.address}`;

function programIcon(program, size, fallback) {
  if (!program?.icon) return div().w(size).h(size).flex_none();
  return program.tint
    ? svg(program.icon).size(size).flex_none().text_color(program.color ?? fallback)
    : image(program.icon).w(size).h(size).flex_none();
}

function openTerminate(pane, terminal, name) {
  openOverlay({ mod: "scp", kind: "dialog", modal: true, frame: "none", width: 470, height: 262,
    props: { role: "terminate", pane, terminal, name } });
}

function openArchive() {
  sfx("archive");
  openOverlay({ mod: "scp", kind: "window", key: "scp-archive", frame: "none", width: 620, height: 480, props: { role: "archive" } });
}

function openDossier(address) {
  openOverlay({ mod: "scp", kind: "window", key: `scp-dossier-${address}`, frame: "none", width: 560, height: 470, props: { role: "dossier", address } });
}

function openDeptPicker() {
  openOverlay({ mod: "scp", kind: "dialog", modal: true, frame: "none", width: 420, height: 46 + DEPTS.length * 34 + 4, props: { role: "dept" } });
}

function openOptions() {
  openOverlay({ mod: "scp", kind: "window", key: "scp-options", frame: "none", width: 520, height: 520, props: { role: "options" } });
}

function openLogin(force) {
  // force: "fail" or "pass" for testing; otherwise one login in ten fails
  openOverlay({ mod: "scp", kind: "dialog", modal: true, frame: "none", width: 660, height: 500, props: { role: "login", force } });
}

function openWiki() {
  openOverlay({ mod: "scp", kind: "window", key: "scp-wiki", frame: "none", width: 720, height: 580, props: { role: "wiki" } });
}

// Opens one wiki article in the browser (only scp-wiki.wikidot.com/scp-NNN links).
function openWikiPage(n) {
  const url = wikiUrl(n);
  if (!/^https:\/\/scp-wiki\.wikidot\.com\/scp-\d{3}$/.test(url)) return;
  const pf = appWindow()?.platform;
  try { Promise.resolve(exec(pf === "macos" ? "open" : pf === "windows" ? "cmd" : "xdg-open", pf === "windows" ? ["/c", "start", "", url] : [url])).catch(() => {}); }
  catch { /* no opener available */ }
}

function openArticle() {
  openOverlay({ mod: "scp", kind: "window", key: "scp-article", frame: "none", width: 640, height: 540, props: { role: "article" } });
}

// ---- header ------------------------------------------------------------------

class Header {
  init(_p, cx) {
    this.now = new Date();
    const tick = (cx) => { this.now = new Date(); cx.notify(); };
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => { tick(cx); cx.timer.every(60000, tick); });
  }

  render() {
    const w = appWindow();
    const space = spaces().find((s) => s.active);
    const test = space?.tabs.find((t) => t.active);
    const all = agents();
    const here = space ? all.filter((a) => a.space === space.id) : all;
    const cls = classify(here);
    const breaches = all.filter((a) => a.status === "blocked").length + (drilling() ? 1 : 0);
    const item = `SCP-${String(space?.index ?? 0).padStart(3, "0")}`;
    const d = this.now;
    const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    const clock = t12(d);
    const stardate = `SITE-19 · DAY ${String(day).padStart(3, "0")}`;
    const L = level();

    const compact = opts().compact;
    const brand = h_flex().gap(10).items_center().flex_none()
      .child(svg("mods/scp/emblem.svg").size(compact ? 28 : 42).flex_none().text_color(P.ink)) // tinted, so it reads on dark paper too
      .child(v_flex()
        .child(div().font_family(MONO).font_weight(800).text_size(compact ? 15 : 19).text_color(P.ink).child("SCP FOUNDATION"))
        .when(!compact, (el) => el.child(div().font_family(MONO).text_size(9.5).text_color(P.ink2).child(FLAVOR[deptIdx()].motto))));

    const sep = () => div().w(1).h(34).flex_none().bg(P.rule);

    const fields = h_flex().gap(26).items_center().min_w(0)
      .child(field("ITEM #", div().id("item-no").cursor_pointer().font_family(MONO).font_weight(800).text_size(15).text_color(P.ink)
        .tooltip("Open the Special Containment Procedures for this site (Ctrl+Alt+P)")
        .hover((x) => x.text_color(P.red))
        .on_mouse_down("left", stop).on_click(() => { sfx("tick"); openArticle(); })
        .child(item)))
      .child(field("OBJECT CLASS", div().font_family(MONO).font_weight(800).text_size(15).text_color(cls.color).child(cls.name)))
      .when(!compact, (el) => el.child(field("CONTAINMENT SITE", redact("r-site", space?.name, { size: 14, need: 3 })))
        .child(field("SPECIAL PROCEDURE", redact("r-test", test ? `TEST ${two(test.index)}` : "", { size: 14, need: 3 }))));

    const alarm = breaches
      ? div().flex_none().px(10).py(5).bg(P.red).text_color(P.onRed).font_family(MONO).font_weight(800).text_size(12)
        .loop("opacity", { from: 0.45, to: 1, period: 700 }).child(`⚠ CONTAINMENT BREACH · ${two(breaches)}`)
      : null;

    const badge = div().id("clearance").flex_none().px(8).py(4).bg(P.ink).text_color(P.paper).cursor_pointer()
      .font_family(MONO).font_weight(800).text_size(11)
      .tooltip("Click to change clearance level (1 to 5). Level 5 declassifies everything.")
      .hover((s) => s.opacity(0.8))
      .on_mouse_down("left", stop).on_click(() => { sfx("tick"); cycleLevel(); })
      .child(`CLEARANCE LEVEL ${L}`);

    const dept = div().id("dept").flex_none().px(8).py(4).border(1).border_color(P.ink).cursor_pointer()
      .font_family(MONO).font_weight(800).text_size(10).text_color(P.ink)
      .tooltip("Click to pick a department (14 of them). It recolours the whole UI. Ctrl+Alt+T cycles.")
      .hover((s) => s.bg(P.paper2))
      .on_mouse_down("left", stop).on_click(() => { sfx("tick"); openDeptPicker(); })
      .child(`DEPT: ${DEPTS[deptIdx()].label}`);

    const btn = (id, name, cmd, danger) => div().id(id).w(42).h_full().flex_none().flex().items_center().justify_center()
      .hover((s) => s.bg(danger ? P.red : P.paper2))
      .on_mouse_down("left", stop).on_click(() => run(cmd))
      .child(svg(`mods/scp/icons/${name}.svg`).size(14).flex_none().text_color(P.ink));
    const settingsBtn = btn("w-set", "settings", "scp.options", false).tooltip("Options: sounds, login, stamps, lockdown, compact, paper terminal (Ctrl+Alt+O)");
    const buttons = w?.buttons
      ? h_flex().h_full().flex_none()
        .child(btn("w-min", "win-min", "window.minimize"))
        .child(btn("w-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
        .child(btn("w-close", "win-close", "window.close", true))
      : null;

    return h_flex().id("scp-header").size_full().bg(P.paper).items_center()
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); run("app.palette"); })
      .child(breaches
        ? div().w(6).h_full().flex_none().bg(P.red).loop("opacity", { from: 0.3, to: 1, period: 700 })
        : div().w(6).h_full().flex_none().bg(P.red))
      .child(h_flex().flex_1().min_w(0).h_full().items_center().gap(20)
        .pl(w?.platform === "macos" ? 86 : 14).pr(16)
        .child(brand).child(sep())
        .child(div().flex_1().min_w(0).overflow_hidden().child(fields))
        .when(Boolean(alarm), (el) => el.child(alarm))
        .child(dept)
        .child(badge)
        .child(v_flex().flex_none().items_end()
          .child(div().font_family(MONO).font_weight(800).text_size(18).text_color(P.ink).child(clock))
          .when(!compact, (el) => el.child(div().font_family(MONO).text_size(9).text_color(P.ink2).child(stardate)))))
      .child(settingsBtn)
      .when(Boolean(buttons), (el) => el.child(buttons));
  }
}

// Rotating footer notices shown while there is no incident. A string is plain text;
// { r: "..." } is a redaction bar (need level 5 to declassify).
const NOTICES = [
  ["UNAUTHORIZED ACCESS WILL BE MET WITH", { r: "AMNESTIC ADMINISTRATION" }, "OR", { r: "TERMINATION" }],
  ["REMINDER: DO NOT LOOK DIRECTLY AT", { r: "SCP-173" }],
  ["AMNESTICS ARE OPTIONAL. COMPLIANCE IS NOT."],
  ["THE FOUNDATION OPERATES OUTSIDE ALL", { r: "GOVERNMENTS" }, "AND ALL LAWS."],
  ["IF YOU CAN READ THIS, YOUR CLEARANCE HAS BEEN", { r: "NOTED" }],
  ["REPORT ANOMALOUS TERMINAL BEHAVIOUR TO THE SITE", { r: "DIRECTOR" }],
  ["DO NOT TRUST", { r: "THE NEW HIRE" }, "UNTIL CLEARED BY", { r: "INTERNAL SECURITY" }],
  ["CONTAINMENT IS NOT A SUGGESTION. IT IS A SCHEDULE."],
  ["BLINK. BLINK. DO NOT STOP BLINKING."],
  ["SECURE. CONTAIN. PROTECT."],
];
const NOTICE_MS = 12000;

// ---- footer ------------------------------------------------------------------

class Footer {
  init(_p, cx) {
    setShared("scp.accent", DEPTS[deptIdx()].pal.red); // read by scp-spaces for its selection marker
    this.prev = null;      // address -> status, from the last render
    this.incident = null;  // { text, color, at }
    this.notice = Math.floor(Math.random() * noticeList().length); // which notice shows
    this.queue = [];       // entries waiting to be published to shared LOG_KEY
    this.pendingSeen = {}; // address -> ms first seen, waiting to be published to SEEN_KEY
    this.drillActive = false;
    this.lastL = undefined;
    this.count = logOf().reduce((m, e) => Math.max(m, Number(e?.n) || 0), 0);
    // a drill ends by itself 20 seconds after it began
    cx.timer.every(1000, () => {
      if (this.drillActive && !drilling()) {
        this.drillActive = false;
        setShared(DRILL_KEY, 0);
        this.record("DRILL COMPLETE. ALL SUBJECTS RECONTAINED. THANK YOU FOR YOUR COMPLIANCE.", P.green, "contained");
      }
    });
    // render only queues; this timer publishes (the last KEEP) so every copy sees the archive
    cx.timer.every(700, () => {
      if (Object.keys(this.pendingSeen).length) {
        setShared(SEEN_KEY, { ...seenOf(), ...this.pendingSeen });
        this.pendingSeen = {};
      }
      if (!this.queue.length) return;
      const next = [...logOf(), ...this.queue].slice(-KEEP);
      this.queue = [];
      setShared(LOG_KEY, next);
    });
    // the login screen, once per 30 minutes (scp.login replays it)
    if (opts().compact) applyCompact(); // the layout remembers sizes, but keep it in step with the option
    // Herdr starting up: the app was last alive more than 70 seconds ago (or never). A heartbeat every 20 seconds
    // tells a real start from a layout switch or a mod reload, which must not replay the login.
    // A start is a new Herdr process: its process id (the parent of a command it runs) differs from the one
    // saved at the last start, so even an instant restart shows the login. Layout switches and mod reloads keep
    // the same process and stay quiet. Where the pid cannot be read (Windows), a 10-second heartbeat decides.
    cx.spawn(async (cx) => {
      let pid = null;
      try { const r = await exec("sh", ["-c", "echo $PPID"]); pid = String(r.stdout).trim(); } catch { /* no sh */ }
      let fresh;
      if (/^\d+$/.test(pid ?? "")) {
        fresh = shared("scp.bootPid") !== pid;
        if (fresh) setShared("scp.bootPid", pid);
      } else {
        fresh = Date.now() - (Number(shared("scp.alive")) || 0) > 25000;
        setShared("scp.alive", Date.now());
        cx.timer.every(10000, () => setShared("scp.alive", Date.now()));
      }
      if (opts().login && fresh) cx.timer.after(900, () => openLogin());
    });
    // key commands (scp.cycle / scp.archive / scp.article / scp.login) reach this single copy only
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          if (c === "cycle") { sfx("tick"); cycleLevel(); }
          else if (c === "archive") openArchive();
          else if (c === "article") openArticle();
          else if (c === "wiki") openWiki();
          else if (c === "login") openLogin();
          else if (c === "loginfail") openLogin("fail");
          else if (c === "drill") this.startDrill();
          else if (c === "report") this.exportReport();
          else if (c === "dossier") openDossier(agents()[0]?.address ?? "none");
          else if (c === "dept") { sfx("tick"); cycleDept(); }
          else if (c === "options") openOptions();
        } catch (e) { console.log(`scp: ${c} failed: ${e}`); }
        cx.notify();
      }
    });
    // rotate notices only while they are on screen (no incident), to keep redraws rare
    cx.timer.every(NOTICE_MS, (cx) => {
      if (this.incident) return;
      this.notice = (this.notice + 1) % noticeList().length;
      cx.notify();
    });
    cx.timer.every(10000, (cx) => { if (this.incident && Date.now() - this.incident.at > 30000) { this.incident = null; cx.notify(); } });
  }

  // One incident: queued for the archive, shown in the footer, optionally with a sound.
  record(text, color, sound) {
    this.count += 1;
    const entry = { n: this.count, text, color: semantic(color), at: Date.now() };
    this.queue.push(entry);
    this.incident = { text: `INCIDENT ${String(this.count).padStart(3, "0")}-A: ${text}`, color: semantic(color), at: entry.at };
    if (sound) sfx(sound);
  }

  startDrill() {
    if (drilling()) return;
    setShared(DRILL_KEY, Date.now());
    this.drillActive = true;
    this.record("DRILL: SIMULATED CONTAINMENT BREACH AT SITE-19. THIS IS ONLY A DRILL.", P.red, "breach");
  }

  // Writes the archive to reports/incident-report-<time>.txt in the Herdr home.
  exportReport() {
    const log = logOf();
    const d = new Date();
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const text = [
      org(), `INCIDENT REPORT · ${org()} EYES ONLY`,
      `FILED: ${d.toISOString()}`, `CLEARANCE: LEVEL ${level()}`, `INCIDENTS ON FILE: ${log.length}`, "",
      ...log.map((e) => `INCIDENT ${String(e.n).padStart(3, "0")}-A (${clock3(e.at)}): ${e.text}`),
      "", "END OF REPORT. THIS DOCUMENT DOES NOT EXIST.",
    ].join("\n") + "\n";
    const dir = `${appHome()}/reports`;
    const file = `${dir}/incident-report-${stamp}.txt`;
    exec("mkdir", ["-p", dir])
      .then(() => writeTextFile(file, text, null))
      .then(() => { sfx("stamp"); notify({ title: "REPORT FILED", body: file, level: "success" }); })
      .catch((e) => notify({ title: "REPORT FAILED", body: String(e), level: "error" }));
  }

  // Diffs agents() on render: it records and plays sounds, never notifies.
  watch(all) {
    const now = new Map(all.map((a) => [a.address, a.status]));
    const seen = seenOf();
    for (const a of all) if (!seen[a.address] && !this.pendingSeen[a.address]) this.pendingSeen[a.address] = Date.now();
    if (this.prev) {
      const log = (text, color, sound) => this.record(text, color, sound);
      for (const a of all) {
        const before = this.prev.get(a.address);
        if (before === undefined) log(`SUBJECT ${agentName(a)} ENTERED CONTAINMENT.`, P.amber, "tick");
        else if (before !== a.status && a.status === "blocked") log(`SUBJECT ${agentName(a)} BREACHED CONTAINMENT. RESPONSE TEAM DISPATCHED.`, P.red, "breach");
        else if (before === "working" && (a.status === "done" || a.status === "idle")) log(`SUBJECT ${agentName(a)} RECONTAINED. NO FURTHER ANOMALOUS ACTIVITY.`, P.green, "contained");
      }
      for (const [addr] of this.prev) if (!now.has(addr)) log(`SUBJECT ${addr.toUpperCase()} LOST. DATA EXPUNGED.`, P.dim);
    }
    this.prev = now;
  }

  render() {
    const all = agents();
    this.watch(all);
    const lock = isLockdown();
    if (this.wasLock === false && lock) sfx("klaxon"); // the klaxon sounds once when lockdown begins
    this.wasLock = lock;
    const n = (st) => all.filter((a) => a.status === st).length;
    const bar = (id, t) => redact(id, t, { bg: P.bar, reveal: P.text, size: 10.5, need: 5 });
    const L = level();
    if (this.lastL !== undefined && this.lastL !== L) {
      this.incident = { text: `CLEARANCE UPDATED: LEVEL ${this.lastL} → LEVEL ${L}`, color: L > this.lastL ? P.green : P.amber, at: Date.now() };
    }
    this.lastL = L;
    const inc = this.incident;
    const breach = n("blocked") + (drilling() ? 1 : 0);
    const site = spaces().find((s) => s.active);
    const cls = classify(site ? all.filter((a) => a.space === site.id) : all);

    return h_flex().id("scp-footer").size_full().bg(P.dark).border_t(1).border_color(P.edge)
      .items_center().px(12).gap(8)
      .child(div().w(7).h(7).rounded(4).flex_none().bg(P.red).loop("opacity", { from: 0.3, to: 1, period: 1600 }))
      .child(txt(`CLEARANCE LEVEL ${level()} · ${org()} EYES ONLY`, P.red))
      .child(div().flex_none().px(6).py(1).bg(cls.color).font_family(MONO).font_weight(800).text_size(10).text_color(P.darkPaper ? "#120f05" : "#ffffff")
        .tooltip("Object class of the shown site").child(cls.name))
      .when(Boolean(site?.branch), (el) => el.child(h_flex().flex_none().max_w(180).px(6).py(1).gap(5).items_center().border(1).border_color(P.edge)
        .tooltip(`Branch of the shown site${site?.machine ? ` on ${site.machine}` : ""}`)
        .child(svg("mods/workspace-chrome/branch.svg").size(11).flex_none().text_color(P.text))
        .child(div().min_w(0).truncate().font_family(MONO).font_weight(700).text_size(10).text_color(P.text).child(site.branch))))
      .child(txt("//"))
      .when(Boolean(inc), (el) => el.child(div().flex_1().min_w(0).truncate().font_family(MONO).font_weight(700).text_size(10.5).text_color(col(inc.color)).child(inc.text)))
      .when(!inc, (el) => el.child(h_flex().id("notice").flex_1().min_w(0).gap(8).items_center().overflow_hidden()
        .children((opts().notices ? noticeList()[this.notice % noticeList().length] : [FLAVOR[deptIdx()].motto]).map((part, i) =>
          typeof part === "string" ? txt(part) : bar(`nb-${this.notice}-${i}`, part.r)))))
      .child(div().id("archive-btn").flex_none().px(6).py(1).border(1).border_color(P.edge).cursor_pointer()
        .tooltip("Open the Incident Archive (Ctrl+Alt+I)").hover((x) => x.bg(P.dark2))
        .on_click(() => { sfx("tick"); openArchive(); })
        .child(txt(`INCIDENT ARCHIVE ${two(logOf().length)}`, P.text, 700, 10)))
      .child(txt(`${two(all.length)} SUBJECTS`))
      .child(txt(`${two(n("working"))} IN CONTAINMENT`, P.amber))
      .child(txt(`${two(breach)} BREACH`, breach ? P.red : P.dim));
  }
}

// ---- pane header -------------------------------------------------------------

class PaneHeader {
  init() { this.hovered = false; }

  render() {
    const all = panes();
    const pr = props() ?? {};
    const idx = all.findIndex((p) => p.pane === pr.pane);
    const p = all[idx];
    if (!p) return div();
    const lit = p.focused;
    const pane = p.pane;
    const name = String(((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell").toUpperCase();
    const stamp = stampOf(p.status);
    const haz = p.status === "blocked"; // cognitohazard mode while a subject is in breach
    const unit = p.terminal ? unitOf(p.terminal) : null;

    const ctl = (id, icon, onClick) => div().id(id).px(5).h_full().flex().items_center()
      .hover((s) => s.bg(P.edge))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(svg(`mods/scp/icons/${icon}.svg`).size(13).flex_none().text_color(P.dim));

    // Closing a terminal asks for a Termination Order; a mod panel just closes.
    const close = () => (p.terminal ? openTerminate(pane, p.terminal, name) : run("pane.close", { pane }));

    return h_flex().id(`scp-pane-${pane}`).size_full().pl(10).pr(4).gap(8).items_center()
      .bg(haz ? mix(P.red, "#0c0d0d", 0.2) : lit ? P.dark2 : P.dark).border_b(1).border_color(lit || haz ? P.red : P.edge)
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().w(7).h(7).flex_none().bg(lit ? P.red : P.edge)
        .when(lit, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1600 })))
      .child(txt(`DOC-${String(idx + 1).padStart(3, "0")}`, P.text, 700))
      .child(txt("SUBJECT:"))
      .child(div().flex_none().max_w(220).truncate().font_family(MONO).font_weight(700).text_size(11).text_color(P.text).child(name))
      .when(Boolean(unit), (el) => el.child(div().flex_none().px(5).py(1).bg(P.edge).font_family(MONO).font_weight(800).text_size(9.5).text_color(P.dim)
        .tooltip(`MTF ${unit.full.toUpperCase()} "${unit.nick}"`).child(`MTF ${unit.code}`)))
      .child(div().flex_1().min_w(0).flex().justify_end()
        .child(haz
          ? div().flex_none().px(6).py(1).font_family(MONO).font_weight(800).text_size(10).text_color(P.onRed).bg(P.red)
            .tooltip("Cognitohazard: do not read this terminal's output until the breach is resolved")
            .loop("opacity", { from: 0.5, to: 1, period: 500 }).child("⚠ COGNITOHAZARD · DO NOT READ")
          : redact(`rp-${pane}`, folderOf(p.cwd) || "~", { bg: P.bar, reveal: P.text, size: 10.5, need: 2 })))
      .child(div().flex_none().px(6).py(1).border(1).border_color(stamp.color)
        .font_family(MONO).font_weight(800).text_size(10).text_color(stamp.color)
        .when(p.status === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 700 }))
        .child(stamp.text))
      .when(this.hovered, (el) => el
        .child(ctl(`sp-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
        .child(ctl(`sp-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
        .child(ctl(`sp-z-${pane}`, p.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
        .child(ctl(`sp-x-${pane}`, "close", close)));
  }
}

// ---- personnel files (the agent list) ---------------------------------------

class Personnel {
  init(_p, cx) {
    this.known = []; // agents that can be started (programs.json run), installed ones only
    cx.spawn(async (cx) => {
      try { this.known = (await knownAgents({})).filter((a) => a.installed && a.run).slice(0, 4); }
      catch (e) { console.log(`scp: knownAgents failed: ${e}`); }
      cx.notify();
    });
  }

  render() {
    const list = agents();
    setAgentOrder(list.map((a) => a.address));

    const file = (a) => {
      const st = stampOf(a.status);
      const name = String(a.program?.name ?? a.app ?? "Subject").toUpperCase();
      return h_flex().id(`pf-${a.address}`).w_full().flex_none().px(10).py(8).gap(10).items_center().cursor_pointer()
        .border_b(1).border_color(P.edge)
        .bg(a.focused ? P.dark2 : P.dark).hover((s) => s.bg(P.dark2))
        .on_click(() => run("agent.focus", { terminal: a.address }))
        // photo box with a status corner, like a clipped ID photo
        .child(div().relative().w(40).h(46).flex_none().flex().items_center().justify_center()
          .bg("#1f2222").border(1).border_color(a.focused ? P.red : P.edge)
          .child(programIcon(a.program, 20, P.text))
          .child(div().absolute().top(0).right(0).w(8).h(8).bg(st.color)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().truncate().font_family(MONO).text_size(9.5).text_color(P.dim).child(`ID: SUBJECT-${a.address.toUpperCase()} · MTF ${unitOf(a.address).code}`))
          .child(div().truncate().font_family(MONO).font_weight(700).text_size(12).text_color(P.text).child(name))
          .child(h_flex().gap(6).items_center().min_w(0)
            .child(div().flex_none().px(5).py(1).border(1).border_color(st.color)
              .font_family(MONO).font_weight(800).text_size(8.5).text_color(st.color)
              .when(a.status === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 700 }))
              .child(st.text))
            .child(redact(`pfs-${a.address}`, a.space_name, { bg: P.bar, reveal: P.text, size: 9.5, need: 2 }))
            .child(div().flex_1())
            .child(div().id(`dos-${a.address}`).flex_none().px(5).py(1).border(1).border_color(P.edge).cursor_pointer()
              .font_family(MONO).font_weight(800).text_size(8.5).text_color(P.dim)
              .tooltip("Open this subject's dossier").hover((s) => s.text_color(P.text).border_color(P.dim))
              .on_click((_e, cx) => { cx.stop_propagation(); sfx("tick"); openDossier(a.address); })
              .child("FILE"))));
    };

    return v_flex().id("personnel").size_full().bg(P.dark)
      .child(h_flex().w_full().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(P.edge)
        .child(txt("PERSONNEL FILES", P.text, 700, 11))
        .child(div().px(5).bg(P.paper).text_color(P.ink).font_family(MONO).font_weight(800).text_size(10).child(two(list.length)))
        .child(div().flex_1())
        .child(txt("EYES ONLY", P.red, 700, 9.5)))
      .child(v_flex().id("pf-list").w_full().flex_1().min_h(0).overflow_y_scrollbar()
        .children(list.map(file))
        .when(list.length === 0, (el) => el.child(v_flex().p(14).gap(8)
          .child(div().font_family(MONO).text_size(10.5).text_color(P.dim).child("NO PERSONNEL ON FILE. ASSIGN A SUBJECT:"))
          .child(h_flex().gap(6).flex_wrap()
            .children(this.known.map((a) => div().id(`new-subj-${a.name}`).px(8).py(4).border(1).border_color(P.edge).cursor_pointer()
              .hover((x) => x.bg(P.dark2)).tooltip(`Start ${a.name} in a new tab`)
              .on_click(() => { sfx("tick"); run("tab.new", { name: a.name, argv: a.run }); })
              .child(txt(`+ ${String(a.name).toUpperCase()}`, P.text, 700, 9.5))))
            .child(div().id("new-subj-shell").px(8).py(4).border(1).border_color(P.edge).cursor_pointer()
              .hover((x) => x.bg(P.dark2)).tooltip("Open a plain terminal in a new tab")
              .on_click(() => { sfx("tick"); run("tab.new", {}); })
              .child(txt("+ TERMINAL", P.text, 700, 9.5)))))));
  }
}

// ---- [DATA EXPUNGED] stamps --------------------------------------------------

// A floating block over the work area: one stamp per idle pane you are not looking at.
class Stamps {
  init(_p, cx) {
    this.hidden = new Set(); // panes whose stamp was dismissed, until they stop being idle
    this.born = {};          // pane -> ms it started being idle and unfocused
    cx.timer.every(30000, (cx) => cx.notify()); // stamps change wording with age
  }

  render() {
    if (!opts().stamps) return div();
    const all = panes();
    const eligible = all.map((p, i) => ({ p, i })).filter(({ p }) => p.terminal && p.status === "idle" && !p.focused);
    // a dismissed stamp stays away only while its pane stays idle and unfocused
    for (const id of [...this.hidden]) if (!eligible.some(({ p }) => p.pane === id)) this.hidden.delete(id);
    for (const { p } of eligible) this.born[p.pane] ??= Date.now();
    for (const id of Object.keys(this.born)) if (!eligible.some(({ p }) => p.pane === id)) delete this.born[id];
    // newest idle stamps read [DATA EXPUNGED]; older ones escalate
    const stampText = (id) => { const age = Date.now() - (this.born[id] ?? Date.now()); return age < 120000 ? "[DATA EXPUNGED]" : age < 600000 ? "CLASSIFIED" : "TOP SECRET"; };
    const idle = eligible.filter(({ p }) => !this.hidden.has(p.pane)).slice(0, 4);
    // a stamp thump when a new one lands (render only plays a sound, it never notifies)
    const ids = new Set(idle.map(({ p }) => p.pane));
    if (this.seen && idle.some(({ p }) => !this.seen.has(p.pane))) sfx("stamp");
    this.seen = ids;
    if (!idle.length) return div();
    const dismiss = (id, tip, onClick) => div().id(id).flex_none().w(20).h(20).flex().items_center().justify_center()
      .border(1).border_color(P.red).cursor_pointer().tooltip(tip)
      .hover((x) => x.bg(P.red).text_color(P.onRed))
      .font_family(MONO).font_weight(800).text_size(11).text_color(P.red)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); sfx("tick"); onClick(); cx.notify(); })
      .child("✕");
    return v_flex().gap(6).p(6)
      .when(idle.length > 1, (el) => el.child(h_flex().justify_end().child(
        dismiss("st-clear", "Dismiss all stamps (they return when a pane goes idle again)", () => idle.forEach(({ p }) => this.hidden.add(p.pane))))))
      .children(idle.map(({ p, i }) => h_flex().id(`st-${p.pane}`).gap(8).items_center().pl(10).pr(5).py(5).border(2).border_color(P.red).bg(mix(P.red, "#0c0d0d", 0.12))
        .cursor_pointer().on_click(() => run("pane.focus", { pane: p.pane }))
        .tooltip("Idle subject: click to focus")
        .child(div().flex_1().loop("opacity", { from: 0.55, to: 1, period: 2400 })
          .font_family(MONO).font_weight(800).text_size(12).text_color(P.red)
          .child(`DOC-${String(i + 1).padStart(3, "0")} · ${stampText(p.pane)}`))
        .child(dismiss(`st-x-${p.pane}`, "Dismiss this stamp", () => this.hidden.add(p.pane)))));
  }
}

// ---- Termination Order dialog -----------------------------------------------

class Terminate {
  init(_p, cx) {
    this.phase = "ask"; // ask | done
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  target() {
    const p = props() ?? {};
    const pane = panes().find((x) => x.pane === p.pane);
    return !pane || (p.terminal && pane.terminal !== p.terminal) ? null : pane;
  }

  close() { closeOverlay(props()?.overlay); }

  rescind() { sfx("tick"); this.close(); }

  authorize(cx) {
    if (this.phase !== "ask") return;
    const pane = this.target();
    if (!pane) return this.close();
    this.phase = "done";
    sfx("terminate");
    cx.notify();
    cx.timer.after(450, () => {
      const still = this.target();
      if (still) run("pane.close", { pane: still.pane });
      this.close();
    });
  }

  render() {
    const p = props() ?? {};
    const pane = this.target();
    const done = this.phase === "done";

    const button = (id, text, primary, act) => h_flex().id(id).h(34).px(16).items_center().cursor_pointer()
      .bg(primary ? P.red : P.paper2).border(1).border_color(primary ? P.red : P.rule)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => act(cx))
      .child(div().font_family(MONO).font_weight(800).text_size(12).text_color(primary ? P.onRed : P.ink).child(text));

    return v_flex().id("terminate").size_full().bg(P.paper).border(2).border_color(P.ink).overflow_hidden()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.rescind();
        else if (e.key === "enter") this.authorize(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().w_full().h(46).flex_none().items_center().bg(P.ink)
        .child(div().w(8).h_full().flex_none().bg(P.red))
        .child(v_flex().px(12)
          .child(div().font_family(MONO).font_weight(800).text_size(15).text_color(P.paper).child("TERMINATION ORDER"))
          .child(div().font_family(MONO).text_size(9.5).text_color(P.dim).child("Enter to authorize · Esc to rescind"))))
      .child(v_flex().flex_1().px(18).py(14).gap(10)
        .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child("FORM 7-TERM · LEVEL 4 AUTHORIZATION REQUIRED"))
        .child(h_flex().gap(6).items_center().flex_wrap()
          .child(div().font_family(MONO).font_weight(700).text_size(13).text_color(P.ink).child("TERMINATE SUBJECT"))
          .child(div().px(6).bg(P.black).text_color(P.paper).font_family(MONO).font_weight(800).text_size(13).max_w(240).truncate().child(p.name ?? "UNKNOWN")))
        .child(div().font_family(MONO).text_size(12).line_height(1.5).text_color(P.ink)
          .child(pane
            ? "THIS CONTAINMENT CELL WILL BE CLOSED AND ITS PROCESS ENDED. NO RECORD OF THE SESSION WILL BE KEPT. THIS CANNOT BE UNDONE."
            : "THE SUBJECT HAS ALREADY LEFT THE FACILITY. NO ACTION REQUIRED.")))
      .child(h_flex().w_full().flex_none().px(18).pb(16).gap(8).justify_end()
        .child(button("rescind", "RESCIND ORDER", false, () => this.rescind()))
        .when(Boolean(pane), (el) => el.child(button("authorize", done ? "TERMINATED" : "AUTHORIZE TERMINATION", true, (cx) => this.authorize(cx)))));
  }
}

// ---- document windows (Incident Archive, Special Containment Procedures) -----

// Incident colours were chosen for the dark footer; darker equivalents for paper.
function onPaper(c) {
  if (P.darkPaper) return c; // bright colours already read on dark paper
  return { [P.amber]: "#8a5d00", [P.green]: "#3f6b27", [P.dim]: P.ink2, [P.red]: P.red }[c];
}
const clock3 = (ms) => { return t12(new Date(ms), true); };

/** The title bar of a frameless window: dragging it moves the window, X closes it. */
function windowBar(title, sub) {
  return h_flex().w_full().h(46).flex_none().items_center().bg(P.ink)
    .child(div().w(8).h_full().flex_none().bg(P.red))
    .child(v_flex().flex_1().px(12)
      .child(div().font_family(MONO).font_weight(800).text_size(15).text_color(P.paper).child(title))
      .child(div().font_family(MONO).text_size(9.5).text_color(P.dim).child(sub)))
    .child(div().id("win-x").w(46).h_full().flex().items_center().justify_center().cursor_pointer()
      .hover((s) => s.bg(P.red))
      .on_mouse_down("left", stop).on_click(() => closeOverlay(props()?.overlay))
      .child(svg("mods/scp/icons/win-close.svg").size(14).flex_none().text_color(P.paper)));
}

const sheet = () => v_flex().size_full().bg(P.paper).border(2).border_color(P.ink).overflow_hidden();

const sentence = (t) => { const s = String(t).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

class Archive {
  init() { this.mode = "log"; } // log | interview

  render() {
    const log = logOf().slice().reverse();
    const interview = (e) => v_flex().w_full().flex_none().px(18).py(8).gap(3).border_b(1).border_color(P.rule)
      .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child(`INTERVIEW LOG ${String(e.n).padStart(3, "0")}-A · ${clock3(e.at)}`))
      .child(div().font_family(MONO).text_size(12).line_height(1.45).text_color(P.ink)
        .child("INTERVIEWER: State the nature of the incident for the record."))
      .child(div().font_family(MONO).font_weight(700).text_size(12).line_height(1.45).text_color(onPaper(col(e.color)) ?? P.ink)
        .child(`SUBJECT: ${sentence(e.text)}`));
    const tab = (id, text, mode) => div().id(id).px(10).py(4).cursor_pointer()
      .bg(this.mode === mode ? P.ink : P.paper2).text_color(this.mode === mode ? P.paper : P.ink)
      .font_family(MONO).font_weight(800).text_size(10)
      .on_click((_e, cx) => { sfx("tick"); this.mode = mode; cx.notify(); }).child(text);
    const exportBtn = div().id("arch-export").px(10).py(4).cursor_pointer().bg(P.red).text_color(P.onRed)
      .font_family(MONO).font_weight(800).text_size(10).hover((s) => s.opacity(0.85))
      .tooltip("Write the archive to a text file in the Herdr home (Ctrl+Alt+R)")
      .on_click(() => run("scp.report")).child("FILE REPORT");
    const row = (e) => v_flex().w_full().flex_none().px(18).py(8).gap(2).border_b(1).border_color(P.rule)
      .child(h_flex().gap(10).items_center()
        .child(div().font_family(MONO).font_weight(800).text_size(11).text_color(P.ink).child(`INCIDENT ${String(e.n).padStart(3, "0")}-A`))
        .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child(clock3(e.at))))
      .child(div().font_family(MONO).font_weight(700).text_size(12).line_height(1.4).text_color(onPaper(col(e.color)) ?? P.ink).child(e.text));

    return sheet()
      .child(windowBar("INCIDENT ARCHIVE", `FOUNDATION RECORDS · ${two(log.length)} ON FILE · NEWEST FIRST`))
      .child(h_flex().w_full().flex_none().px(18).py(6).gap(6).items_center().bg(P.paper2).border_b(1).border_color(P.rule)
        .child(tab("arch-t-log", "LOG", "log"))
        .child(tab("arch-t-int", "INTERVIEW", "interview"))
        .child(div().flex_1())
        .child(exportBtn))
      .child(v_flex().id("arch-list").flex_1().min_h(0).w_full().overflow_y_scrollbar()
        .children(log.map(this.mode === "interview" ? interview : row))
        .when(log.length === 0, (el) => el.child(div().p(18).font_family(MONO).text_size(12).line_height(1.5).text_color(P.ink2)
          .child("NO INCIDENTS ON FILE. THE FOUNDATION REMINDS YOU THAT THIS IS NOT A GUARANTEE."))));
  }
}

class Article {
  render() {
    const space = spaces().find((s) => s.active);
    const all = agents();
    const here = space ? all.filter((a) => a.space === space.id) : all;
    const cls = classify(here);
    const tests = space?.tabs.length ?? 0;
    const item = `SCP-${String(space?.index ?? 0).padStart(3, "0")}`;
    const recent = logOf().slice(-3).reverse();
    const subjects = here.length;

    const label = (t) => div().font_family(MONO).font_weight(800).text_size(11).text_color(P.ink).child(t);
    const body = (t) => div().font_family(MONO).text_size(12).line_height(1.55).text_color(P.ink).child(t);
    const line = (k, v) => h_flex().gap(8).items_start().flex_wrap().child(label(k)).child(v);
    const colored = (t, c) => div().font_family(MONO).font_weight(800).text_size(12).text_color(c).child(t);

    const procedures = `${item} is to be kept in ${tests === 1 ? "one test cell" : `${tests} test cells`} at all times. `
      + (subjects
        ? `${subjects === 1 ? "One subject is" : `${subjects} subjects are`} to remain under continuous observation. `
        : "No subjects are currently assigned; the site is to be left undisturbed. ")
      + (cls.name === "KETER" || cls.name === "APOLLYON"
        ? "Containment has been breached. Personnel are to respond to the affected cell immediately and await further instruction."
        : "Standard procedures apply. Personnel are reminded that unauthorized commands will be met with consequences.");

    const description = subjects
      ? here.map((a) => `${String(a.program?.name ?? a.app ?? "Subject").toUpperCase()} (${a.address.toUpperCase()}): ${stampOf(a.status).text}`).join(" · ")
      : `${item} is an empty workspace. Its previous occupants are [DATA EXPUNGED].`;

    return sheet()
      .child(windowBar("SPECIAL CONTAINMENT PROCEDURES", `${item} · ${org()} EYES ONLY`))
      .child(v_flex().id("art-body").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(22).py(16).gap(12)
        .child(line("Item #:", colored(item, P.ink)))
        .child(line("Object Class:", colored(cls.name, cls.color)))
        .child(line("Containment Site:", redact("a-site", space?.name, { size: 12, need: 3 })))
        .child(div().w_full().h(1).bg(P.rule))
        .child(label("Special Containment Procedures:"))
        .child(body(procedures))
        .child(label("Description:"))
        .child(body(description))
        .child(label("Addendum:"))
        .child(recent.length
          ? v_flex().gap(6).children(recent.map((e) => div().font_family(MONO).text_size(11).line_height(1.45).text_color(onPaper(col(e.color)) ?? P.ink)
            .child(`INCIDENT ${String(e.n).padStart(3, "0")}-A (${clock3(e.at)}): ${e.text}`)))
          : body("No incidents on file."))
        .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child("SEE ALSO: INCIDENT ARCHIVE (CTRL+ALT+I). THIS DOCUMENT UPDATES ITSELF.")));
  }
}

// ---- personnel dossier (one subject's file) ----------------------------------

class Dossier {
  render() {
    const address = props()?.address;
    const a = agents().find((x) => x.address === address);
    const unit = unitOf(address);
    const since = Number(seenOf()[address]) || 0;
    const mins = since ? Math.max(0, Math.round((Date.now() - since) / 60000)) : 0;
    const st = stampOf(a?.status);
    const name = String(a?.program?.name ?? a?.app ?? "Subject").toUpperCase();
    const history = logOf().filter((e) => String(e.text).toLowerCase().includes(String(address).toLowerCase())).slice(-6).reverse();

    const label = (t) => div().font_family(MONO).font_weight(800).text_size(11).text_color(P.ink).child(t);
    const body = (t) => div().font_family(MONO).text_size(12).line_height(1.5).text_color(P.ink).child(t);
    const line = (k, v) => h_flex().gap(8).items_center().flex_wrap().child(label(k)).child(v);

    return sheet()
      .child(windowBar("PERSONNEL FILE", `SUBJECT-${String(address).toUpperCase()} · ${org()} EYES ONLY`))
      .child(v_flex().id("dos-body").flex_1().min_h(0).w_full().overflow_y_scrollbar().px(22).py(16).gap(12)
        .child(h_flex().gap(16).items_start()
          .child(div().relative().w(84).h(100).flex_none().flex().items_center().justify_center()
            .bg(P.paper2).border(2).border_color(P.ink)
            .child(a ? programIcon(a.program, 36, P.ink) : div().font_family(MONO).font_weight(800).text_size(11).text_color(P.ink2).child("NO PHOTO"))
            .child(div().absolute().top(0).right(0).w(12).h(12).bg(st.color)))
          .child(v_flex().flex_1().min_w(0).gap(8)
            .child(line("Subject:", div().font_family(MONO).font_weight(800).text_size(15).text_color(P.ink).child(name)))
            .child(line("Status:", div().px(6).py(1).border(1).border_color(onPaper(st.color) ?? st.color)
              .font_family(MONO).font_weight(800).text_size(11).text_color(onPaper(st.color) ?? st.color).child(a ? st.text : "LEFT THE FACILITY")))
            .child(line("Task Force:", body(`MTF ${unit.full.toUpperCase()} "${unit.nick.toUpperCase()}" (${unit.code})`)))
            .child(line("In containment:", body(since ? (mins < 1 ? "LESS THAN A MINUTE" : `${mins} MINUTE${mins === 1 ? "" : "S"}`) : "[DATA EXPUNGED]")))))
        .child(div().w_full().h(1).bg(P.rule))
        .child(line("Containment Site:", redact("d-site", a?.space_name, { size: 12, need: 2 })))
        .child(line("Last known location:", redact("d-cwd", folderOf(a?.cwd) || "", { size: 12, need: 3 })))
        .child(label("Incident history:"))
        .child(history.length
          ? v_flex().gap(6).children(history.map((e) => div().font_family(MONO).text_size(11).line_height(1.45).text_color(onPaper(col(e.color)) ?? P.ink)
            .child(`INCIDENT ${String(e.n).padStart(3, "0")}-A (${clock3(e.at)}): ${e.text}`)))
          : body("No incidents on file for this subject."))
        .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child("THIS FILE UPDATES ITSELF. ITS CONTENTS ARE NOT TO BE REMOVED FROM THE SITE.")));
  }
}

// ---- machines (this computer and remote sites) -------------------------------

// state -> [label, colour]
const machineState = (st) => ({
  connected: ["ONLINE", P.green], asleep: ["ASLEEP", P.dim], needs_login: ["LOGIN REQUIRED", P.amber],
  unreachable: ["UNREACHABLE", P.red],
}[st]);

class Machines {
  init(_p, cx) {
    this.list = []; // remote machines from `hc machine ls`
    const refresh = (cx) => cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.list = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch (e) { console.log(`scp: machine ls failed: ${e}`); }
      cx.notify();
    });
    refresh(cx);
    cx.timer.every(15000, refresh);
  }

  render() {
    const sp = spaces();
    const all = agents();
    const names = [...new Set([...this.list.map((m) => m.name), ...sp.map((s) => s.machine).filter(Boolean)])].sort();
    const rows = [null, ...names];

    const row = (m) => {
      const info = this.list.find((k) => k.name === m);
      const mine = sp.filter((s) => (s.machine ?? null) === m);
      const ids = new Set(mine.map((s) => s.id));
      const nAgents = all.filter((a) => ids.has(a.space)).length;
      const state = m ? (info?.state ?? "asleep") : "connected";
      const [label, color] = machineState(state) ?? [String(state).replace(/_/g, " ").toUpperCase(), P.dim];
      const here = mine.some((s) => s.active);
      const login = state === "needs_login" ? `hc machine login ${m}` : null;
      const go = () => {
        sfx("tick");
        const target = mine.find((s) => s.active) ?? mine[0];
        if (target) run("space.select", { id: target.id });
        else if (state === "connected") run("space.new", { machine: m ?? "" });
        else run("app.settings", { section: "machines" });
      };
      return h_flex().id(`mach-${m ?? "local"}`).w_full().h(34).flex_none().px(10).gap(8).items_center().cursor_pointer()
        .bg(here ? P.dark2 : P.dark).border_b(1).border_color(P.edge).hover((s) => s.bg(P.dark2))
        .tooltip(login ? `Needs a login: run ${login} in a terminal` : m ? `${m} · ${label}` : "This computer")
        .on_click(go)
        .child(div().w(2).h(18).flex_none().bg(here ? P.red : "#00000000"))
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(14).flex_none().text_color(here ? P.text : P.dim))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(m
            ? redact(`mach-n-${m}`, m.toUpperCase(), { bg: P.bar, reveal: P.text, size: 11, need: 2 })
            : txt("THIS COMPUTER", P.text, 800, 11))
          .child(txt(`${two(mine.length)} SPACES · ${two(nAgents)} AGENTS`, P.dim, 400, 9)))
        .child(div().flex_none().px(5).py(1).border(1).border_color(color)
          .font_family(MONO).font_weight(800).text_size(8.5).text_color(color).child(label))
        .when(state === "connected", (el) => el.child(div().id(`mach-new-${m ?? "local"}`).flex_none().w(20).h(20).flex().items_center().justify_center()
          .border(1).border_color(P.edge).font_family(MONO).font_weight(800).text_size(12).text_color(P.dim)
          .tooltip(`New space on ${m ?? "this computer"}`).hover((s) => s.text_color(P.text).border_color(P.dim))
          .on_click((_e, cx) => { cx.stop_propagation(); sfx("tick"); run("space.new", { machine: m ?? "" }); })
          .child("+")));
    };

    return v_flex().id("machines").size_full().bg(P.dark)
      .child(h_flex().w_full().h(26).flex_none().px(12).gap(8).items_center().border_b(1).border_color(P.edge)
        .child(txt("MACHINES", P.text, 700, 10.5))
        .child(div().flex_1())
        .child(div().id("mach-add").flex_none().px(6).py(1).border(1).border_color(P.edge).cursor_pointer()
          .tooltip("Add a remote machine (Settings > Machines)").hover((s) => s.bg(P.dark2))
          .on_click(() => { sfx("tick"); run("app.settings", { section: "machines" }); })
          .child(txt("+ ADD MACHINE", P.text, 700, 9))))
      .child(v_flex().id("mach-list").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(rows.map(row)));
  }
}

// ---- quick actions (the key commands, as buttons) ----------------------------

class Actions {
  render() {
    const live = drilling();
    const btn = (id, label, tip, onClick, hot) => div().id(`act-${id}`).flex_1().min_w(0).h(20).flex().items_center().justify_center()
      .border(1).border_color(hot ? P.red : P.edge).cursor_pointer().hover((x) => x.bg(P.dark2))
      .tooltip(tip).on_click(() => { sfx("tick"); onClick(); })
      .child(txt(label, hot ? P.red : P.text, 700, 9));
    return h_flex().id("scp-actions").size_full().bg(P.dark).border_b(1).border_color(P.edge).px(8).gap(6).items_center()
      .child(btn("drill", live ? "DRILL \u25cf" : "DRILL", "Stage a 20-second breach drill (Ctrl+Alt+D)", () => run("scp.drill"), live))
      .child(btn("report", "REPORT", "Write an incident report file (Ctrl+Alt+R)", () => run("scp.report")))
      .child(btn("dept", "DEPT", "Cycle the department theme (Ctrl+Alt+T)", () => cycleDept()))
      .child(btn("archive", "ARCHIVE", "Open the Incident Archive (Ctrl+Alt+I)", () => openArchive()))
      .child(btn("wiki", "WIKI", "Browse the SCP wiki's Content Archives (Ctrl+Alt+W)", () => openWiki()));
  }
}

// ---- agent dock (right panel): every agent the system can start --------------

// Install commands, taken from each project's own docs (checked November 2026). `all` works on every system;
// otherwise `unix` is for macOS and Linux and `windows` for Windows. An agent with no entry for this system
// gets no install button (Kimi, Grok, DeepSeek and Pig have no confirmed command).
const INSTALLERS = {
  codex: { src: "github.com/openai/codex", unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", windows: "npm install -g @openai/codex" },
  gemini: { src: "geminicli.com/docs/get-started/installation", all: "npm install -g @google/gemini-cli" },
  opencode: { src: "opencode.ai/docs", unix: "curl -fsSL https://opencode.ai/install | bash", windows: "npm install -g opencode-ai" },
  cursor: { src: "cursor.com/docs/cli/installation", unix: "curl https://cursor.com/install -fsS | bash", windows: "irm 'https://cursor.com/install?win32=true' | iex" },
  copilot: { src: "docs.github.com/copilot (Install Copilot CLI)", all: "npm install -g @github/copilot" },
  amp: { src: "ampcode.com/manual", unix: "curl -fsSL https://ampcode.com/install.sh | bash" },
  crush: { src: "github.com/charmbracelet/crush", all: "npm install -g @charmland/crush" },
  kiro: { src: "kiro.dev/docs/cli/installation", unix: "curl -fsSL https://cli.kiro.dev/install | bash", windows: "irm 'https://cli.kiro.dev/install.ps1' | iex" },
  pi: { src: "github.com/badlogic/pi-mono", all: "npm install -g @mariozechner/pi-coding-agent" },
  qoder: { src: "docs.qoder.com/cli/installation", unix: "curl -fsSL https://qoder.com/install | bash", windows: "npm install -g @qoder-ai/qodercli" },
  jcode: { src: "github.com/1jehuang/jcode", unix: "curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.sh | bash", windows: "irm https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.ps1 | iex" },
};
const SYSTEM = () => appWindow()?.platform ?? "linux"; // "linux" | "macos" | "windows"
const SYSTEM_LABEL = { linux: "LINUX", macos: "MACOS", windows: "WINDOWS" };
const installFor = (name) => {
  const s = INSTALLERS[String(name).toLowerCase()];
  const cmd = s && (s.all ?? (SYSTEM() === "windows" ? s.windows : s.unix));
  return cmd ? { cmd, src: s.src } : null;
};

class Dock {
  init(_p, cx) {
    this.list = [];      // knownAgents(): { name, run, installed, icon, tint, color, ... }
    this.state = "loading";
    const load = (cx) => cx.spawn(async (cx) => {
      try { this.list = await knownAgents({}); this.state = "ready"; }
      catch (e) { this.state = this.list.length ? "ready" : "error"; console.log(`scp: dock knownAgents failed: ${e}`); }
      cx.notify();
    });
    load(cx);
    cx.timer.every(60000, load);
  }

  // Hyprland-style: a new agent tiles into the current tab, alternating right and down as the tab fills up
  // (dwindle). Right-click opens it as its own tab instead.
  launch(a, place) {
    sfx("tick");
    const here = spaces().find((s) => s.active);
    const tab = here?.tabs?.find((t) => t.active) ?? here?.tabs?.[0];
    const n = panes().filter((p) => tab && p.tab === tab.id).length;
    const where = place ?? (n === 0 ? "tab" : n % 2 === 1 ? "right" : "down");
    run("terminal.open", { argv: a.run, name: a.name, place: where });
  }

  // Opens a tab that shows the system, the source and the exact command, and runs it only if you answer y.
  install(a) {
    const spec = installFor(a.name);
    if (!spec) return;
    sfx("tick");
    const win = SYSTEM() === "windows";
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const argv = win
      ? ["powershell", "-NoProfile", "-Command", [
          "& { param($n,$c,$s)",
          "Clear-Host; Write-Host \"INSTALL $n\"",
          "Write-Host \"System : Windows $env:PROCESSOR_ARCHITECTURE\"; Write-Host \"Source : $s\"; Write-Host \"Command: $c\"; Write-Host \"\"",
          "if ($c -like 'npm*' -and -not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Host 'Node.js/npm not found. Install Node.js first (https://nodejs.org), then try again.'; Read-Host 'Press Enter to close'; return }",
          "$a = Read-Host 'Run it? [y/N]'",
          "if ($a -match '^[yY]') { Invoke-Expression $c; Write-Host ''; Write-Host 'Finished. Open a new tab if the command is not found.' } else { Write-Host 'Cancelled.' }",
          `Read-Host 'Press Enter to close' } ${q(a.name)} ${q(spec.cmd)} ${q(spec.src)}`,
        ].join("; ")]
      : ["sh", "-c", [
          "clear",
          "printf 'INSTALL %s\\n' \"$1\"",
          "printf 'System : %s %s\\n' \"$(uname -s)\" \"$(uname -m)\"",
          "printf 'Source : %s\\n' \"$3\"",
          "printf 'Command: %s\\n\\n' \"$2\"",
          "case \"$2\" in npm*) command -v npm >/dev/null 2>&1 || { echo 'Node.js/npm not found. Install Node.js first (https://nodejs.org), then try again.'; printf 'Press Enter to close. '; read _; exit 1; };; esac",
          "printf 'Run it? [y/N] '; read a",
          "case \"$a\" in y|Y) eval \"$2\"; rc=$?; echo; echo \"Finished (exit code $rc). Open a new tab if the command is not found.\";; *) echo Cancelled.;; esac",
          "printf 'Press Enter to close. '; read _",
        ].join("\n"), "sh", a.name, spec.cmd, spec.src];
    run("terminal.open", { argv, name: `Install ${a.name}`, place: "tab" });
  }

  render() {
    const all = agents();
    const ready = this.list.filter((a) => a.installed && a.run);
    const missing = this.list.filter((a) => !(a.installed && a.run));
    const running = (a) => all.filter((x) => String(x.program?.name ?? "").toLowerCase() === String(a.name).toLowerCase()).length;
    const row = (a, ok) => {
      const n = running(a);
      const spec = ok ? null : installFor(a.name);
      return h_flex().id(`dock-${a.name}`).w_full().flex_none().h(40).px(10).gap(9).items_center()
        .border_b(1).border_color(P.edge).when(ok, (el) => el.cursor_pointer().hover((x) => x.bg(P.dark2)))
        .tooltip(ok ? `Click: tile ${a.name} beside this pane (Hyprland style) · Right-click: new tab`
          : spec ? `${a.name} is not installed on this computer. INSTALL shows the command for ${SYSTEM_LABEL[SYSTEM()] ?? SYSTEM()} and asks before running it.`
          : `${a.name} is not installed, and there is no verified install command for ${SYSTEM_LABEL[SYSTEM()] ?? SYSTEM()}.`)
        .when(ok, (el) => el.on_click(() => this.launch(a)).on_mouse_down("right", () => this.launch(a, "tab")))
        .child(h_flex().flex_1().min_w(0).gap(9).items_center().when(!ok, (el) => el.opacity(0.5))
          .child(div().w(2).h(20).flex_none().bg(n > 0 ? P.green : "#00000000"))
          .child(programIcon(a, 20, a.color ?? P.text))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().truncate().font_family(MONO).font_weight(800).text_size(11).text_color(ok ? P.text : P.dim).child(String(a.name).toUpperCase()))
            .child(txt(ok ? (n > 0 ? `${two(n)} IN CONTAINMENT` : "READY TO ASSIGN") : "NOT INSTALLED", n > 0 ? P.green : P.dim, 400, 8.5))))
        .when(ok, (el) => el.child(div().flex_none().w(20).h(20).flex().items_center().justify_center().border(1).border_color(P.edge)
          .font_family(MONO).font_weight(800).text_size(12).text_color(P.dim).child("+")))
        .when(Boolean(spec), (el) => el.child(div().id(`dock-install-${a.name}`).flex_none().px(6).py(3).border(1).border_color(P.text).cursor_pointer()
          .hover((x) => x.bg(P.text).text_color(P.dark))
          .tooltip(`Install ${a.name} on ${SYSTEM_LABEL[SYSTEM()] ?? SYSTEM()}: ${spec?.cmd}`)
          .font_family(MONO).font_weight(800).text_size(8.5).text_color(P.text)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.install(a); })
          .child("INSTALL")))
        .when(!ok && !spec, (el) => el.child(txt("NO INSTALLER", P.dim, 400, 8)));
    };
    return v_flex().id("dock").size_full().bg(P.dark)
      .child(h_flex().w_full().h(26).flex_none().px(12).gap(8).items_center().border_b(1).border_color(P.edge)
        .child(txt("AVAILABLE SUBJECTS", P.text, 700, 10.5))
        .child(div().flex_1())
        .child(div().px(5).bg(P.paper).text_color(P.ink).font_family(MONO).font_weight(800).text_size(10).child(two(ready.length))))
      .child(v_flex().id("dock-list").w_full().flex_1().min_h(0).overflow_y_scrollbar()
        .when(this.state === "loading", (el) => el.child(div().p(12).child(txt("SCANNING THE SYSTEM…", P.dim, 400, 10))))
        .when(this.state === "error", (el) => el.child(div().p(12).child(txt("SCAN FAILED. RETRYING SHORTLY.", P.red, 400, 10))))
        .children(ready.map((a) => row(a, true)))
        .children(missing.map((a) => row(a, false))))
      .child(div().w_full().flex_none().px(12).py(6).border_t(1).border_color(P.edge)
        .child(txt("CLICK: TILE · RIGHT-CLICK: NEW TAB", P.dim, 400, 8.5))
        .child(txt(`SYSTEM: ${SYSTEM_LABEL[SYSTEM()] ?? SYSTEM()} · INSTALLERS ARE ASKED BEFORE THEY RUN`, P.dim, 400, 8)));
  }
}

// ---- recent incidents (the last few log entries) -------------------------------

class Incidents {
  render() {
    const log = logOf();
    const last = log.slice(-4).reverse();
    const hhmm = (at) => t12(new Date(at));
    return v_flex().id("incidents").size_full().bg(P.dark).border_b(1).border_color(P.edge)
      .child(h_flex().w_full().h(26).flex_none().px(12).gap(8).items_center().border_b(1).border_color(P.edge)
        .child(txt("RECENT INCIDENTS", P.text, 700, 10.5))
        .child(div().flex_1())
        .child(div().id("inc-all").cursor_pointer().tooltip("Open the Incident Archive").on_click(() => { sfx("tick"); openArchive(); })
          .child(txt(`${two(log.length)} LOGGED \u203a`, P.dim, 700, 9.5))))
      .child(v_flex().flex_1().min_h(0).overflow_hidden().px(12).py(4).gap(2)
        .when(last.length === 0, (el) => el.child(txt("NO INCIDENTS ON RECORD.", P.dim, 400, 10)))
        .children(last.map((e, i) => h_flex().id(`inc-${i}`).w_full().gap(6).items_center().cursor_pointer()
          .on_click(() => { sfx("tick"); openArchive(); })
          .child(txt(hhmm(e.at), P.dim, 400, 9.5))
          .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(9.5).text_color(col(e.color)).child(e.text)))));
  }
}

// ---- site map (one sector per space) -----------------------------------------

const classColor = (name) => ({ APOLLYON: "#ef3b4f", KETER: P.red, EUCLID: P.amber, THAUMIEL: "#8e6bd6", SAFE: P.green }[name]);

// Pane rectangles for a tab of n panes, Hyprland "dwindle" style: the first takes the left half, the next
// the top of the rest, and so on, alternating. Herdr does not expose real split geometry to mods,
// so this matches tiles made with the dock (right, down, right, ...) and approximates other splits.
function dwindle(n, w, h) {
  const out = [];
  let r = { x: 0, y: 0, w, h };
  for (let i = 0; i < n; i++) {
    if (i === n - 1) { out.push(r); break; }
    if (i % 2 === 0) { const a = Math.floor(r.w / 2); out.push({ x: r.x, y: r.y, w: a, h: r.h }); r = { x: r.x + a, y: r.y, w: r.w - a, h: r.h }; }
    else { const a = Math.floor(r.h / 2); out.push({ x: r.x, y: r.y, w: r.w, h: a }); r = { x: r.x, y: r.y + a, w: r.w, h: r.h - a }; }
  }
  return out;
}

class SiteMap {
  render() {
    const list = spaces();
    const all = agents();
    const drill = drilling();
    const cell = (s, i) => {
      const cls = classify(all.filter((a) => a.space === s.id));
      const color = classColor(cls.name) ?? P.dim;
      const hot = cls.name === "KETER" || cls.name === "APOLLYON" || (drill && s.active);
      // a floor plan of the space's shown tab: one tile per pane, laid out as a dwindle tiling
      const tab = s.tabs.find((t) => t.active) ?? s.tabs[0];
      const mine = tab ? panes().filter((p) => p.tab === tab.id) : [];
      const MW = 118, MH = 46;
      const rects = dwindle(mine.length, MW, MH);
      const tileColor = (st) => st === "blocked" ? P.red : st === "working" ? P.amber : st === "done" ? P.green : P.edge;
      const plan = div().relative().w(MW).h(MH).flex_none().bg(P.dark)
        .children(mine.map((p, i) => {
          const r = rects[i];
          const name = String(p.program?.name ?? p.title ?? "pane").toUpperCase();
          return div().id(`sec-${s.id}-${p.pane}`).absolute().left(r.x + 1).top(r.y + 1).w(Math.max(4, r.w - 2)).h(Math.max(4, r.h - 2))
            .flex().items_center().justify_center().bg(P.dark2).border(1).border_color(p.focused && s.active ? P.text : tileColor(p.status))
            .cursor_pointer().hover((x) => x.bg(P.dark))
            .tooltip(`${name} · ${stampOf(p.status).text}`)
            .on_click((_e, cx) => { cx.stop_propagation(); sfx("tick"); run("space.select", { id: s.id }); run("pane.focus", { pane: p.pane }); })
            .when(r.w >= 26 && r.h >= 20, (el) => el.child(programIcon(p.program, 13, p.program?.color ?? P.dim)));
        }));
      return v_flex().id(`sec-${s.id}`).w(130).h(92).flex_none().px(6).py(4).gap(3).cursor_pointer()
        .bg(s.active ? P.dark2 : P.dark).border(1).border_color(s.active ? P.text : P.edge)
        .tooltip(`SECTOR ${two(i + 1)} · ${cls.name} · ${s.name}`)
        .hover((x) => x.bg(P.dark2))
        .on_click(() => { sfx("tick"); run("space.select", { id: s.id }); })
        .child(h_flex().justify_between().items_center()
          .child(txt(`S-${two(i + 1)}`, P.text, 800, 10))
          .child(div().w(7).h(7).flex_none().bg(color).when(hot, (el) => el.loop("opacity", { from: 0.3, to: 1, period: 600 }))))
        .child(plan)
        .child(h_flex().justify_between().items_center()
          .child(txt(cls.name, color, 800, 8.5))
          .child(txt(`${two(mine.length)} PANE${mine.length === 1 ? "" : "S"}${s.tabs.length > 1 ? ` · ${s.tabs.length} TABS` : ""}`, P.dim, 400, 8)));
    };
    return v_flex().id("sitemap").size_full().bg(P.dark)
      .child(h_flex().w_full().h(26).flex_none().px(12).gap(8).items_center().border_b(1).border_color(P.edge)
        .child(txt("SITE MAP · SITE-19", P.text, 700, 10.5))
        .child(div().flex_1())
        .child(txt(`${two(list.length)} SECTORS`, P.dim, 700, 9.5)))
      .child(h_flex().id("sec-grid").w_full().flex_1().min_h(0).p(8).gap(6).flex_wrap().content_start().overflow_y_scrollbar()
        .children(list.map(cell)));
  }
}

// ---- content archives (the SCP wiki, fetched live) ----------------------------

const WIKI_FAV = "scp.wiki.fav";       // saved SCP numbers
const WIKI_RECENT = "scp.wiki.recent"; // last opened, newest first
const RANGES = ["001", "100", "200", "300", "400", "500", "600", "700", "800", "900"];

class Wiki {
  init(_p, cx) {
    this.state = "loading"; this.err = ""; this.index = [];
    this.range = 0; this.q = ""; this.open = null; this.art = null; this.artState = "idle";
    this.classes = {}; // n -> object class of articles read this session
    this.view = 0;     // range index, or "recent" / "fav"
    this.input = InputState.new({ value: "" });
    this.input.on("change", (_e, cx) => { this.q = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async (cx) => {
      try { this.index = await loadIndex(); this.state = "ready"; }
      catch (e) { this.state = "error"; this.err = String(e?.message ?? e); }
      cx.notify();
    });
  }

  favs() { const f = shared(WIKI_FAV); return Array.isArray(f) ? f : []; }
  recent() { const r = shared(WIKI_RECENT); return Array.isArray(r) ? r : []; }

  show(n, cx) {
    setShared(WIKI_RECENT, [n, ...this.recent().filter((x) => x !== n)].slice(0, 12));
    this.open = n; this.art = cachedArticle(n); this.artState = this.art ? "ready" : "loading";
    if (this.art?.cls) this.classes[n] = this.art.cls;
    cx.notify();
    if (this.art) return;
    cx.spawn(async (cx) => {
      try { this.art = await loadArticle(n, { exec, appHome }); this.artState = "ready"; if (this.art.cls) this.classes[n] = this.art.cls; }
      catch (e) { this.artState = "error"; this.err = String(e?.message ?? e); }
      cx.notify();
    });
  }

  chip(name) {
    const up = String(name).toUpperCase();
    const c = onPaper(classColor(up)) ?? P.ink2;
    return div().flex_none().px(5).py(1).border(1).border_color(c).font_family(MONO).font_weight(800).text_size(9.5).text_color(c).child(up);
  }

  btn(id, label, onClick, solid) {
    return div().id(id).flex_none().px(10).py(4).cursor_pointer().hover((s) => s.opacity(0.85))
      .bg(solid ? P.red : P.paper2).text_color(solid ? P.onRed : P.ink).font_family(MONO).font_weight(800).text_size(10)
      .on_click((_e, cx) => { sfx("tick"); onClick(cx); }).child(label);
  }

  renderArticle() {
    const n = this.open;
    const meta = this.index.find((e) => e.n === n);
    const a = this.art;
    const label = (t) => div().font_family(MONO).font_weight(800).text_size(11).text_color(P.ink).child(t);
    const body = (t) => div().font_family(MONO).text_size(12).line_height(1.55).text_color(P.ink).child(t);
    const i = this.index.findIndex((e) => e.n === n);
    const step = (d) => this.index[i + d]?.n;
    return v_flex().flex_1().min_h(0).w_full()
      .child(h_flex().w_full().flex_none().px(18).py(6).gap(6).items_center().bg(P.paper2).border_b(1).border_color(P.rule)
        .child(this.btn("wk-back", "‹ LIST", (cx) => { this.open = null; cx.notify(); }))
        .child(this.btn("wk-prev", "‹ PREV", (cx) => step(-1) && this.show(step(-1), cx)))
        .child(this.btn("wk-next", "NEXT ›", (cx) => step(1) && this.show(step(1), cx)))
        .child(this.btn("wk-fav", this.favs().includes(n) ? "★ SAVED" : "☆ SAVE", (cx) => {
          const f = this.favs();
          setShared(WIKI_FAV, f.includes(n) ? f.filter((x) => x !== n) : [...f, n]);
          cx.notify();
        }))
        .child(div().flex_1())
        .child(this.btn("wk-web", "OPEN ON WIKI", () => openWikiPage(n), true)))
      .child(v_flex().id(`wk-art-${n}-${this.artState}`).flex_1().min_h(0).w_full().overflow_y_scrollbar().px(22).py(14).gap(10)
        .child(div().font_family(MONO).font_weight(800).text_size(15).text_color(P.ink).child(`SCP-${n}${meta ? ` · ${meta.title}` : ""}`))
        .when(this.artState === "loading", (el) => el.child(div().font_family(MONO).text_size(12).text_color(P.ink2)
          .loop("opacity", { from: 0.3, to: 1, period: 900 }).child("RETRIEVING RECORD FROM THE FOUNDATION DATABASE…")))
        .when(this.artState === "error", (el) => el.child(body(`RECORD UNAVAILABLE (${this.err}). USE OPEN ON WIKI.`)))
        .when(this.artState === "ready" && Boolean(a), (el) => {
          // below the needed clearance a section shows as black bars, word for word
          const field = (k, v, need) => {
            if (!v) return [];
            if (level() >= need) return [label(k), body(v)];
            return [label(k), div().id(`wk-red-${k.length}`).cursor_pointer().on_click(() => sfx("denied"))
              .tooltip(`INSUFFICIENT CLEARANCE: LEVEL ${need} REQUIRED`)
              .font_family(MONO).text_size(12).line_height(1.55).text_color(P.ink).child(v.replace(/\S/g, "█")),
              txt(`CLEARANCE LEVEL ${need} REQUIRED`, P.red, 800, 10)];
          };
          const missing = !a.cls && !a.procedures && !a.description;
          return el
            .child(v_flex().gap(6)
              .child(h_flex().gap(8).items_center().child(label("Item #:")).child(div().font_family(MONO).font_weight(800).text_size(14).text_color(P.ink).child(a.item ?? `SCP-${n}`))
                .when(Boolean(a.rating), (r) => r.child(div().flex_1()).child(txt(`RATING ${a.rating}`, P.ink2, 700, 10))))
              .when(Boolean(a.cls), (r) => r.child(h_flex().gap(8).items_center().child(label("Object Class:"))
                .child(div().flex_none().px(8).py(2).bg(onPaper(classColor(String(a.cls).toUpperCase())) ?? P.ink2)
                  .font_family(MONO).font_weight(800).text_size(12).text_color(P.paper).child(String(a.cls).toUpperCase())))))
            .child(div().w_full().h(1).bg(P.rule))
            .when(missing, (r) => r.child(body("THIS RECORD HAS NO STANDARD FIELDS (A TALE, A HUB OR A NON-STANDARD FORMAT). USE OPEN ON WIKI.")))
            .children((a.pics ?? []).map((pic, k) => v_flex().id(`wk-pic-${k}`).w_full().gap(3).items_start()
              .child(image(pic.path).w(300).flex_none())
              .when(Boolean(pic.caption), (r) => r.child(div().max_w(300).font_family(MONO).text_size(9.5).text_color(P.ink2).child(pic.caption)))))
            .children(field("Special Containment Procedures:", a.procedures, 2))
            .children(field("Description:", a.description, 3));
        })
        .child(div().w_full().h(1).bg(P.rule))
        .child(div().font_family(MONO).text_size(9.5).line_height(1.4).text_color(P.ink2)
          .child(`Source: scp-wiki.wikidot.com/scp-${n} · CC BY-SA 3.0 · authorship is listed on that page.`)));
  }

  renderList() {
    const q = this.q;
    const pick = (list) => list.map((n) => this.index.find((e) => e.n === n)).filter(Boolean);
    const rows = q
      ? this.index.filter((e) => `scp-${e.n} ${e.title}`.toLowerCase().includes(q)).slice(0, 200)
      : this.view === "recent" ? pick(this.recent())
      : this.view === "fav" ? pick(this.favs())
      : this.index.filter((e) => Math.floor(Number(e.n) / 100) === this.view);
    const tab = (r, i) => div().id(`wk-r-${i}`).flex_none().px(7).py(3).cursor_pointer()
      .bg(!q && this.view === i ? P.ink : P.paper2).text_color(!q && this.view === i ? P.paper : P.ink)
      .font_family(MONO).font_weight(800).text_size(9.5)
      .on_click((_e, cx) => { sfx("tick"); this.view = i; cx.notify(); }).child(r);
    const row = (e) => h_flex().id(`wk-${e.n}`).w_full().flex_none().px(18).py(5).gap(10).items_center().cursor_pointer()
      .border_b(1).border_color(P.rule).hover((s) => s.bg(P.paper2)).on_click((_e, cx) => { sfx("tick"); this.show(e.n, cx); })
      .child(div().flex_none().w(66).font_family(MONO).font_weight(800).text_size(11.5).text_color(P.ink).child(`SCP-${e.n}`))
      .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11.5).text_color(P.ink2).child(e.title))
      .when(Boolean(this.classes[e.n]), (r) => r.child(this.chip(this.classes[e.n])));
    return v_flex().flex_1().min_h(0).w_full()
      .child(h_flex().w_full().flex_none().px(18).py(6).gap(6).items_center().flex_wrap().bg(P.paper2).border_b(1).border_color(P.rule)
        .children(RANGES.map(tab))
        .child(div().w(8).flex_none())
        .child(tab("RECENT", "recent")).child(tab("★ SAVED", "fav")))
      .child(h_flex().w_full().flex_none().px(18).py(6).gap(8).items_center().border_b(1).border_color(P.rule)
        .child(txt("FILTER", P.ink2, 800, 10))
        .child(div().flex_1().min_w(0).child(Input.new(this.input).h(24).px(8).border_1().border_color(P.ink).bg(P.paper).text_size(12).text_color(P.ink)))
        .child(txt(`${rows.length}${q && rows.length === 200 ? "+" : ""} FOUND`, P.ink2, 700, 9.5)))
      .child(v_flex().id("wk-list").flex_1().min_h(0).w_full().overflow_y_scrollbar()
        .children(rows.map(row))
        .when(rows.length === 0, (el) => el.child(div().p(18).font_family(MONO).text_size(12).text_color(P.ink2).child(this.view === "fav" && !q ? "NOTHING SAVED YET. OPEN A RECORD AND USE ☆ SAVE." : this.view === "recent" && !q ? "NO RECORDS OPENED YET." : "NO RECORDS MATCH.")))
        .child(div().p(14).font_family(MONO).text_size(9.5).line_height(1.4).text_color(P.ink2)
          .child("Records are fetched live from the SCP Wiki (scp-wiki.wikidot.com) and cached on this computer. CC BY-SA 3.0.")));
  }

  render() {
    const sub = this.state === "ready" ? `SCP WIKI · SERIES 1 · ${this.index.length} RECORDS · LIVE` : "SCP WIKI · CONTACTING DATABASE";
    return sheet()
      .child(windowBar("CONTENT ARCHIVES", sub))
      .when(this.state === "loading", (el) => el.child(div().p(18).font_family(MONO).text_size(12).text_color(P.ink2)
        .loop("opacity", { from: 0.3, to: 1, period: 900 }).child("RETRIEVING THE ARCHIVE INDEX…")))
      .when(this.state === "error", (el) => el.child(v_flex().p(18).gap(10)
        .child(div().font_family(MONO).text_size(12).text_color(P.ink).child(`ARCHIVE UNREACHABLE (${this.err}). CHECK THE CONNECTION.`))
        .child(this.btn("wk-retry", "RETRY", (cx) => {
          this.state = "loading"; cx.notify();
          cx.spawn(async (cx) => { try { this.index = await loadIndex(); this.state = "ready"; } catch (e) { this.state = "error"; this.err = String(e?.message ?? e); } cx.notify(); });
        }, true))))
      .when(this.state === "ready", (el) => el.child(this.open ? this.renderArticle() : this.renderList()));
  }
}

// ---- department picker ---------------------------------------------------------

class DeptPicker {
  render() {
    const cur = deptIdx();
    return sheet()
      .child(windowBar("DEPARTMENT", "SELECT YOUR AFFILIATION · RECOLOURS THE WHOLE UI"))
      .child(v_flex().id("dp-list").flex_1().min_h(0).w_full().overflow_y_scrollbar()
        .children(DEPTS.map((d, i) => h_flex().id(`dp-${i}`).w_full().flex_none().h(34).px(18).gap(12).items_center().cursor_pointer()
          .border_b(1).border_color(P.rule).bg(i === cur ? P.paper2 : P.paper).hover((x) => x.bg(P.paper2))
          .on_click(() => { sfx("tick"); setDept(i); closeOverlay(props()?.overlay); })
          .child(div().w(14).h(14).flex_none().bg(d.pal.red).border(1).border_color(P.ink))
          .child(div().w(14).h(14).flex_none().bg(d.pal.paper).border(1).border_color(P.ink))
          .child(div().flex_1().min_w(0).truncate().font_family(MONO).font_weight(i === cur ? 800 : 600).text_size(12).text_color(P.ink).child(d.label))
          .when(i === cur, (el) => el.child(txt("CURRENT", P.red, 800, 9.5))))));
  }
}

// ---- options ------------------------------------------------------------------

const OPTION_ROWS = [
  ["sounds", "SOUNDS", "Alarms, stamps, keycard and the per-department tones"],
  ["login", "KEYCARD LOGIN", "The typed boot screen, at most once per 30 minutes"],
  ["stamps", "DATA EXPUNGED STAMPS", "Floating stamps over idle panes"],
  ["notices", "ROTATING NOTICES", "Footer notices; off shows the department motto"],
  ["lockdown", "LOCKDOWN MODE", "The whole UI turns red while any subject is in breach"],
  ["compact", "COMPACT LAYOUT", "Shorter header, no incident list, tighter site rows"],
  ["paper", "PAPER TERMINAL", "A light, document-style look: switches Herdr's appearance to light (settings.json)"],
];

class Options {
  render() {
    const o = opts();
    const row = ([key, label, desc]) => h_flex().id(`op-${key}`).w_full().flex_none().px(20).py(10).gap(12).items_center().cursor_pointer()
      .border_b(1).border_color(P.rule).hover((x) => x.bg(P.paper2))
      .on_click(() => { sfx("tick"); setOpt(key, !o[key]); })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().font_family(MONO).font_weight(800).text_size(12).text_color(P.ink).child(label))
        .child(div().font_family(MONO).text_size(10).text_color(P.ink2).child(desc)))
      .child(div().flex_none().w(46).py(3).flex().items_center().justify_center().border(1).border_color(P.ink)
        .bg(o[key] ? P.ink : P.paper).font_family(MONO).font_weight(800).text_size(10).text_color(o[key] ? P.paper : P.ink)
        .child(o[key] ? "ON" : "OFF"));
    const link = (id, text, onClick) => div().id(id).px(10).py(5).cursor_pointer().bg(P.ink).text_color(P.paper)
      .font_family(MONO).font_weight(800).text_size(10).hover((x) => x.opacity(0.85))
      .on_click(() => { sfx("tick"); onClick(); }).child(text);
    return sheet()
      .child(windowBar("OPTIONS", `${DEPTS[deptIdx()].label} · CLEARANCE LEVEL ${level()}`))
      .child(v_flex().id("op-list").flex_1().min_h(0).w_full().overflow_y_scrollbar().children(OPTION_ROWS.map(row)))
      .child(h_flex().w_full().flex_none().px(20).py(10).gap(8).items_center().bg(P.paper2).border_t(1).border_color(P.rule)
        .child(link("op-dept", "DEPARTMENT ›", () => openDeptPicker()))
        .child(link("op-herdr", "HERDR SETTINGS ›", () => run("app.settings")))
        .child(div().flex_1())
        .child(txt("CTRL+ALT+O", P.ink2, 700, 9.5)));
  }
}

// ---- login screen ------------------------------------------------------------

// A terminal boot sequence typed in line by line; Enter, a click or 5 seconds later dismisses it.
const BAD = "#ff4d4d"; // failure red, the same in every department

// A different, believable bypass command each time: a real-looking tool, target, token and flags.
// Only plain lowercase letters, digits and a few symbols, so it is easy to type exactly.
function bypassCommand() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const tool = pick(["bypass", "override", "unlock", "authkill", "keyforge"]);
  const target = pick(["auth.d", "keycard.sys", "door-ctl", "site19-gate", "badge-svc"]);
  const tok = `${hex(4)}-${hex(4)}`;
  const lvl = pick([3, 4, 5]);
  return pick([
    `sudo ./${tool} --target ${target} --token ${tok} --force`,
    `./${tool} -t ${target} --clearance=${lvl} --no-trace`,
    `sudo ./${tool} --keycard spoof --token ${tok} --level ${lvl}`,
    `./${tool} --inject ${target} --key ${tok} --silent`,
  ]);
}

class Login {
  init(_p, cx) {
    const force = (props() ?? {}).force;
    this.fail = force ? force === "fail" : Math.random() < 0.1; // one login in ten fails
    this.lines = [];   // what is on screen
    this.q = [];       // steps still to play
    this.cur = null;   // the step being typed or spun
    this.wait = 0;     // ms before the next step
    this.phase = "login"; // login | bypass | hack | done
    this.attempts = 0;
    this.closeAt = 0;
    this.command = bypassCommand();
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = InputState.new({ value: "" });
    this.input.on("submit", (_e, cx) => this.submit(cx));

    const pt = (t, c, w, sz) => ({ t, c, w, s: sz });
    this.pt = pt;
    const L = (parts, wait = 250, extra = {}) => ({ kind: "line", parts, wait, ...extra });
    const T = (prompt, text, { mask = false, cps = 11, wait = 300 } = {}) => ({ kind: "type", prompt, text, mask, cps, wait });
    const S = (label, ms, after, wait = 200) => ({ kind: "spin", label, ms, after, wait });
    const F = (fn, wait = 0) => ({ kind: "fn", fn, wait });
    this.mk = { L, T, S, F };

    this.q = [
      L([pt("FOUNDATION SECURE TERMINAL · BUILD 4.2.1", P.dim)], 150),
      L([pt("SITE-19 ACCESS NODE · AUTHORIZED PERSONNEL ONLY", P.dim)], 250),
      T("login:", "researcher", { cps: 16, wait: 300 }),
      T("password:", "************", { mask: true, cps: 22, wait: 180 }),
      S("AUTHENTICATING", 1100, null),
      F(() => this.verdict()),
    ];
    cx.timer.every(50, (cx) => this.tick(cx));
  }

  close() { closeOverlay(props()?.overlay); }

  trim() { if (this.lines.length > 13) this.lines.splice(0, this.lines.length - 13); } // the console scrolls

  // plays the queued steps: lines appear, text types itself, spinners spin
  tick(cx) {
    const now = Date.now();
    const dt = Math.min(400, now - (this.last ?? now)); // real elapsed time: the timer may run slower than asked
    this.last = now;
    if (this.closeAt && now > this.closeAt) return this.close();
    const c = this.cur;
    if (c) {
      if (c.kind === "type") {
        c.acc += (c.cps * dt) / 1000;
        const n = Math.min(c.text.length, Math.floor(c.acc));
        if (n !== c.line.text.length) { c.line.text = c.text.slice(0, n); if (n % 3 === 0) sfx("tick"); cx.notify(); }
        if (n >= c.text.length) { c.line.typing = false; this.cur = null; cx.notify(); }
      } else if (c.kind === "spin") {
        c.left -= dt;
        if (c.left <= 0) { c.line.spin = false; if (c.after) c.line.parts = [...c.line.parts, ...c.after]; this.cur = null; cx.notify(); }
      }
      return;
    }
    if (this.wait > 0) { this.wait -= dt; return; }
    const st = this.q.shift();
    if (!st) return;
    this.wait = st.wait ?? 0;
    if (st.kind === "line") { this.lines.push({ parts: st.parts, custom: st.custom, blink: st.blink }); }
    else if (st.kind === "type") {
      const line = { prompt: st.prompt, text: "", mask: st.mask, typing: true, parts: [] };
      this.lines.push(line); this.cur = { kind: "type", line, text: st.text, cps: st.cps, acc: 0 };
    } else if (st.kind === "spin") {
      const line = { parts: [this.pt(st.label, P.text)], spin: true };
      this.lines.push(line); this.spinLine = line; this.cur = { kind: "spin", line, left: st.ms, after: st.after };
    } else if (st.kind === "fn") st.fn();
    this.trim();
    cx.notify();
  }

  // the login has been "checked": one time in ten it fails and needs a manual bypass
  verdict() {
    const { L, S, F } = this.mk; const pt = this.pt;
    if (this.fail) {
      this.spinLine.parts = [pt("AUTHENTICATING", P.text), pt("[ FAILED ]", BAD, 800)];
      sfx("denied");
      this.q.push(
        L([pt("KEYCARD HASH MISMATCH · ERROR 0x7E3 · TRACE INITIATED", BAD, 700)], 300),
        L([pt("ACCESS DENIED", BAD, 800, 22)], 400, { blink: true }),
        L([pt("AUTOMATED LOGIN HAS FAILED. MANUAL OVERRIDE REQUIRED.", P.amber, 700)], 800),
        L([pt("A HUMAN MUST BREAK IN. TYPE THIS COMMAND EXACTLY:", P.dim)], 500),
        L([pt("$", P.dim), pt(this.command, P.amber, 800, 13)], 300),
        F(() => { this.phase = "bypass"; this.input.focus(); }),
      );
    } else {
      this.spinLine.parts = [pt("AUTHENTICATING", P.text), pt("[ OK ]", P.green, 800)];
      this.q.push(...this.successSteps());
    }
  }

  successSteps(label) {
    const { L, F } = this.mk; const pt = this.pt;
    const space = () => spaces().find((s) => s.active);
    const bar = (id, t) => redact(id, t, { bg: P.bar, reveal: P.text, size: 11, need: 3 });
    const row = (...kids) => h_flex().gap(8).items_center().children(kids);
    return [
      // the keycard slides through the reader, then the line resolves
      L([], 300, { custom: () => row(txt("KEYCARD SCAN", P.text, 400, 12),
        div().relative().w(150).h(14).flex_none().bg(P.dark).border(1).border_color(P.edge).overflow_hidden()
          .child(div().absolute().top(2).left(0).w(34).h(8).bg(P.text).loop("left", { from: 0, to: 112, period: 900 })),
        txt(`[ ACCESS GRANTED: LEVEL ${level()} ]`, P.green, 800, 12)) }),
      L([], 300, { custom: () => row(txt("IDENTITY: RESEARCHER", P.text, 400, 12), bar("l-id", "████████")) }),
      L([], 300, { custom: () => row(txt(`CLEARANCE: LEVEL ${level()}`, P.text, 400, 12), txt(level() >= 3 ? "[ GRANTED ]" : "[ RESTRICTED ]", level() >= 3 ? P.green : P.amber, 800, 12)) }),
      L([], 300, { custom: () => row(txt("SITE:", P.text, 400, 12), bar("l-site", space()?.name), txt(`· ${space()?.tabs.length ?? 0} TEST CELLS`, P.dim, 400, 12)) }),
      L([pt("ALL ACTIVITY ON THIS TERMINAL IS MONITORED.", P.dim)], 350),
      L([pt(label ?? "WELCOME, RESEARCHER.", P.text, 800, 15)], 300),
      F(() => { this.phase = "done"; sfx("login"); this.closeAt = Date.now() + 5000; }),
    ];
  }

  // the typed bypass command: right, and the "hack" plays; wrong three times, and safe mode lets you in
  submit(cx) {
    if (this.phase !== "bypass") return;
    const { L, S, F } = this.mk; const pt = this.pt;
    const norm = (t) => String(t).trim().replace(/\s+/g, " ").toLowerCase();
    const typed = this.input.value();
    this.lines.push({ parts: [pt("root@site-19:~#", P.dim, 700), pt(typed, P.text)] });
    this.input.set_value("");
    if (norm(typed) === norm(this.command)) {
      this.phase = "hack"; sfx("tick"); this.handle.focus();
      this.lines = [{ parts: [pt("root@site-19:~#", P.dim, 700), pt(typed, P.text)] }]; // clear the screen
      this.q.push(
        S("[+] RESOLVING KEYCARD VALIDATOR", 600, [pt("done", P.green, 800)]),
        S("[+] INJECTING PAYLOAD INTO AUTH DAEMON", 800, [pt("done", P.green, 800)]),
        S("[+] SPOOFING CLEARANCE → LEVEL 5", 650, [pt("done", P.green, 800)]),
        L([pt("[+] ROOT SHELL ACQUIRED", P.green, 800)], 300),
        L([pt("ACCESS GRANTED · OVERRIDE ACCEPTED", P.green, 800, 16)], 400),
        F(() => { this.phase = "done"; sfx("login"); this.closeAt = Date.now() + 3500; }),
      );
    } else {
      this.attempts += 1;
      sfx("denied");
      if (this.attempts >= 3) {
        this.phase = "hack"; this.handle.focus();
        this.lines = [{ parts: [pt("TRACE COMPLETE. FALLING BACK TO SAFE MODE.", P.amber, 800)] }];
        this.q.push(
          S("[!] SWITCHING TO SAFE MODE", 900, [pt("done", P.amber, 800)]),
          L([pt("ACCESS GRANTED · SAFE MODE", P.green, 800, 16)], 400),
          F(() => { this.phase = "done"; sfx("login"); this.closeAt = Date.now() + 3500; }),
        );
      } else {
        this.lines.push({ parts: [pt(`COMMAND NOT RECOGNIZED (${this.attempts}/3) · TRACE ${this.attempts * 33}%`, BAD, 700)] });
      }
    }
    this.trim();
    cx.notify();
  }

  render() {
    const line = (l, i) => l.custom ? div().id(`ll-${i}`).child(l.custom())
      : h_flex().id(`ll-${i}`).gap(7).items_center().flex_wrap()
        .when(l.blink, (el) => el.loop("opacity", { from: 0.4, to: 1, period: 600 }))
        .when(Boolean(l.prompt), (el) => el.child(txt(l.prompt, P.dim, 400, 12)))
        .when(l.typing || l.text, (el) => el.child(txt(l.mask ? "*".repeat(l.text.length) : l.text, P.text, 700, 12)))
        .when(l.typing, (el) => el.child(div().w(7).h(14).flex_none().bg(P.text).loop("opacity", { from: 0, to: 1, period: 500 })))
        .children((l.parts ?? []).map((q) => txt(q.t, q.c ?? P.text, q.w ?? 400, q.s ?? 12)))
        .when(l.spin, (el) => el.child(div().font_family(MONO).text_size(12).text_color(P.amber).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)));

    return v_flex().id("login").size_full().bg("#080909").border(2).border_color(this.fail && this.phase !== "done" && this.lines.length > 6 ? P.red : P.red).overflow_hidden()
      .track_focus(this.handle)
      .on_click(() => { if (this.phase === "done") this.close(); })
      .on_key_down((e, cx) => {
        if (e.key === "escape" || (e.key === "enter" && this.phase === "done")) { this.close(); cx.stop_propagation(); }
      })
      .child(h_flex().w_full().h(40).flex_none().items_center().bg(P.dark)
        .child(div().w(8).h_full().flex_none().bg(P.red))
        .child(v_flex().px(12)
          .child(txt(`${org()} · SECURE ACCESS`, P.text, 800, 13))
          .child(txt("Authorized personnel only", P.dim, 400, 9.5))))
      .child(v_flex().id("login-lines").flex_1().min_h(0).px(22).py(16).gap(7).overflow_hidden().children(this.lines.map(line))
        .when(this.phase === "bypass", (el) => el.child(h_flex().gap(8).items_center().mt(4)
          .child(txt("root@site-19:~#", P.dim, 700, 12))
          .child(div().flex_1().min_w(0).child(Input.new(this.input).h(26).px(8).bg(P.dark).border_1().border_color(P.red).text_size(12).text_color(P.text))))))
      .child(h_flex().w_full().flex_none().px(22).pb(12).gap(10).items_center().justify_end()
        .when(this.phase === "done", (el) => el.child(txt("PRESS ENTER TO CONTINUE", P.red, 800, 10.5).loop("opacity", { from: 0.35, to: 1, period: 900 }))));
  }
}

// ---- roles -------------------------------------------------------------------

const ROLES = { header: Header, footer: Footer, pane: PaneHeader, personnel: Personnel, stamp: Stamps, terminate: Terminate, archive: Archive, article: Article, login: Login, dossier: Dossier, sitemap: SiteMap, machines: Machines, actions: Actions, incidents: Incidents, wiki: Wiki, dock: Dock, dept: DeptPicker, options: Options };

export default class Scp extends View {
  init(p, cx) {
    applyDept();
    const pr = props() ?? p ?? {};
    const R = ROLES[pr.role];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }
  render(cx) {
    applyDept();
    return this.role ? this.role.render(cx) : div().child(`scp: no role "${props()?.role}"`);
  }
}
