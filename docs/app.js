"use strict";
/* rate-limit-service — interactive terminal demo.
   Talks to the live Render backend over HTTP. The bucket on screen is a local
   mirror of the server's token bucket: it refills locally for smooth animation
   and snaps to the server's authoritative `remaining` on every response. */

const $ = (id) => document.getElementById(id);

/* ---- backend wiring (kept out of the UI on purpose) ---- */
const BACKEND_URL = "https://ratelimiter-jx5i.onrender.com";
const API_KEY = "test";
// Each browser session gets its own client id, so visitors don't share a bucket.
const CLIENT_ID = "web-" + Math.random().toString(36).slice(2, 8);

/* ============================ config state ============================ */
const cfg = {
  base: BACKEND_URL,
  apiKey: API_KEY,
  clientId: CLIENT_ID,
  get algo()    { return $("algo").value; },
  get capacity(){ return Math.max(1, Number($("capacityNum").value) || 1); },
  get refill()  { return Math.max(0, Number($("refillNum").value) || 0); },
  get cost()    { return Math.max(1, Number($("cost").value) || 1); }
};

/* keep range + number inputs in sync */
function link(rangeId, numId, after) {
  const r = $(rangeId), n = $(numId);
  r.addEventListener("input", () => { n.value = r.value; after && after(); });
  n.addEventListener("input", () => { r.value = n.value; after && after(); });
}
link("capacity", "capacityNum", onPlanChange);
link("refill", "refillNum", onPlanChange);
$("cost").addEventListener("input", updateCaption);
$("algo").addEventListener("change", onAlgoChange);

function onAlgoChange() {
  // fixed window refills in a single step at the window boundary; the others
  // recover continuously.
  sim.stepMode = $("algo").value === "fixed_window";
  setAlgoDesc();
  clearDeny();
  onPlanChange(true);
}

const ALGO_DESC = {
  token_bucket:   "<b>Burst then steady.</b> Holds up to <b>capacity</b> tokens, refills continuously. Allows bursts, caps the long-run rate. Solid default.",
  leaky_bucket:   "<b>Smoothed output.</b> Requests fill a bucket that drains at a fixed rate — bursts queue up, overflow is rejected.",
  fixed_window:   "<b>Simple counter.</b> N requests per fixed window; the count resets at each boundary. Can allow ~2× across a boundary.",
  sliding_window: "<b>Rolling & fair.</b> N per moving window, weighting the previous window — avoids the fixed-window edge burst.",
};
function setAlgoDesc() {
  $("algoDesc").innerHTML = ALGO_DESC[$("algo").value] || "";
}

/* ---- persist the user's settings across reloads ---- */
const LS_CFG = "rl_cfg";
function saveCfg() {
  try {
    localStorage.setItem(LS_CFG, JSON.stringify({
      algo: $("algo").value,
      capacity: $("capacityNum").value,
      refill: $("refillNum").value,
      cost: $("cost").value,
    }));
  } catch (_) {}
}
function loadCfg() {
  let s;
  try { s = JSON.parse(localStorage.getItem(LS_CFG) || "null"); } catch (_) {}
  if (!s) return;
  if (s.algo && $("algo").querySelector(`option[value="${s.algo}"]`)) $("algo").value = s.algo;
  if (s.capacity != null) $("capacity").value = $("capacityNum").value = s.capacity;
  if (s.refill != null) $("refill").value = $("refillNum").value = s.refill;
  if (s.cost != null) $("cost").value = s.cost;
}

/* ============================ bucket simulation ============================ */
const sim = {
  cap: 5,
  refill: 0.25,
  actual: 5,    // authoritative-ish local token count (float)
  display: 5,   // eased value actually drawn
  denyFlashUntil: 0,
  stepMode: false,   // fixed_window: refill in one step at the boundary
  windowReset: 0,    // performance.now() timestamp of the next step refill
  last: performance.now()
};

