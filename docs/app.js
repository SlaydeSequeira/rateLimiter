"use strict";
/* rate-limit-service — interactive terminal demo.
   Talks to the live Render backend over HTTP. The bucket on screen is a local
   mirror of the server's token bucket: it refills locally for smooth animation
   and snaps to the server's authoritative `remaining` on every response. */

const $ = (id) => document.getElementById(id);

/* ============================ tutorial content ============================ */
const STEPS = [
  {
    title: "What is a rate limiter?",
    html: `
      <p>Every public API needs to stop a single client from sending <b>too many
      requests</b> — to prevent abuse, control cost, and keep things fast for
      everyone else.</p>
      <p>A rate limiter is the <b>bouncer at the door</b>. It tracks how many
      requests each client (identified by a <code>clientId</code>) has made and
      answers one question per request:</p>
      <div class="codeblock"><span class="g">ALLOW</span>  &mdash; you're under your limit, go ahead
<span class="r">DENY</span>   &mdash; slow down, try again shortly</div>
      <p class="dim">This demo calls a <b>real service</b> running on Render. Every
      click below is a live HTTP request.</p>`
  },
  {
    title: "The token bucket algorithm",
    html: `
      <p>Give every client a <b>bucket of tokens</b>:</p>
      <p><span class="mini-bucket"><i></i><i></i><i></i><i class="off"></i><i class="off"></i></span></p>
      <p>
        &bull; <code>capacity</code> &mdash; the most tokens the bucket can hold
        <span class="dim">(your max burst)</span><br/>
        &bull; <code>refill</code> &mdash; tokens added back every second
        <span class="dim">(your steady allowed pace)</span><br/>
        &bull; <code>cost</code> &mdash; tokens one request spends
        <span class="dim">(usually 1)</span>
      </p>
      <p>Each request tries to take <code>cost</code> tokens. Enough in the bucket?
      <span class="g">ALLOWED</span>, and the tokens are removed. Not enough?
      <span class="r">DENIED</span>. Meanwhile the bucket <b>refills continuously</b>,
      so waiting a moment buys you more.</p>
      <div class="codeblock"><span class="c"># capacity 5, refill 0.5/sec</span>
fire 5 fast requests  <span class="g">-> all allowed</span>  <span class="c">(burst)</span>
6th request instantly  <span class="r">-> denied</span>     <span class="c">(bucket empty)</span>
wait ~2s               <span class="g">-> 1 token back</span> <span class="c">(steady rate)</span></div>`
  },
  {
    title: "Built to be pluggable",
    html: `
      <p>This service ships with <b>token bucket</b> today, but the algorithm is
      <b>swappable</b> — sliding window, leaky bucket and fixed window can be added
      without changing a single line in the apps that call it.</p>
      <p>You'll see them in the <code>algorithm</code> dropdown, greyed out
      <span class="dim">(= interface exists, not wired up yet)</span>. That's the
      whole point of the design: <b>add an algorithm, register it, done.</b></p>
      <p class="dim">Storage is pluggable the same way — in-memory now, Redis by
      flipping one env var, for sharing limits across many servers.</p>`
  },
  {
    title: "Your turn — drive it",
    html: `
      <p>1. Pick a <b>client</b> &amp; a plan. Different clients have
      <b>separate buckets</b> — try draining one, then switch and watch the other
      is still full.</p>
      <p>2. Hit <b>SEND REQUEST</b> and watch the bucket drain.</p>
      <p>3. <b>Spam it</b> (send &times;10 / auto) — watch requests flip to
      <span class="r">DENIED</span> when it empties, then recover as it refills.</p>
      <p>4. Read the <b>narration</b> and the <b>log</b> to see exactly what the
      server decided, and why.</p>
      <p class="dim">Tweak <code>capacity</code>, <code>refill</code> and
      <code>cost</code> live to feel how the algorithm responds.</p>`
  }
];

/* ============================ tutorial engine ============================ */
let stepIdx = 0;
function renderStep() {
  const s = STEPS[stepIdx];
  $("tutorialBody").innerHTML =
    `<div class="tut-step"><h2><span class="prompt">$</span>${s.title}</h2>${s.html}</div>`;
  $("tutProgress").innerHTML = STEPS
    .map((_, i) => `<span class="${i <= stepIdx ? "on" : ""}"></span>`)
    .join("");
  $("tutBack").hidden = stepIdx === 0;
  $("tutNext").textContent = stepIdx === STEPS.length - 1 ? "enter terminal →" : "next →";
}
function closeTutorial() {
  $("tutorial").classList.add("hidden");
  $("app").setAttribute("aria-hidden", "false");
  try { localStorage.setItem("rl_seen", "1"); } catch (_) {}
}
$("tutNext").onclick = () => {
  if (stepIdx < STEPS.length - 1) { stepIdx++; renderStep(); }
  else closeTutorial();
};
$("tutBack").onclick = () => { if (stepIdx > 0) { stepIdx--; renderStep(); } };
$("tutSkip").onclick = closeTutorial;
$("helpBtn").onclick = () => {
  stepIdx = 0; renderStep();
  $("tutorial").classList.remove("hidden");
  $("app").setAttribute("aria-hidden", "true");
};
renderStep();

