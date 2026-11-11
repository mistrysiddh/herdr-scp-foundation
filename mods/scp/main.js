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
  exec, appHome, writeTextFile, notify, hc, knownAgents,
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
  { label: "O5 COUNCIL", theme: "scp-o5", pal: { red: "#d9a21b", onRed: "#120f05", paper: "#14120a", paper2: "#1f1c10", ink: "#e8d9a0", ink2: "#a89a62", rule: "#4a4122", black: "#2e2814", darkPaper: true } },
];
// Called at the start of every render and init so each role paints with the current department.
function applyDept() {
  Object.assign(P, DEPTS[deptIdx()].pal);
}
// Blend two #rrggbb colours (t = share of `a`), for accent-tinted dark backgrounds.
function mix(a, b, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}
const deptIdx = () => Math.min(DEPTS.length - 1, Math.max(0, Math.round(Number(shared(DEPT_KEY)) || 0)));
const cycleDept = () => {
  const n = (deptIdx() + 1) % DEPTS.length;
  setShared(DEPT_KEY, n);
  run("app.theme", { name: DEPTS[n].theme });
};
const drilling = () => { const t = Number(shared(DRILL_KEY)) || 0; return t > 0 && Date.now() - t < DRILL_MS; };
const seenOf = () => (shared(SEEN_KEY) && typeof shared(SEEN_KEY) === "object" ? shared(SEEN_KEY) : {});

// ---- sound -------------------------------------------------------------------