function onPlanChange(resetTokens) {
  sim.cap = cfg.capacity;
  sim.refill = cfg.refill;
  if (resetTokens === true) sim.actual = sim.cap;
  sim.actual = Math.min(sim.actual, sim.cap);
  updateCaption();
}

function updateCaption() {
  const algo = $("algo").value, cap = cfg.capacity, r = cfg.refill, cost = cfg.cost;
  let s;
  if (algo === "fixed_window" || algo === "sliding_window") {
    const win = r > 0 ? fmt(cap / r) : "60";
    s = `— limit ${cap} per ${win}s ${algo === "sliding_window" ? "sliding " : ""}window · cost ${cost}`;
  } else if (algo === "leaky_bucket") {
    s = `— cap ${cap} · leak ${fmt(r)}/s · cost ${cost}`;
  } else {
    const every = r > 0 ? `1 every ${fmt(1 / r)}s` : "no refill";
    s = `— cap ${cap} · +${fmt(r)}/s (${every}) · cost ${cost}`;
  }
  $("rateCaption").textContent = s;
  $("tokenCap").textContent = sim.cap;
  saveCfg();
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 1 : 2).replace(/0+$/, "").replace(/\.$/, "");
}

/* render loop: refill locally, ease the visual, draw */
function frame(now) {
  const dt = Math.min(0.25, (now - sim.last) / 1000);
  sim.last = now;

  if (sim.stepMode) {
    // fixed window: tokens come back all at once when the window rolls over
    if (sim.windowReset && now >= sim.windowReset) { sim.actual = sim.cap; sim.windowReset = 0; }
  } else {
    // continuous recovery (token / leaky / sliding)
    sim.actual = Math.min(sim.cap, sim.actual + dt * sim.refill);
  }

  // once enough has recovered after a denial, retire the red message so it
  // doesn't linger looking like a live error
  if (denyActive && sim.actual >= cfg.cost) {
    denyActive = false;
    narrate("ok", `recovered — <b>${Math.floor(sim.actual)}</b> available again. ready to send.`);
  }

  sim.display += (sim.actual - sim.display) * Math.min(1, dt * 9);
  if (Math.abs(sim.actual - sim.display) < 0.01) sim.display = sim.actual;

  const pct = sim.cap > 0 ? Math.max(0, Math.min(1, sim.display / sim.cap)) : 0;
  $("bucketFill").style.height = (pct * 100).toFixed(2) + "%";
  $("tokenCount").textContent = Math.floor(sim.display + 1e-6);

  $("bucket").classList.toggle("deny", now < sim.denyFlashUntil);
  drawPips();
  requestAnimationFrame(frame);
}

function drawPips() {
  const cap = sim.cap;
  const box = $("pips");
  if (cap > 20) { box.innerHTML = ""; return; }   // pips only for small buckets
  if (box.childElementCount !== cap) {
    box.innerHTML = Array.from({ length: cap }, () => `<span class="pip"></span>`).join("");
  }
  const on = Math.floor(sim.display + 1e-6);
  [...box.children].forEach((p, i) => p.classList.toggle("on", i < on));
}

