// "Quantum Core" progress visualisation. Pure presentation layer: it only DISPLAYS the numbers it is given by app.js.
// Equations, orbits, grids and particles are decorative; every number and label shown comes from the real run state.
// Performance: one small canvas per panel, 30fps cap while running, fully stopped when the panel is hidden,
// the tab is in the background, the run is idle/finished, or the user prefers reduced motion.
(function (root) {
  "use strict";
  const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
  const NS = "http://www.w3.org/2000/svg";
  const TAU = Math.PI * 2;
  const RING_C = 2 * Math.PI * 88;                      // circumference of the progress ring (r = 88)
  const EQS = ["E = mc²", "F = ma", "iħ ∂ψ/∂t = Ĥψ", "∇·E = ρ/ε₀", "ΔxΔp ≥ ħ/2", "G\u03BC\u03BD + Λg\u03BC\u03BD = 8πG T\u03BC\u03BD/c⁴",
                "∮ B·dA = 0", "F = Gm₁m₂/r²", "ψ = Σ cₙφₙ", "S = k ln W"];
  const EQ_POS = [[4, 12], [70, 8], [10, 70], [76, 66], [38, 4], [56, 86], [2, 42], [82, 36], [26, 88], [60, 24]];

  let docVisible = !document.hidden;
  const instances = new Set();
  document.addEventListener("visibilitychange", () => { docVisible = !document.hidden; instances.forEach(i => i.sync()); });
  const onReduce = () => instances.forEach(i => i.sync());
  reduceMQ.addEventListener ? reduceMQ.addEventListener("change", onReduce) : reduceMQ.addListener(onReduce);

  // ---- shared glow sprites (rendered once, reused by every particle: no per-frame gradients) ----
  const SPR = {};
  function sprite(name, r, g, b) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.16, "rgba(" + r + "," + g + "," + b + ",.95)");
    gr.addColorStop(0.5, "rgba(" + r + "," + g + "," + b + ",.2)"); gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); SPR[name] = c;
  }
  sprite("cyan", 56, 189, 248); sprite("violet", 167, 139, 250); sprite("gold", 251, 191, 36);
  sprite("green", 74, 222, 128); sprite("amber", 245, 158, 11); sprite("pink", 232, 121, 249);

  // colour sets per mode: [accent rgb for lines, sprite names for particles]
  const PAL = {
    idle:     { acc: "120,170,255", spr: ["cyan", "violet"] },
    running:  { acc: "90,200,255",  spr: ["cyan", "violet", "pink", "gold"] },
    paused:   { acc: "150,170,220", spr: ["cyan", "violet"] },
    complete: { acc: "74,222,128",  spr: ["green", "cyan", "gold", "violet"] },
    warn:     { acc: "245,170,60",  spr: ["amber", "gold", "cyan"] }
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = t => 1 - Math.pow(1 - t, 3);
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e); return e;
  }
  function div(cls, text, parent) { const e = document.createElement("div"); e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; }

  class ProgressFX {
    constructor(box) {
      this.box = box; this.mode = "idle"; this.prevMode = "idle"; this.visible = false;
      this.raf = 0; this.last = 0; this.t = 2.1; this.e = 0.25; this.eT = 0.25; this.burstT = 99;
      this.w = 0; this.h = 0; this.dpr = 1; this.cx = 0; this.cy = 0; this.R = 80;
      this.waves = []; this.pulses = []; this.burst = []; this.waveT = 0;
      this.pctShown = 0; this.pctTarget = 0; this.tw = 0; this.nums = {}; this.model = null; this.lastPhase = "";
      this.build(); this.seed();
      instances.add(this);
      this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(this.stage);
      this.io = new IntersectionObserver(es => { this.visible = es[es.length - 1].isIntersecting; if (this.visible) this.measure(); this.sync(); });
      this.io.observe(this.box);
      this.tick = this.tick.bind(this);
    }

    // ---------- DOM ----------
    build() {
      const box = this.box; box.replaceChildren(); box.classList.add("fx");
      const stage = this.stage = div("fx-stage fx-m-idle", undefined, box);
      stage.setAttribute("role", "progressbar"); stage.setAttribute("aria-valuemin", "0"); stage.setAttribute("aria-valuemax", "100"); stage.setAttribute("aria-valuenow", "0");
      this.cv = document.createElement("canvas"); this.cv.className = "fx-canvas"; this.cv.setAttribute("aria-hidden", "true"); stage.appendChild(this.cv);
      this.ctx = this.cv.getContext("2d");
      const eqs = div("fx-eqs", undefined, stage); eqs.setAttribute("aria-hidden", "true");
      EQS.forEach((q, i) => {
        const s = div("fx-eq", q, eqs); s.style.left = EQ_POS[i][0] + "%"; s.style.top = EQ_POS[i][1] + "%";
        s.style.animationDuration = (16 + (i * 7) % 13) + "s"; s.style.animationDelay = "-" + ((i * 5) % 17) + "s";
      });
      div("fx-flash", undefined, stage);
      const core = div("fx-core", undefined, stage);
      const reactor = this.reactor = div("fx-reactor", undefined, core);
      const sv = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true" }, reactor);
      const defs = svg("defs", {}, sv), lg = svg("linearGradient", { id: "fxg" + (ProgressFX.n = (ProgressFX.n || 0) + 1), x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
      svg("stop", { offset: "0", class: "fx-s1" }, lg); svg("stop", { offset: "1", class: "fx-s2" }, lg);
      svg("circle", { cx: 100, cy: 100, r: 88, class: "fx-track" }, sv);
      const ticks = svg("g", { class: "fx-ticks" }, sv);
      for (let i = 0; i < 72; i++) { const a = i / 72 * TAU, long = i % 6 === 0, r1 = 95, r2 = long ? 99.5 : 97.5;
        svg("line", { x1: 100 + Math.cos(a) * r1, y1: 100 + Math.sin(a) * r1, x2: 100 + Math.cos(a) * r2, y2: 100 + Math.sin(a) * r2, class: long ? "fx-tk fx-tk-l" : "fx-tk" }, ticks); }
      svg("circle", { cx: 100, cy: 100, r: 78, class: "fx-dash" }, sv);
      this.arc = svg("circle", { cx: 100, cy: 100, r: 88, class: "fx-arc", stroke: "url(#" + lg.id + ")", "stroke-dasharray": RING_C.toFixed(2), "stroke-dashoffset": RING_C.toFixed(2) }, sv);
      this.spark = svg("g", { class: "fx-spark" }, sv); svg("circle", { cx: 100, cy: 12, r: 4.2, class: "fx-spark-c" }, this.spark); svg("circle", { cx: 100, cy: 12, r: 9, class: "fx-spark-h" }, this.spark);
      const ctr = div("fx-center", undefined, reactor);
      const pct = div("fx-pct", undefined, ctr); this.pctN = document.createElement("span"); this.pctN.className = "fx-pct-n"; this.pctN.textContent = "0";
      pct.appendChild(this.pctN); pct.appendChild(Object.assign(document.createElement("span"), { className: "fx-pct-u", textContent: "%" }));
      this.frac = div("fx-frac", "0 / 0", ctr);
      const ck = this.check = svg("svg", { viewBox: "0 0 24 24", class: "fx-check", "aria-hidden": "true" }, ctr);
      svg("path", { d: "M5 12.5l4.5 4.5L19 7.5", pathLength: "1" }, ck);
      const st = div("fx-status", undefined, core);
      this.phase = div("fx-phase", "STANDBY", st); this.phase.setAttribute("aria-live", "polite");
      this.detail = div("fx-detail", "Awaiting operation", st);
      this.tags = div("fx-tags", undefined, stage);
      const tiles = div("fx-tiles", undefined, box);
      this.tileEl = {};
      for (const [k, label, cls] of [["done", "Completed", ""], ["pend", "Pending", ""], ["ok", "Success", "t-ok"], ["skip", "Skipped", "t-skip"], ["bad", "Failed", "t-bad"]]) {
        const t = div("fx-tile " + cls, undefined, tiles); div("fx-tl", label, t); this.tileEl[k] = div("fx-tn", "0", t); this.nums[k] = 0;
      }
      div("fx-foot", "Counts are live from the actual run. Formulas, orbits and fields are decorative visuals only.", box);
    }

    seed() {
      this.nodes = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), vx: rnd(-0.02, 0.02), vy: rnd(-0.02, 0.02) }));
      this.parts = Array.from({ length: 64 }, () => ({ a: rnd(0, TAU), rad: rnd(0.16, 0.7), w: rnd(0.08, 0.5) * (Math.random() < 0.5 ? -1 : 1), sz: rnd(5, 13), ph: rnd(0, TAU), c: (Math.random() * 4) | 0 }));
      this.lanes = Array.from({ length: 8 }, (_, i) => {
        const left = i % 2 === 0, k = (i >> 1) / 3;
        return { sx: left ? 0 : 1, sy: 0.12 + k * 0.76, bend: rnd(-0.16, 0.16), pk: [rnd(0, 1), rnd(0, 1), rnd(0, 1)], sp: rnd(0.12, 0.24) };
      });
      this.orbits = [0, 1, 2].map(i => ({ th: i * Math.PI / 3, ph: i * 2.1, k: 0.22 + i * 0.05, w: 1.5 + i * 0.45 }));
    }

    // ---------- sizing ----------
    measure() {
      const r = this.stage.getBoundingClientRect(); if (!r.width || !r.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = Math.round(r.width), H = Math.round(r.height);
      if (W !== this.w || H !== this.h || this.cv.width !== Math.round(W * this.dpr)) {
        this.w = W; this.h = H; this.cv.width = Math.round(W * this.dpr); this.cv.height = Math.round(H * this.dpr);
      }
      const rr = this.reactor.getBoundingClientRect();
      this.cx = rr.left - r.left + rr.width / 2; this.cy = rr.top - r.top + rr.height / 2; this.R = rr.width / 2;
      if (!this.raf) this.drawFrame();
    }

    // ---------- model from app.js ----------
    update(m) {
      this.model = m;
      const total = m.total, pct = total ? Math.round(m.done / total * 100) : 0;
      let mode = "idle";
      if (total > 0) mode = m.active ? (m.paused ? "paused" : "running") : (m.done >= total ? "complete" : "stopped");
      const prev = this.mode; this.mode = mode; if (prev !== mode) this.dirty = true;
      const warn = mode === "complete" && (m.failed > 0 || m.dry);
      const cls = mode === "complete" ? (warn ? "warn" : "ok") : mode === "stopped" ? "warn" : mode;
      this.stage.className = "fx-stage fx-m-" + cls + (this.stage.classList.contains("fx-live") ? " fx-live" : "");
      this.stage.setAttribute("aria-valuenow", String(pct));
      this.stage.setAttribute("aria-valuetext", m.done + " of " + total + " profiles processed");
      this.pal = PAL[mode === "complete" ? (warn ? "warn" : "complete") : mode === "stopped" ? "warn" : mode] || PAL.idle;
      this.eT = mode === "running" ? 1 : mode === "paused" ? 0.18 : mode === "complete" ? 0.55 : 0.25;

      // ring / percent
      this.arc.style.strokeDashoffset = (RING_C * (1 - pct / 100)).toFixed(2);
      this.spark.style.transform = "rotate(" + (pct * 3.6) + "deg)";
      this.spark.style.opacity = pct > 0 && pct < 100 ? "1" : "0";
      this.pctTarget = pct; this.tweenPct();
      this.frac.textContent = m.done + " / " + total;

      // text
      let ph, dt = "";
      const sumTxt = m.success + " successful · " + m.failed + " failed · " + m.skipped + " skipped";
      if (mode === "idle") { ph = "STANDBY"; dt = "Awaiting operation"; }
      else if (mode === "running") { ph = "PROCESSING"; dt = m.current || "Working…"; }
      else if (mode === "paused") { ph = "PAUSED"; dt = m.current ? "Held at: " + m.current : "Click Resume to continue"; }
      else if (mode === "stopped") { ph = "STOPPED"; dt = "Stopped at " + m.done + " of " + total + " · " + sumTxt; }
      else { ph = m.dry ? "DRY RUN COMPLETE" : m.failed ? "COMPLETE · " + m.failed + " FAILED" : "ALL OPERATIONS COMPLETE"; dt = sumTxt + (m.dry ? " · nothing was changed" : ""); }
      this.phase.textContent = ph; this.detail.textContent = dt; this.detail.title = dt;
      this.tags.replaceChildren();
      if (m.mock) div("fx-tag", "TEST MODE", this.tags);
      if (m.dry) div("fx-tag", "DRY RUN", this.tags);

      // tiles (bump on change)
      const vals = { done: m.done, pend: m.pending, ok: m.success, skip: m.skipped, bad: m.failed };
      for (const k in vals) if (this.nums[k] !== vals[k]) {
        this.nums[k] = vals[k]; this.tileEl[k].textContent = String(vals[k]);
        if (!reduceMQ.matches && this.tileEl[k].animate) this.tileEl[k].animate([{ transform: "scale(1.28)", filter: "brightness(1.6)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
      this.stage.classList.toggle("fx-done", mode === "complete");

      // transitions
      if (mode === "complete" && (prev === "running" || prev === "paused")) this.triggerBurst(warn);
      if (mode === "running" && prev !== "running" && prev !== "paused") { this.burst.length = 0; this.burstT = 99; }
      this.prevMode = prev; this.sync();
    }

    tweenPct() {
      const set = v => { this.pctN.textContent = String(v); };
      if (reduceMQ.matches || !docVisible || !this.visible) { cancelAnimationFrame(this.tw); this.tw = 0; this.pctShown = this.pctTarget; set(this.pctTarget); return; }
      if (this.tw) return;
      const step = () => {
        const d = this.pctTarget - this.pctShown;
        if (Math.abs(d) < 0.5) { this.pctShown = this.pctTarget; set(this.pctTarget); this.tw = 0; return; }
        this.pctShown += d * 0.16; set(Math.round(this.pctShown)); this.tw = requestAnimationFrame(step);
      };
      this.tw = requestAnimationFrame(step);
    }

    triggerBurst(warn) {
      this.burstT = 0; this.e = 1;
      if (reduceMQ.matches) return;
      const pal = this.pal || PAL.complete;
      for (let i = 0; i < 80; i++) { const a = rnd(0, TAU), sp = rnd(50, 260); this.burst.push({ x: this.cx, y: this.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.2, 2.6), max: 2.6, s: pal.spr[i % pal.spr.length] }); }
      this.waves.push({ r: this.R * 0.5, big: true });
      this.waves.push({ r: this.R * 0.2, big: true, delay: 0.18 });
      const f = this.stage.querySelector(".fx-flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
    }

    // ---------- loop control ----------
    needsLoop() {
      if (reduceMQ.matches) return false;
      return this.mode === "running" || this.mode === "paused" || (this.mode === "complete" && this.burstT < 7);
    }
    sync() {
      const want = docVisible && this.visible && this.needsLoop();
      const was = !!this.raf;
      if (want && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
      else if (!want && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      this.stage.classList.toggle("fx-live", want);
      if (!want && (was || this.dirty) && this.visible) { this.pal = this.pal || PAL.idle; this.e = this.eT; this.burst.length = 0; this.waves.length = 0; this.pulses.length = 0; this.drawFrame(); this.dirty = false; }
    }
    tick(now) {
      this.raf = requestAnimationFrame(this.tick);
      const interval = this.mode === "paused" ? 1000 / 12 : 1000 / 30;
      if (now - this.last < interval - 2) return;
      const dt = Math.min((now - this.last) / 1000, 0.1); this.last = now;
      this.e += (this.eT - this.e) * Math.min(1, dt * 2.5);
      this.t += dt * (0.2 + 0.9 * this.e);
      if (this.mode === "complete") this.burstT += dt;
      this.step(dt); this.drawFrame();
      if (!this.needsLoop()) this.sync();
    }

    // ---------- simulation ----------
    step(dt) {
      const sp = 0.3 + this.e * 1.4;
      for (const n of this.nodes) {
        n.x += n.vx * dt * sp; n.y += n.vy * dt * sp;
        if (n.x < 0 || n.x > 1) { n.vx = -n.vx; n.x = Math.min(1, Math.max(0, n.x)); }
        if (n.y < 0 || n.y > 1) { n.vy = -n.vy; n.y = Math.min(1, Math.max(0, n.y)); }
      }
      for (const p of this.parts) p.a += p.w * dt * sp;
      for (const l of this.lanes) for (let i = 0; i < 3; i++) l.pk[i] = (l.pk[i] + l.sp * dt * sp) % 1;
      // neural pulses
      if (this.mode === "running" && this.pulses.length < 10 && Math.random() < dt * 5 * this.e) {
        const a = (Math.random() * this.nodes.length) | 0, b = (Math.random() * this.nodes.length) | 0; if (a !== b) this.pulses.push({ a, b, p: 0, s: rnd(0.5, 1.1) });
      }
      for (const q of this.pulses) q.p += q.s * dt; this.pulses = this.pulses.filter(q => q.p < 1);
      // energy waves from the ring
      if (this.mode === "running") { this.waveT += dt; if (this.waveT > 1.6 / (0.4 + this.e)) { this.waveT = 0; this.waves.push({ r: this.R * 0.95 }); } }
      const maxW = Math.min(this.w, this.h) * 0.9;
      for (const wv of this.waves) { if (wv.delay > 0) { wv.delay -= dt; continue; } wv.r += dt * (wv.big ? 300 : 55 + 40 * this.e); }
      this.waves = this.waves.filter(wv => wv.r < (wv.big ? Math.max(this.w, this.h) * 0.8 : maxW));
      for (const b of this.burst) { b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.975; b.vy *= 0.975; b.life -= dt; }
      this.burst = this.burst.filter(b => b.life > 0);
    }

    // ---------- drawing ----------
    drawFrame() {
      const c = this.ctx, w = this.w, h = this.h; if (!w || !h) return;
      const pal = this.pal || PAL.idle; this.pal = pal;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, w, h);
      c.globalCompositeOperation = "source-over";
      this.drawGrid(c, pal); this.drawStreams(c, pal); this.drawNodes(c, pal);
      c.globalCompositeOperation = "lighter";
      this.drawParticles(c, pal); this.drawWaves(c, pal); this.drawAtom(c, pal); this.drawBurst(c);
      c.globalCompositeOperation = "source-over";
    }

    // Einstein-style space-time sheet: grid pulled toward a central mass, with gravitational-wave ripples.
    drawGrid(c, pal) {
      const { w, h, cx, cy, e, t } = this, s = Math.min(w, h) * 0.3, s2 = s * s, well = 0.4 + 0.25 * e, A = 1.5 + 7 * e, maxR = Math.hypot(w, h) / 2;
      c.lineWidth = 1; c.strokeStyle = "rgba(" + pal.acc + "," + (0.1 + 0.07 * e).toFixed(3) + ")"; c.beginPath();
      const rows = 11, cols = 17, seg = 26;
      const pt = (x, y, first) => {
        const dx = x - cx, dy = y - cy, r2 = dx * dx + dy * dy, r = Math.sqrt(r2) + 0.001, k = 1 - well / (1 + r2 / s2);
        const rip = A * Math.sin(r / 22 - t * 2.4) * Math.exp(-r / (maxR * 0.55));
        const px = cx + dx * k + dx / r * rip, py = cy + dy * k + dy / r * rip;
        first ? c.moveTo(px, py) : c.lineTo(px, py);
      };
      for (let i = 0; i <= rows; i++) for (let j = 0; j <= seg; j++) pt(w * j / seg, h * i / rows, j === 0);
      for (let i = 0; i <= cols; i++) for (let j = 0; j <= seg; j++) pt(w * i / cols, h * j / seg, j === 0);
      c.stroke();
    }

    // data streams: faint lanes with light packets flowing in toward the core
    drawStreams(c, pal) {
      const { w, h, cx, cy, e } = this, live = this.mode === "running" || this.mode === "complete";
      for (const l of this.lanes) {
        const x0 = l.sx * w, y0 = l.sy * h, mx = (x0 + cx) / 2, my = (y0 + cy) / 2 + l.bend * h;
        c.strokeStyle = "rgba(" + pal.acc + ",.07)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, cx, cy); c.stroke();
        if (!live && this.mode !== "paused") continue;
        for (const p of l.pk) {
          const u = p, v = 1 - u, x = v * v * x0 + 2 * v * u * mx + u * u * cx, y = v * v * y0 + 2 * v * u * my + u * u * cy;
          const u2 = Math.max(0, u - 0.05), v2 = 1 - u2, xt = v2 * v2 * x0 + 2 * v2 * u2 * mx + u2 * u2 * cx, yt = v2 * v2 * y0 + 2 * v2 * u2 * my + u2 * u2 * cy;
          const a = Math.sin(u * Math.PI) * (0.25 + 0.6 * e);
          c.strokeStyle = "rgba(" + pal.acc + "," + a.toFixed(3) + ")"; c.lineWidth = 1.6; c.beginPath(); c.moveTo(xt, yt); c.lineTo(x, y); c.stroke();
        }
      }
    }

    // neural-network: drifting nodes, proximity links, travelling activation pulses
    drawNodes(c, pal) {
      const { w, h, e } = this, L = Math.min(w, h) * 0.45, L2 = L * L, N = this.nodes, P = new Array(N.length);
      for (let i = 0; i < N.length; i++) P[i] = [N[i].x * w, N[i].y * h];
      c.lineWidth = 1;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d2 = dx * dx + dy * dy;
        if (d2 < L2) { c.strokeStyle = "rgba(" + pal.acc + "," + ((1 - Math.sqrt(d2) / L) * (0.12 + 0.22 * e)).toFixed(3) + ")"; c.beginPath(); c.moveTo(P[i][0], P[i][1]); c.lineTo(P[j][0], P[j][1]); c.stroke(); }
      }
      c.fillStyle = "rgba(" + pal.acc + "," + (0.35 + 0.4 * e).toFixed(2) + ")";
      for (let i = 0; i < N.length; i++) { c.beginPath(); c.arc(P[i][0], P[i][1], 1.8, 0, TAU); c.fill(); }
      c.globalCompositeOperation = "lighter";
      for (const q of this.pulses) {
        const a = P[q.a], b = P[q.b], x = a[0] + (b[0] - a[0]) * q.p, y = a[1] + (b[1] - a[1]) * q.p, s = 16, al = Math.sin(q.p * Math.PI);
        c.globalAlpha = al; c.drawImage(SPR[pal.spr[0]], x - s / 2, y - s / 2, s, s);
      }
      c.globalAlpha = 1;
    }

    drawParticles(c, pal) {
      const { w, h, cx, cy, e, t } = this, Rx = w * 0.5, Ry = h * 0.5;
      for (const p of this.parts) {
        const x = cx + Math.cos(p.a) * p.rad * Rx, y = cy + Math.sin(p.a) * p.rad * Ry * 0.7;
        const tw = 0.5 + 0.5 * Math.sin(t * 1.7 + p.ph), s = p.sz * (0.6 + 0.4 * tw);
        c.globalAlpha = (0.2 + 0.5 * tw) * (0.45 + 0.55 * e); c.drawImage(SPR[pal.spr[p.c % pal.spr.length]], x - s / 2, y - s / 2, s, s);
      }
      c.globalAlpha = 1;
    }

    drawWaves(c, pal) {
      for (const wv of this.waves) {
        if (wv.delay > 0) continue;
        const lim = wv.big ? Math.max(this.w, this.h) * 0.8 : Math.min(this.w, this.h) * 0.9, a = Math.max(0, 1 - wv.r / lim);
        c.strokeStyle = "rgba(" + pal.acc + "," + (a * (wv.big ? 0.6 : 0.3)).toFixed(3) + ")"; c.lineWidth = wv.big ? 2.2 : 1.4;
        c.beginPath(); c.arc(this.cx, this.cy, wv.r, 0, TAU); c.stroke();
      }
    }

    // Bohr-style atom: glowing nucleus with three tumbling electron orbits and trailing electrons
    drawAtom(c, pal) {
      const { cx, cy, e, t } = this, R = this.R * 0.76, ns = this.R * 0.55;
      c.globalAlpha = 0.5 + 0.3 * e; c.drawImage(SPR[pal.spr[0]], cx - ns, cy - ns, ns * 2, ns * 2); c.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const o = this.orbits[i], th = o.th + t * 0.18, ry = R * (o.k + 0.2 * Math.sin(t * 0.45 + o.ph)), ct = Math.cos(th), st = Math.sin(th);
        c.strokeStyle = "rgba(" + pal.acc + "," + (0.18 + 0.2 * e).toFixed(3) + ")"; c.lineWidth = 1;
        c.beginPath(); c.ellipse(cx, cy, R, Math.max(2, Math.abs(ry)), th, 0, TAU); c.stroke();
        for (let k = 0; k < 9; k++) {
          const f = t * o.w - k * 0.09 + o.ph, ex = R * Math.cos(f), ey = ry * Math.sin(f), x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct;
          const depth = 0.65 + 0.35 * Math.sin(f), s = (k === 0 ? 14 : 8) * depth;
          c.globalAlpha = (1 - k / 9) * (0.4 + 0.6 * depth); c.drawImage(SPR[pal.spr[(i + 1) % pal.spr.length]], x - s / 2, y - s / 2, s, s);
        }
        c.globalAlpha = 1;
      }
    }

    drawBurst(c) {
      for (const b of this.burst) { const s = 6 + 10 * (b.life / b.max); c.globalAlpha = Math.min(1, b.life / b.max * 1.4); c.drawImage(SPR[b.s], b.x - s / 2, b.y - s / 2, s, s); }
      c.globalAlpha = 1;
    }
  }

  root.ProgressFX = ProgressFX;
})(typeof self !== "undefined" ? self : this);