function sfx(name) {
  if (settings()?.sounds?.enabled === false) return;
  try { playSound(`mods/scp/sounds/${name}.mp3`); } catch (e) { console.log(`scp: sound ${name}: ${e}`); }
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

function openLogin() {
  openOverlay({ mod: "scp", kind: "dialog", modal: true, frame: "none", width: 540, height: 318, props: { role: "login" } });
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
    const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
    const stardate = `SITE-19 · DAY ${String(day).padStart(3, "0")}`;
    const L = level();

    const brand = h_flex().gap(10).items_center().flex_none()
      .child(svg("mods/scp/emblem.svg").size(42).flex_none().text_color(P.ink)) // tinted, so it reads on dark paper too
      .child(v_flex()
        .child(div().font_family(MONO).font_weight(800).text_size(19).text_color(P.ink).child("SCP FOUNDATION"))
        .child(div().font_family(MONO).text_size(9.5).text_color(P.ink2).child("SECURE · CONTAIN · PROTECT")));

    const sep = () => div().w(1).h(34).flex_none().bg(P.rule);

    const fields = h_flex().gap(26).items_center().min_w(0)
      .child(field("ITEM #", div().id("item-no").cursor_pointer().font_family(MONO).font_weight(800).text_size(15).text_color(P.ink)
        .tooltip("Open the Special Containment Procedures for this site (Ctrl+Alt+P)")
        .hover((x) => x.text_color(P.red))
        .on_mouse_down("left", stop).on_click(() => { sfx("tick"); openArticle(); })
        .child(item)))
      .child(field("OBJECT CLASS", div().font_family(MONO).font_weight(800).text_size(15).text_color(cls.color).child(cls.name)))
      .child(field("CONTAINMENT SITE", redact("r-site", space?.name, { size: 14, need: 3 })))
      .child(field("SPECIAL PROCEDURE", redact("r-test", test ? `TEST ${two(test.index)}` : "", { size: 14, need: 3 })));

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
      .tooltip("Click to switch department: Foundation, MTF, Ethics, O5 (Ctrl+Alt+T). Changes the terminal theme.")
      .hover((s) => s.bg(P.paper2))
      .on_mouse_down("left", stop).on_click(() => { sfx("tick"); cycleDept(); })
      .child(`DEPT: ${DEPTS[deptIdx()].label}`);

    const btn = (id, name, cmd, danger) => div().id(id).w(42).h_full().flex_none().flex().items_center().justify_center()
      .hover((s) => s.bg(danger ? P.red : P.paper2))
      .on_mouse_down("left", stop).on_click(() => run(cmd))
      .child(svg(`mods/scp/icons/${name}.svg`).size(14).flex_none().text_color(P.ink));
    const settingsBtn = btn("w-set", "settings", "app.settings", false).tooltip("Settings: theme, fonts, sounds, machines");
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
          .child(div().font_family(MONO).text_size(9).text_color(P.ink2).child(stardate))))
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
    this.prev = null;      // address -> status, from the last render
    this.incident = null;  // { text, color, at }
    this.notice = Math.floor(Math.random() * NOTICES.length); // which notice shows
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
    if (Date.now() - (Number(shared(LOGIN_KEY)) || 0) > 30 * 60 * 1000) {
      setShared(LOGIN_KEY, Date.now());
      cx.timer.after(900, () => openLogin());
    }
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
          else if (c === "drill") this.startDrill();
          else if (c === "report") this.exportReport();
          else if (c === "dossier") openDossier(agents()[0]?.address ?? "none");
          else if (c === "dept") { sfx("tick"); cycleDept(); }
        } catch (e) { console.log(`scp: ${c} failed: ${e}`); }
        cx.notify();
      }
    });
    // rotate notices only while they are on screen (no incident), to keep redraws rare
    cx.timer.every(NOTICE_MS, (cx) => {
      if (this.incident) return;
      this.notice = (this.notice + 1) % NOTICES.length;
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
      "SCP FOUNDATION", "INCIDENT REPORT · FOUNDATION EYES ONLY",
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
      .child(txt(`CLEARANCE LEVEL ${level()} · FOUNDATION EYES ONLY`, P.red))
      .child(div().flex_none().px(6).py(1).bg(cls.color).font_family(MONO).font_weight(800).text_size(10).text_color(P.darkPaper ? "#120f05" : "#ffffff")
        .tooltip("Object class of the shown site").child(cls.name))
      .when(Boolean(site?.branch), (el) => el.child(h_flex().flex_none().max_w(180).px(6).py(1).gap(5).items_center().border(1).border_color(P.edge)
        .tooltip(`Branch of the shown site${site?.machine ? ` on ${site.machine}` : ""}`)
        .child(svg("mods/workspace-chrome/branch.svg").size(11).flex_none().text_color(P.text))
        .child(div().min_w(0).truncate().font_family(MONO).font_weight(700).text_size(10).text_color(P.text).child(site.branch))))
      .child(txt("//"))
      .when(Boolean(inc), (el) => el.child(div().flex_1().min_w(0).truncate().font_family(MONO).font_weight(700).text_size(10.5).text_color(col(inc.color)).child(inc.text)))
      .when(!inc, (el) => el.child(h_flex().id("notice").flex_1().min_w(0).gap(8).items_center().overflow_hidden()
        .children(NOTICES[this.notice % NOTICES.length].map((part, i) =>
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
  render() {
    const all = panes();
    const idle = all.map((p, i) => ({ p, i })).filter(({ p }) => p.terminal && p.status === "idle" && !p.focused).slice(0, 4);
    // a stamp thump when a new one lands (render only plays a sound, it never notifies)
    const ids = new Set(idle.map(({ p }) => p.pane));
    if (this.seen && idle.some(({ p }) => !this.seen.has(p.pane))) sfx("stamp");
    this.seen = ids;
    if (!idle.length) return div();
    return v_flex().gap(6).p(6)
      .children(idle.map(({ p, i }) => div().id(`st-${p.pane}`).px(10).py(5).border(2).border_color(P.red).bg(mix(P.red, "#0c0d0d", 0.12))
        .cursor_pointer().on_click(() => run("pane.focus", { pane: p.pane }))
        .tooltip("Idle subject: click to focus")
        .loop("opacity", { from: 0.55, to: 1, period: 2400 })
        .font_family(MONO).font_weight(800).text_size(12).text_color(P.red)
        .child(`DOC-${String(i + 1).padStart(3, "0")} · [DATA EXPUNGED]`)));
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
const clock3 = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };

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
      .child(windowBar("SPECIAL CONTAINMENT PROCEDURES", `${item} · FOUNDATION EYES ONLY`))
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
      .child(windowBar("PERSONNEL FILE", `SUBJECT-${String(address).toUpperCase()} · FOUNDATION EYES ONLY`))
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

  render() {
    const all = agents();
    const ready = this.list.filter((a) => a.installed && a.run);
    const missing = this.list.filter((a) => !(a.installed && a.run));
    const running = (a) => all.filter((x) => String(x.program?.name ?? "").toLowerCase() === String(a.name).toLowerCase()).length;
    const row = (a, ok) => {
      const n = running(a);
      return h_flex().id(`dock-${a.name}`).w_full().flex_none().h(40).px(10).gap(9).items_center()
        .border_b(1).border_color(P.edge).when(ok, (el) => el.cursor_pointer().hover((x) => x.bg(P.dark2)))
        .when(!ok, (el) => el.opacity(0.45))
        .tooltip(ok ? `Click: tile ${a.name} beside this pane (Hyprland style) · Right-click: new tab` : `${a.name} is not installed on this computer`)
        .when(ok, (el) => el.on_click(() => this.launch(a)).on_mouse_down("right", () => this.launch(a, "tab")))
        .child(div().w(2).h(20).flex_none().bg(n > 0 ? P.green : "#00000000"))
        .child(programIcon(a, 20, a.color ?? P.text))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().font_family(MONO).font_weight(800).text_size(11).text_color(ok ? P.text : P.dim).child(String(a.name).toUpperCase()))
          .child(txt(ok ? (n > 0 ? `${two(n)} IN CONTAINMENT` : "READY TO ASSIGN") : "NOT INSTALLED", n > 0 ? P.green : P.dim, 400, 8.5)))
        .when(ok, (el) => el.child(div().flex_none().w(20).h(20).flex().items_center().justify_center().border(1).border_color(P.edge)
          .font_family(MONO).font_weight(800).text_size(12).text_color(P.dim).child("+")));
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
        .child(txt("CLICK: TILE · RIGHT-CLICK: NEW TAB", P.dim, 400, 8.5)));
  }
}

// ---- recent incidents (the last few log entries) -------------------------------

class Incidents {
  render() {
    const log = logOf();
    const last = log.slice(-4).reverse();
    const hhmm = (at) => { const d = new Date(at); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
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
      const plan = div().relative().w(MW).h(MH).flex_none().bg("#090a0a")
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
        .bg(s.active ? P.dark2 : "#0e1010").border(1).border_color(s.active ? P.text : P.edge)
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

// ---- login screen ------------------------------------------------------------

// A terminal boot sequence typed in line by line; Enter, a click or 5 seconds later dismisses it.
class Login {
  init(_p, cx) {
    this.shown = 0;
    this.total = 8;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.doneAt = 0;
    cx.timer.every(430, (cx) => {
      if (this.shown >= this.total) {
        if (this.doneAt && Date.now() - this.doneAt > 5000) this.close();
        return;
      }
      this.shown += 1;
      sfx(this.shown === this.total ? "login" : "tick");
      if (this.shown === this.total) this.doneAt = Date.now();
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  render() {
    const space = spaces().find((s) => s.active);
    const tests = space?.tabs.length ?? 0;
    const L = level();
    const ok = (t, c = P.green) => txt(t, c, 800, 11);
    const bar = (id, t) => redact(id, t, { bg: P.bar, reveal: P.text, size: 11, need: 3 });
    const row = (...kids) => h_flex().gap(8).items_center().children(kids);

    const lines = [
      row(txt("FOUNDATION SECURE TERMINAL · BUILD 4.2.1", P.dim, 400, 11)),
      row(txt("AUTHENTICATING…", P.text, 400, 11), ok("[ OK ]")),
      // the keycard slides through the reader, then the line resolves
      row(txt("KEYCARD SCAN", P.text, 400, 11),
        div().relative().w(150).h(14).flex_none().bg("#0e1010").border(1).border_color(P.edge).overflow_hidden()
          .child(div().absolute().top(2).left(0).w(34).h(8).bg(P.paper).loop("left", { from: 0, to: 112, period: 900 })),
        ok(`[ ACCESS GRANTED: LEVEL ${L} ]`)),
      row(txt("IDENTITY: RESEARCHER", P.text, 400, 11), bar("l-id", "████████")),
      row(txt(`CLEARANCE: LEVEL ${L}`, P.text, 400, 11), ok(L >= 3 ? "[ GRANTED ]" : "[ RESTRICTED ]", L >= 3 ? P.green : P.amber)),
      row(txt("SITE:", P.text, 400, 11), bar("l-site", space?.name), txt(`· ${tests} TEST ${tests === 1 ? "CELL" : "CELLS"}`, P.dim, 400, 11)),
      row(txt("ALL ACTIVITY ON THIS TERMINAL IS MONITORED.", P.dim, 400, 11)),
      row(txt("WELCOME, RESEARCHER.", P.paper, 800, 13)),
    ];

    return v_flex().id("login").size_full().bg("#080909").border(2).border_color(P.red).overflow_hidden()
      .track_focus(this.handle)
      .on_click(() => this.close())
      .on_key_down((e, cx) => {
        if (e.key === "enter" || e.key === "escape") { this.close(); cx.stop_propagation(); }
      })
      .child(h_flex().w_full().h(40).flex_none().items_center().bg(P.dark)
        .child(div().w(8).h_full().flex_none().bg(P.red))
        .child(v_flex().px(12)
          .child(txt("SCP FOUNDATION · SECURE ACCESS", P.text, 800, 13))
          .child(txt("Authorized personnel only", P.dim, 400, 9.5))))
      .child(v_flex().flex_1().px(22).py(18).gap(9).children(lines.slice(0, this.shown)))
      .child(h_flex().w_full().flex_none().px(22).pb(14).justify_end()
        .when(this.shown >= this.total, (el) => el.child(txt("PRESS ENTER TO CONTINUE", P.red, 800, 10.5)
          .loop("opacity", { from: 0.35, to: 1, period: 900 }))));
  }
}

// ---- roles -------------------------------------------------------------------

const ROLES = { header: Header, footer: Footer, pane: PaneHeader, personnel: Personnel, stamp: Stamps, terminate: Terminate, archive: Archive, article: Article, login: Login, dossier: Dossier, sitemap: SiteMap, machines: Machines, actions: Actions, incidents: Incidents, wiki: Wiki, dock: Dock };

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