/* ============================ stats + log ============================ */
let sent = 0, ok = 0, bad = 0;
let denyActive = false;                 // true while the last result was a denial
function clearDeny() { denyActive = false; }
function bumpStats(allowed) {
  sent++; allowed ? ok++ : bad++;
  $("statSent").textContent = sent;
  $("statOk").textContent = ok;
  $("statBad").textContent = bad;
}
function logLine(html) {
  const el = document.createElement("div");
  el.className = "line";
  el.innerHTML = html;
  const log = $("log");
  log.appendChild(el);
  while (log.childElementCount > 120) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function ts() { return new Date().toLocaleTimeString("en-GB"); }

function narrate(kind, html) {
  const n = $("narration");
  n.className = "narration " + (kind || "");
  n.innerHTML = `<span class="prompt">$</span> ${html}`;
}

/* ============================ the request ============================ */
async function sendRequest() {
  const clientId = cfg.clientId, cost = cfg.cost;
  const windowSec = cfg.refill > 0 ? cfg.capacity / cfg.refill : 60;
  const policy = {
    algorithm: cfg.algo,
    capacity: cfg.capacity,
    refillRatePerSec: cfg.refill,
    limit: cfg.capacity,          // window algorithms read this
    windowSec                     // ...and this
  };

  logLine(`<span class="req">[${ts()}] <span class="mag">POST</span> /v1/check ` +
          `{client:"${clientId}", cost:${cost}}</span>`);

  let data, status;
  try {
    const res = await fetch(cfg.base + "/v1/check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({ clientId, cost, policy })
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  } catch (err) {
    logLine(`<span class="res warn">  ↳ network error: ${String(err.message || err)}</span>`);
    narrate("bad", `⚠ couldn't reach the backend. Is the base url right / is it awake?`);
    return;
  }

  if (status === 401) {
    logLine(`<span class="res warn">  ↳ 401 unauthorized — check x-api-key</span>`);
    narrate("bad", `⚠ <b>401</b>: the <code>x-api-key</code> is wrong. It should be <b>test</b>.`);
    return;
  }
  if (!data || typeof data.allowed === "undefined") {
    logLine(`<span class="res warn">  ↳ ${status}: unexpected response</span>`);
    return;
  }

  // sync the local bucket to the server's truth
  sim.cap = data.limit;
  sim.actual = data.remaining;
  $("tokenCap").textContent = sim.cap;
  if (sim.stepMode) sim.windowReset = performance.now() + data.resetMs;
  bumpStats(data.allowed);

  if (data.allowed) {
    denyActive = false;
    logLine(`<span class="res ok">  ↳ 200 ALLOWED · remaining ${data.remaining}/${data.limit}` +
            ` · resets in ${ms(data.resetMs)}</span>`);
    const tail = $("algo").value === "fixed_window"
      ? `Window resets in ${ms(data.resetMs)}.`
      : (cfg.refill > 0 ? `Refills 1 every ${fmt(1 / cfg.refill)}s.` : `No refill configured.`);
    narrate("ok",
      `<b>✅ ALLOWED.</b> Spent ${cost} unit${cost > 1 ? "s" : ""}. ` +
      `<b>${data.remaining}</b> left of ${data.limit}. ${tail}`);
  } else {
    denyActive = true;
    sim.denyFlashUntil = performance.now() + 420;
    logLine(`<span class="res bad">  ↳ 429 DENIED · no allowance left · retry after ${ms(data.retryAfterMs)}</span>`);
    narrate("bad",
      `⛔ <b>DENIED (429).</b> Out of allowance — needed ${cost}, had fewer. ` +
      `Wait ~<b>${ms(data.retryAfterMs)}</b> and it recovers automatically.`);
  }
}
function ms(v) { return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "s" : Math.round(v) + "ms"; }

/* ============================ controls ============================ */
$("send").onclick = sendRequest;
$("burst").onclick = async () => {
  for (let i = 0; i < 10; i++) { sendRequest(); await sleep(90); }
};
$("reset").onclick = () => {
  sim.actual = sim.cap = cfg.capacity;
  sim.display = sim.actual;
  sim.windowReset = 0;
  clearDeny();
  $("log").innerHTML = "";
  sent = ok = bad = 0;
  $("statSent").textContent = $("statOk").textContent = $("statBad").textContent = "0";
  narrate("", `view reset. <span class="dim">(server-side buckets keep refilling on their own.)</span>`);
};

/* ---- terminal window chrome: minimize / close / maximize ---- */
const appEl = $("app");
function minimizeApp() { appEl.classList.add("minimized"); $("launcher").classList.add("show"); endTour(); }
function restoreApp() { appEl.classList.remove("minimized"); $("launcher").classList.remove("show"); }
function toggleMax() { appEl.classList.toggle("maximized"); requestAnimationFrame(positionTour); }
$("winMin").onclick = minimizeApp;
$("winClose").onclick = minimizeApp;   // single-page app: "close" parks it as an icon too
$("winMax").onclick = toggleMax;
$("launcher").onclick = restoreApp;

/* ---- request log show / hide ---- */
$("logBtn").onclick = () => $("grid").classList.toggle("no-log");

/* ---- copy a ready-to-run curl for the current settings ---- */
function currentCurl() {
  const windowSec = cfg.refill > 0 ? cfg.capacity / cfg.refill : 60;
  const body = JSON.stringify({
    clientId: cfg.clientId,
    cost: cfg.cost,
    policy: {
      algorithm: cfg.algo,
      capacity: cfg.capacity,
      refillRatePerSec: cfg.refill,
      limit: cfg.capacity,
      windowSec
    }
  });
  return `curl -X POST ${cfg.base}/v1/check \\\n` +
         `  -H 'content-type: application/json' \\\n` +
         `  -H 'x-api-key: ${cfg.apiKey}' \\\n` +
         `  -d '${body}'`;
}
$("copyCurl").onclick = async () => {
  const curl = currentCurl();
  let copied = false;
  try {
    await navigator.clipboard.writeText(curl);
    copied = true;
  } catch (_) {
    // fallback for non-secure contexts / older browsers
    const ta = document.createElement("textarea");
    ta.value = curl; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }
  const b = $("copyCurl"), label = b.textContent;
  b.textContent = copied ? "✓ copied" : "⧉ copy failed";
  b.disabled = true;
  setTimeout(() => { b.textContent = label; b.disabled = false; }, 1300);
};

let autoTimer = null;
$("auto").onclick = () => {
  if (autoTimer) {
    clearInterval(autoTimer); autoTimer = null; $("autoState").textContent = "▶";
  } else {
    autoTimer = setInterval(sendRequest, Number($("autoSpeed").value));
    $("autoState").textContent = "⏸";
  }
};
$("autoSpeed").onchange = () => {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = setInterval(sendRequest, Number($("autoSpeed").value)); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ backend warm-up ============================ */
async function warmUp() {
  setWarm("amber", "waking backend…");
  const start = Date.now();
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const res = await fetch(cfg.base + "/healthz", { cache: "no-store" });
      if (res.ok) {
        const secs = ((Date.now() - start) / 1000).toFixed(1);
        setWarm("green", `backend online · ${secs}s`);
        return;
      }
    } catch (_) { /* cold start: keep trying */ }
    await sleep(2500);
  }
  setWarm("red", "backend unreachable");
}
function setWarm(color, text) {
  const d = $("warmDot");
  if (d) d.className = "dot " + color + (color !== "green" ? " pulse" : "");
  const t = $("warmText");
  if (t) t.textContent = text;
}

/* ============================ guided spotlight tour ============================ */
const TOUR = [
  { sel: "#fAlgo", place: "right", title: "1. algorithm",
    text: 'Pick the limiting strategy. <b>token_bucket</b> is live — the greyed-out ones are pluggable, just not wired up yet.' },
  { sel: "#limitsGroup", place: "right", title: "2. the limits",
    text: '<b>capacity</b> = biggest burst allowed. <b>refill</b> = tokens added back each second (the steady pace). Tweak them live.' },
  { sel: "#bucket", place: "left", title: "3. the bucket",
    text: 'Tokens live here. Each request <b>drains</b> them and they <b>refill</b> over time. Hit empty → requests get denied.' },
  { sel: "#send", place: "top", last: true, title: "4. send it →",
    text: 'Now fire a <b>real request</b> and watch <span class="g">ALLOW</span> / <span class="r">DENY</span>. Spam it to drain the bucket and see it recover!' }
];

let tIdx = 0, tEls = null, tTarget = null;

function buildTour() {
  const block = document.createElement("div"); block.className = "tour-block";
  const spot = document.createElement("div");  spot.className = "tour-spot";
  const tip = document.createElement("div");   tip.className = "tour-tip";
  document.body.append(block, spot, tip);
  return { block, spot, tip };
}

function startTour() {
  if (!tEls) tEls = buildTour();
  tIdx = 0;
  for (const k of ["block", "spot", "tip"]) tEls[k].style.display = "block";
  window.addEventListener("resize", positionTour);
  window.addEventListener("scroll", positionTour, true);
  showTourStep();
}

function endTour() {
  try { localStorage.setItem("rl_seen", "1"); } catch (_) {}
  if (tTarget) tTarget.classList.remove("tour-highlight");
  tTarget = null;
  if (tEls) for (const k of ["block", "spot", "tip"]) tEls[k].style.display = "none";
  window.removeEventListener("resize", positionTour);
  window.removeEventListener("scroll", positionTour, true);
}

function showTourStep() {
  const step = TOUR[tIdx];
  if (tTarget) tTarget.classList.remove("tour-highlight");
  tTarget = document.querySelector(step.sel);
  if (!tTarget) { // target missing — skip gracefully
    if (tIdx < TOUR.length - 1) { tIdx++; return showTourStep(); }
    return endTour();
  }
  tTarget.scrollIntoView({ block: "center", inline: "nearest" });
  tTarget.classList.add("tour-highlight");

  const dots = TOUR.map((_, i) => `<span class="${i === tIdx ? "on" : ""}"></span>`).join("");
  tEls.tip.innerHTML =
    `<h3><span class="prompt">$</span>${step.title}</h3>` +
    `<p>${step.text}</p>` +
    `<div class="tour-foot"><div class="tour-dots">${dots}</div><div class="tour-acts">` +
      `<button class="btn ghost tiny" id="tourSkip">skip</button>` +
      (tIdx > 0 ? `<button class="btn ghost tiny" id="tourBack">back</button>` : ``) +
      `<button class="btn primary tiny" id="tourNext">${step.last ? "got it ✓" : "next →"}</button>` +
    `</div></div>`;

  $("tourSkip").onclick = endTour;
  const back = document.getElementById("tourBack");
  if (back) back.onclick = () => { tIdx--; showTourStep(); };
  $("tourNext").onclick = () => {
    if (tIdx < TOUR.length - 1) { tIdx++; showTourStep(); } else endTour();
  };
  // last step: clicking the real Send button also ends the tour
  if (step.last) tTarget.addEventListener("click", endTour, { once: true });

  requestAnimationFrame(positionTour);
}

function positionTour() {
  if (!tTarget || !tEls) return;
  const r = tTarget.getBoundingClientRect();
  const pad = 7;
  Object.assign(tEls.spot.style, {
    top: (r.top - pad) + "px",
    left: (r.left - pad) + "px",
    width: (r.width + pad * 2) + "px",
    height: (r.height + pad * 2) + "px"
  });

  const tip = tEls.tip;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14;
  const place = TOUR[tIdx].place || "bottom";
  let top, left;
  if (place === "right" && r.right + tw + gap < vw)      { left = r.right + gap;  top = r.top; }
  else if (place === "left" && r.left - tw - gap > 0)    { left = r.left - tw - gap; top = r.top; }
  else if (place === "top")                              { top = r.top - th - gap; left = r.left; }
  else                                                   { top = r.bottom + gap; left = r.left; }
  left = Math.max(12, Math.min(left, vw - tw - 12));
  top  = Math.max(12, Math.min(top,  vh - th - 12));
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

$("helpBtn").onclick = startTour;

/* ---- keyboard: Enter sends a request (unless you're typing in a control) ---- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  if (appEl.classList.contains("minimized")) return;
  e.preventDefault();
  sendRequest();
});

/* ============================ boot ============================ */
loadCfg();        // restore the user's last settings...
onAlgoChange();   // ...then apply them (caption, description, bucket, step-mode)
requestAnimationFrame(frame);
warmUp();                       // start warming the dyno immediately
let seen = false;
try { seen = !!localStorage.getItem("rl_seen"); } catch (_) {}
if (!seen) startTour();         // first-time visitors get the guided tour straight away