/* ============================ config state ============================ */
const cfg = {
  get base()   { return $("baseUrl").value.trim().replace(/\/+$/, ""); },
  get apiKey() { return $("apiKey").value.trim(); },
  get algo()   { return $("algo").value; },
  get capacity(){ return Math.max(1, Number($("capacityNum").value) || 1); },
  get refill() { return Math.max(0, Number($("refillNum").value) || 0); },
  get cost()   { return Math.max(1, Number($("cost").value) || 1); },
  get clientId() {
    const preset = $("clientPreset").value;
    return preset === "__custom__" ? ($("clientId").value.trim() || "anon") : preset;
  }
};

/* keep range + number inputs in sync */
function link(rangeId, numId, after) {
  const r = $(rangeId), n = $(numId);
  r.addEventListener("input", () => { n.value = r.value; after && after(); });
  n.addEventListener("input", () => { r.value = n.value; after && after(); });
}
link("capacity", "capacityNum", onPlanChange);
link("refill", "refillNum", onPlanChange);

$("clientPreset").addEventListener("change", () => {
  const opt = $("clientPreset").selectedOptions[0];
  $("customClientField").hidden = $("clientPreset").value !== "__custom__";
  $("capacity").value = $("capacityNum").value = opt.dataset.cap;
  $("refill").value = $("refillNum").value = opt.dataset.refill;
  onPlanChange(true);
});
$("cost").addEventListener("input", updateCaption);

/* ============================ bucket simulation ============================ */
const sim = {
  cap: 5,
  refill: 0.5,
  actual: 5,    // authoritative-ish local token count (float)
  display: 5,   // eased value actually drawn
  denyFlashUntil: 0,
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
  const r = cfg.refill;
  const every = r > 0 ? `1 token every ${fmt(1 / r)}s` : "no refill";
  $("rateCaption").textContent =
    `— cap ${cfg.capacity} · +${fmt(r)}/s (${every}) · cost ${cfg.cost}`;
  $("tokenCap").textContent = sim.cap;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 1 : 2).replace(/0+$/, "").replace(/\.$/, "");
}

/* render loop: refill locally, ease the visual, draw */
function frame(now) {
  const dt = Math.min(0.25, (now - sim.last) / 1000);
  sim.last = now;

  sim.actual = Math.min(sim.cap, sim.actual + dt * sim.refill);
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
let inFlight = 0;
async function sendRequest() {
  const clientId = cfg.clientId, cost = cfg.cost;
  const policy = { algorithm: cfg.algo, capacity: cfg.capacity, refillRatePerSec: cfg.refill };

  logLine(`<span class="req">[${ts()}] <span class="mag">POST</span> /v1/check ` +
          `{client:"${clientId}", cost:${cost}}</span>`);

  inFlight++;
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
    inFlight--;
    return;
  }
  inFlight--;

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
  bumpStats(data.allowed);

  if (data.allowed) {
    logLine(`<span class="res ok">  ↳ 200 ALLOWED · remaining ${data.remaining}/${data.limit}` +
            ` · resets in ${ms(data.resetMs)}</span>`);
    narrate("ok",
      `<b class="">✅ ALLOWED.</b> Spent ${cost} token${cost > 1 ? "s" : ""}. ` +
      `<b>${data.remaining}</b> left of ${data.limit}. ` +
      (cfg.refill > 0
        ? `Bucket refills 1 every ${fmt(1 / cfg.refill)}s.`
        : `No refill configured.`));
  } else {
    sim.denyFlashUntil = performance.now() + 420;
    logLine(`<span class="res bad">  ↳ 429 DENIED · bucket empty · retry after ${ms(data.retryAfterMs)}</span>`);
    narrate("bad",
      `⛔ <b>DENIED (429).</b> Bucket empty — needed ${cost}, had fewer. ` +
      `Wait ~<b>${ms(data.retryAfterMs)}</b> for enough tokens to refill.`);
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
  $("log").innerHTML = "";
  sent = ok = bad = 0;
  $("statSent").textContent = $("statOk").textContent = $("statBad").textContent = "0";
  narrate("", `view reset. <span class="dim">(server-side buckets keep refilling on their own.)</span>`);
};

let autoTimer = null;
$("auto").onclick = () => {
  if (autoTimer) {
    clearInterval(autoTimer); autoTimer = null; $("autoState").textContent = "▶";
  } else {
    const run = () => sendRequest();
    autoTimer = setInterval(run, Number($("autoSpeed").value));
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
  for (const dotId of ["warmDot", "warmDotTut"]) {
    const d = $(dotId); if (!d) continue;
    d.className = "dot " + color + (color !== "green" ? " pulse" : "");
  }
  for (const tId of ["warmText", "warmTextTut"]) {
    const t = $(tId); if (t) t.textContent = text;
  }
}

/* ============================ boot ============================ */
onPlanChange(true);
requestAnimationFrame(frame);
warmUp();                       // start warming immediately, while user reads the tutorial
try {
  if (localStorage.getItem("rl_seen")) closeTutorial();   // returning visitor skips intro
} catch (_) {}
