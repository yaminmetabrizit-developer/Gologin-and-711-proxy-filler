const $ = id => document.getElementById(id);
const L = Lib;
const API = "https://api.gologin.com";
const FIELDS = ["token", "host", "port", "mode", "tpl", "pass"];
const S = {
  profiles: [], paused: false, stopped: false, running: false, loading: false, scanning: false,
  mockDB: {}, sel: new Set(), filter: { q: "", view: "all", country: "all" },
  run: { active: false, scope: new Set(), res: {} }, conn: "idle", connTxt: "Not connected", scanDone: 0, scanTotal: 0
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async k => (await chrome.storage.local.get(k))[k];
const set = (k, v) => chrome.storage.local.set({ [k]: v });
const secrets = () => [$("token").value, $("pass").value].filter(Boolean);
const clean = m => L.redact(m, secrets());
const STD = ["Success", "Failed", "Skipped", "Pending"];
const uiStatus = s => STD.includes(s) ? s : "Processing";   // Generating/Assigning/Verifying -> Processing

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function log(msg) {
  $("log").textContent += new Date().toLocaleTimeString() + "  " + clean(msg) + "\n";
  $("log").scrollTop = 1e9;
}
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = clean(msg); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 6000); }
function banner(kind, msg) { const b = $("banner"); if (!msg) { b.hidden = true; return; } b.className = "banner " + kind; b.textContent = clean(msg); b.hidden = false; }

// ---------------- GoLogin API (original logic + auth / 5xx / network handling) ----------------
async function gl(path, opts = {}) {
  if ($("mock").checked) return mockApi(path, opts);
  for (let i = 0; i < 4; i++) {
    let r;
    try {
      r = await fetch(API + path, {
        ...opts,
        headers: { Authorization: "Bearer " + $("token").value.trim(), "Content-Type": "application/json" }
      });
    } catch (e) {
      if (i < 3) { log("Network error, retrying…"); await sleep(2000 * (i + 1)); continue; }
      throw new Error("Network error: " + e.message);
    }
    if (r.status === 429) { log("GoLogin rate limit, waiting 10s"); await sleep(10000); continue; }
    if (r.status === 401 || r.status === 403) {
      const e = new Error("GoLogin rejected the token (HTTP " + r.status + "). Token expired or invalid."); e.auth = true; throw e;
    }
    if (r.status >= 500 && i < 3) { log("GoLogin server error " + r.status + ", retrying…"); await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) throw new Error("GoLogin " + r.status + " at " + path.split("?")[0] + " " + (await r.text()).slice(0, 150));
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
  throw new Error("Rate limited too long");
}

// Original Test mode (opt-in, off by default). Never used unless "Test mode" is ticked.
function mockApi(path, opts) {
  if (path.startsWith("/browser/v2")) {
    return path.includes("page=1") ? { profiles: ["Florida - Profile 01", "Texas Profile 02", "New York - Account 03",
      "CA Profile 04", "Mystery Profile 05"].map((n, i) => ({ id: "mock" + i, name: n })) } : { profiles: [] };
  }
  const id = (path.match(/\/browser\/([^/]+)/) || [])[1];
  if (opts.method === "PATCH") { const b = JSON.parse(opts.body).proxies[0]; S.mockDB[b.profileId] = b.proxy; return {}; }
  const seeded = id === "mock1" ? { mode: "http", host: "old-proxy.example.test", port: 8000, username: "old-user-Texas", password: "x" } : { mode: "none" };
  return { id, proxy: S.mockDB[id] || seeded };   // mock1 starts WITH a proxy, the others start with none
}

// ---------------- settings ----------------
async function loadSettings() {
  const s = (await get("settings")) || {};
  for (const f of FIELDS) if (s[f] !== undefined) $(f).value = s[f];
  $("aliases").value = JSON.stringify((await get("aliases")) || DEFAULT_ALIASES);
  updateIndicators();
}
$("save").onclick = async () => {
  const s = {}; for (const f of FIELDS) s[f] = $(f).value.trim();
  await set("settings", s);
  try { await set("aliases", JSON.parse($("aliases").value)); } catch { alert("State rules JSON is invalid"); return; }
  log("Settings saved."); toast("Settings saved."); updateIndicators(); render();
};

// ---------------- helpers ----------------
function buildProxy(state) {            // unchanged from the original
  const session = Math.random().toString(36).slice(2, 10);
  const user = $("tpl").value.replace("{state}", state.replace(/\s+/g, "")).replace("{session}", session);
  const cfgErr = m => Object.assign(new Error(m), { config: true });   // settings problem: retrying cannot help
  if (user.includes("{")) throw cfgErr("Username template has an unknown {placeholder}");
  const port = parseInt($("port").value, 10);
  if (!$("host").value || !port || !user || !$("pass").value) throw cfgErr("711 settings incomplete: fill in host, port, username template and 711 password in Settings");
  return { mode: $("mode").value.trim() || "http", host: $("host").value.trim(), port, username: user,
           password: $("pass").value };
}
async function proxyOf(id) { const d = await gl("/browser/" + id); return d.proxy || { mode: "none" }; }
const same = (a, b) => a.mode === b.mode && a.host === b.host && +a.port === +b.port && a.username === b.username;
const push = (id, proxy) => gl("/browser/proxy/many/v2", { method: "PATCH", body: JSON.stringify({ proxies: [{ profileId: id, proxy }] }) });

// eligibility: a profile only needs a state in its name. Profiles with NO proxy yet are assigned one automatically;
// profiles that already have a proxy have it replaced (the live proxy is always read before writing).
const eligible = p => L.isEligible(p);
function skipReason(p) {
  if (!p.state) return p.note || "No state found in profile name";
  return "";
}
function setCurrent(p, pr) {
  p.hasProxy = L.hasProxy(pr); p.cur = L.proxyLabel(pr);
  p.country = p.hasProxy ? L.detectCountryCode(pr.username) : null;
}

// ---------------- connection / indicators ----------------
function updateIndicators() {
  const cls = (id, c, t) => { $(id).className = "dot " + c; $(id + "-t").textContent = t; };
  cls("ind-gl", S.conn === "ok" ? "ok" : S.conn === "bad" ? "bad" : "", S.connTxt);
  const ok711 = $("host").value && parseInt($("port").value, 10) && $("tpl").value && $("pass").value;
  cls("ind-711", ok711 ? "ok" : "warn", ok711 ? $("host").value.trim() + ":" + $("port").value.trim() : "Incomplete — see Settings");
  cls("ind-scan", S.scanning ? "proc" : (S.scanTotal && S.scanDone >= S.scanTotal ? "ok" : ""),
      S.scanning ? "Scanning " + S.scanDone + " / " + S.scanTotal : (S.scanTotal ? (S.scanDone >= S.scanTotal ? "Done" : "Interrupted " + S.scanDone + " / " + S.scanTotal) : "Idle"));
  $("conn").querySelector(".dot").className = "dot " + (S.conn === "ok" ? "ok" : S.conn === "bad" ? "bad" : "");
  $("connTxt").textContent = S.conn === "ok" ? "GoLogin connected" : S.conn === "bad" ? "Token rejected" : "Not connected";
}
function authFail(e) {
  S.conn = "bad"; S.connTxt = "Token rejected";
  banner("bad", e.message + " Update it in Settings, then click Load GoLogin Profiles.");
  updateIndicators();
}

// ---------------- load profiles + scan current proxies ----------------
async function loadProfiles() {
  if (S.running || S.loading) return;
  S.loading = true; $("load").disabled = true; banner("", "");
  let loaded = false;
  try {
    let aliases = {}; try { aliases = JSON.parse($("aliases").value); } catch {}
    const prog = (await get("progress")) || {}, meta = (await get("meta")) || {};
    const seen = new Map();
    for (let page = 1; page <= 100; page++) {
      const d = await gl("/browser/v2?page=" + page);
      const list = d.profiles || d.data || [];
      const fresh = list.filter(p => !seen.has(p.id));
      if (!fresh.length) break;
      fresh.forEach(p => seen.set(p.id, p));
      await sleep(300);
    }
    S.profiles = [...seen.values()].map(p => {
      const r = detectState(p.name, aliases);
      const old = prog[p.id];
      const o = { id: p.id, name: p.name, state: r.state, status: r.state ? (old || "Pending") : "Skipped",
                  note: r.error || "", hasProxy: undefined, cur: "", country: null, updated: (meta[p.id] || {}).t || 0 };
      if (p.proxy && typeof p.proxy === "object" && p.proxy.mode !== undefined) setCurrent(o, p.proxy);
      return o;
    });
    S.sel.clear(); S.conn = "ok"; S.connTxt = "Connected · " + S.profiles.length + " profiles";
    log("Loaded " + S.profiles.length + " profiles.");
    render(); loaded = true;
  } catch (e) {
    if (e.auth) authFail(e); else banner("bad", "Load failed: " + e.message);
    log("Load failed: " + e.message);
  } finally { S.loading = false; $("load").disabled = false; render(); }
  if (loaded) scan();   // not awaited: fills in current proxy / country in the background
}
async function scan() {
  if (S.scanning || S.running) return;
  const todo = S.profiles.filter(p => p.hasProxy === undefined);
  S.scanning = true; S.scanDone = 0; S.scanTotal = todo.length; updateIndicators();
  for (const p of todo) {
    if (S.running || S.loading) break;       // a run always has priority over scanning
    try { setCurrent(p, await proxyOf(p.id)); }
    catch (e) { if (e.auth) { authFail(e); break; } p.note = "Scan failed: " + e.message; }
    S.scanDone++; render(); await sleep(350);
  }
  S.scanning = false; updateIndicators(); render();
}

// ---------------- apply one profile (original verify/rollback logic + country) ----------------
async function processOne(p) {
  const dry = $("dry").checked;
  const reason = skipReason(p);
  if (reason) { p.note = reason; return "Skipped"; }
  const proxy = buildProxy(p.state);
  p.newLabel = L.proxyLabel(proxy);
  const country = L.detectCountryCode(proxy.username);       // from the username actually applied; null => Unknown
  if (dry) {
    p.note = "Dry run: would " + (p.hasProxy === false ? "assign a NEW proxy (profile has none) using " : "use ") + p.state + " on " + proxy.host + " as " + proxy.username;
    return "Pending";
  }
  p.status = "Generating Proxy"; render();
  p.status = "Assigning Proxy"; render();
  const before = await proxyOf(p.id);
  p.prev = L.proxyLabel(before);                 // "No proxy" when the profile had none
  const hadNone = !L.hasProxy(before);           // no proxy yet -> assign a new one (default behaviour)
  await push(p.id, proxy);
  p.status = "Verifying"; render();
  const after = await proxyOf(p.id);
  if (same(after, proxy)) {
    p.note = hadNone ? "Profile had no proxy: new " + p.state + " proxy assigned" : ""; setCurrent(p, after); p.country = country;
    const g = L.probeGoLoginCountry(after);
    p.glCheck = !country ? "na" : g ? (g === country ? "ok" : "bad") : "na"; p.glCode = g;
    return "Success";
  }
  let rb = "";
  try { await push(p.id, hadNone ? { mode: "none" } : before); }      // rollback: restore the previous proxy (or "no proxy")
  catch (e) { if (e.auth) throw e; rb = " | ROLLBACK FAILED: " + e.message; }
  const show = x => JSON.stringify({ mode: x.mode, host: x.host, port: x.port, username: x.username, keys: Object.keys(x) });
  throw new Error("Verification failed. BEFORE " + show(before) + " | SENT " + show({ ...proxy, password: undefined }) + " | AFTER " + show(after) + rb);
}

// ---------------- history ----------------
async function addHistory(e) {
  const h = (await get("history")) || [];
  h.unshift(e); await set("history", h.slice(0, 1000));
}
async function renderHistory() {
  const h = (await get("history")) || [];
  const tb = $("hist"); tb.innerHTML = "";
  for (const e of h.slice(0, 200)) {
    const tr = el("tr");
    const ci = L.countryInfo(e.country);
    const cells = [new Date(e.t).toLocaleString(), e.name + "  [" + e.id + "]", e.prev || "—", e.next || "—",
                   ci ? ci.flag + " " + ci.name + " (" + ci.code + ")" : "Unknown"];
    for (const v of cells) tr.appendChild(el("td", v === cells[1] ? "pn" : "", v));
    const tdR = el("td"); tdR.appendChild(el("span", "badge b-" + e.result, e.result)); tr.appendChild(tdR);
    tr.appendChild(el("td", "sm2", e.detail || ""));
    tb.appendChild(tr);
  }
  $("histEmpty").hidden = h.length > 0;
}
const saveProgress = () => set("progress", Object.fromEntries(S.profiles.map(p =>
  [p.id, p.status === "Skipped" && p.state ? "Pending" : (STD.includes(p.status) ? p.status : "Pending")])));
const saveMeta = async () => set("meta", Object.fromEntries(S.profiles.filter(p => p.updated).map(p => [p.id, { t: p.updated }])));

// ---------------- run queue (sequential; one run at a time) ----------------
async function runQueue(list, scope) {
  if (S.running) { toast("An operation is already running."); return; }
  if (S.loading) { toast("Profiles are still loading."); return; }
  if ($("onlyN").checked) { list = list.slice(0, 1); scope = list; }
  S.running = true; S.stopped = false; S.paused = false; banner("", "");
  const dry = $("dry").checked, inList = new Set(list.map(p => p.id));
  S.run = { active: true, scope: new Set(scope.map(p => p.id)), res: {}, current: null, dry, mock: $("mock").checked };
  for (const p of scope) if (!inList.has(p.id)) {
    S.run.res[p.id] = "Skipped";
    const why = skipReason(p) || (p.status === "Success" ? "Already updated" : "Not selected for this run");
    addHistory({ t: Date.now(), id: p.id, name: p.name, prev: p.cur || "", next: "", country: p.country, result: "Skipped", detail: why });
  }
  render();
  let authAbort = false;
  for (const p of list) {
    while (S.paused && !S.stopped) await sleep(500);
    if (S.stopped) { log("Stopped."); break; }
    const prev = p.status; p.prev = ""; p.newLabel = ""; p.glCheck = undefined; S.run.current = p;
    let result = null, err = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { result = await processOne(p); err = null; break; }
      catch (e) {
        err = e; log(p.name + " attempt " + attempt + ": " + e.message);
        if (e.auth) { authAbort = true; break; }
        if (e.config) break;                       // settings problem: fail fast with a clear message
        if (attempt < 3) { p.status = "Pending"; await sleep(3000 * attempt); }
      }
    }
    if (authAbort) { p.status = prev; authFail(err); break; }
    if (err) { p.status = "Failed"; p.note = err.message; result = "Failed"; }
    else if (dry) { p.status = prev; result = "Skipped"; }
    else { p.status = result; if (result === "Success") p.updated = Date.now(); }
    log(p.name + ": " + result + (p.note ? " — " + p.note.slice(0, 120) : ""));
    S.run.res[p.id] = result;
    addHistory({ t: Date.now(), id: p.id, name: p.name, prev: p.prev || p.cur || "", next: p.newLabel || "",
                 country: p.country, result, detail: clean(p.note || "") });
    render(); await saveProgress(); await saveMeta(); await sleep(1500);
  }
  S.running = false; S.run.active = false; S.run.current = null;
  const c = k => Object.values(S.run.res).filter(v => v === k).length;
  const msg = "Run finished — Success: " + c("Success") + ", Failed: " + c("Failed") + ", Skipped: " + c("Skipped") +
              ", Pending: " + (S.run.scope.size - Object.keys(S.run.res).length);
  log(msg); toast(msg);
  if (!authAbort) banner(c("Failed") ? "warn" : "ok", msg + (c("Failed") ? " — use Retry Failed to try the failed profiles again." : ""));
  render(); renderHistory();
}

// ---------------- confirmation dialog ----------------
function confirmDialog({ title, build, withReapply }) {
  return new Promise(resolve => {
    const dlg = $("dlg"), re = $("dlgReapply");
    $("dlgTitle").textContent = title; re.checked = false; $("dlgReapplyWrap").hidden = !withReapply;
    const draw = () => {
      const b = build(re.checked), t = document.createElement("table");
      for (const [k, v] of b.rows) { const tr = el("tr"); tr.appendChild(el("td", "", k)); tr.appendChild(el("td", "", String(v))); t.appendChild(tr); }
      $("dlgBody").replaceChildren(t);
      $("dlgWarn").textContent = b.warn || ""; $("dlgYes").disabled = !b.count;
    };
    re.onchange = draw; draw();
    const done = ok => { dlg.onclose = null; if (dlg.open) dlg.close(); resolve(ok ? { reapply: re.checked } : null); };
    $("dlgYes").onclick = () => done(true); $("dlgNo").onclick = () => done(false); dlg.onclose = () => done(false);
    dlg.showModal();
  });
}
function modeWarn() {
  return $("mock").checked ? "Test mode is ON: no real changes." : $("dry").checked ? "Dry run is ON: nothing will be changed."
    : "This will CHANGE the proxy on real GoLogin profiles.";
}

async function applyAll() {
  if (S.running) return toast("An operation is already running.");
  if (!S.profiles.length) return alert("Click Load GoLogin Profiles first.");
  const res = await confirmDialog({
    title: "Apply to all profiles", withReapply: true,
    build: re => {
      const P = S.profiles, noState = P.filter(p => !p.state).length;
      const done = re ? 0 : P.filter(p => eligible(p) && p.status === "Success").length;
      const run = P.filter(p => eligible(p) && (re || p.status !== "Success"));
      const fresh = run.filter(p => p.hasProxy === false).length, repl = run.filter(p => p.hasProxy === true).length;
      const unk = run.filter(p => p.hasProxy === undefined).length;
      return { count: run.length, rows: [["Total profiles detected", P.length], ["Eligible profiles", run.length],
        ["…no proxy yet → new proxy assigned", fresh], ["…existing proxy → replaced", repl],
        ["…not scanned yet (checked live before writing)", unk],
        ["Skipped — no state in name", noState], ["Skipped — already updated", done]], warn: modeWarn() };
    }
  });
  if (!res) return;
  const list = S.profiles.filter(p => eligible(p) && (res.reapply || p.status !== "Success"));
  if (!(await confirmFirstTime())) return;     // Cancel on the one-time real-change warning must NOT start the run
  runQueue(list, S.profiles);
}
async function applySelected() {
  const chosen = S.profiles.filter(p => S.sel.has(p.id));
  if (!chosen.length) return;
  const res = await confirmDialog({
    title: "Apply to selected profiles",
    build: () => { const el_ = chosen.filter(eligible), e = el_.length;
      return { count: e, rows: [["Selected", chosen.length], ["Eligible", e],
        ["…no proxy yet → new proxy assigned", el_.filter(p => p.hasProxy === false).length],
        ["…existing proxy → replaced", el_.filter(p => p.hasProxy === true).length],
        ["Skipped — no state in name", chosen.length - e]], warn: modeWarn() }; }
  });
  if (!res) return;
  if (!(await confirmFirstTime())) return;
  runQueue(chosen.filter(eligible), chosen);   // ONLY the selected profiles are ever touched
}
async function applyOne(p) {
  if (S.running) return toast("An operation is already running.");
  if (!eligible(p)) return toast(skipReason(p) || "Profile is not eligible.");
  if (!(await confirmFirstTime())) return;
  runQueue([p], [p]);
}
// original one-time warning before the very first real change
async function confirmFirstTime() {
  if (!$("dry").checked && !$("mock").checked && !(await get("confirmed"))) {
    if (!confirm("This will CHANGE the proxy on your real GoLogin profiles. Continue?")) return false;
    await set("confirmed", true);
  }
  return true;
}

// ---------------- render ----------------
let rt = null;
function render() { if (!rt) rt = setTimeout(() => { rt = null; doRender(); }, 30); }
function doRender() {
  const st = L.stats(S.profiles), P = S.profiles;
  $("st-total").textContent = st.total; $("st-with").textContent = st.withProxy; $("st-without").textContent = st.withoutProxy;
  $("st-success").textContent = st.success; $("st-failed").textContent = st.failed;
  $("elig").textContent = P.filter(eligible).length; $("eligTotal").textContent = P.length;
  const busy = S.running || S.loading;
  for (const id of ["applyAll", "start", "retry", "load"]) $(id).disabled = busy;
  $("rescan").disabled = busy || S.scanning;
  renderProgress(); updateIndicators();

  // country filter options (only real detected countries + Unknown)
  const codes = [...new Set(P.map(p => p.country).filter(Boolean))].sort();
  const cf = $("fCountry"), cur = S.filter.country;
  cf.replaceChildren(new Option("All countries", "all"));
  for (const c of codes) { const i = L.countryInfo(c); cf.appendChild(new Option((i ? i.flag + " " + i.name : c) + " (" + c + ")", c)); }
  if (P.some(p => !p.country)) cf.appendChild(new Option("Unknown", "unknown"));
  cf.value = [...cf.options].some(o => o.value === cur) ? cur : "all"; S.filter.country = cf.value;

  const rows = L.applyFilters(P, S.filter), tb = $("rows"); tb.replaceChildren();
  for (const id of [...S.sel]) { const p = P.find(x => x.id === id); if (!p || !eligible(p)) S.sel.delete(id); }
  for (const p of rows) {
    const tr = el("tr"), ok = eligible(p);
    const c0 = el("td", "c"), cb = el("input"); cb.type = "checkbox"; cb.checked = S.sel.has(p.id); cb.disabled = !ok || busy;
    cb.title = ok ? "" : (skipReason(p) || "Not eligible");
    cb.onchange = () => { cb.checked ? S.sel.add(p.id) : S.sel.delete(p.id); updateSel(); };
    c0.appendChild(cb); tr.appendChild(c0);
    const c1 = el("td"); c1.appendChild(el("div", "pn", p.name));
    c1.appendChild(el("div", "sm2", p.state ? "Match → " + p.state : (p.note || "No state found"))); tr.appendChild(c1);
    tr.appendChild(el("td", "mono", p.id));
    const c3 = el("td"), ci = L.countryInfo(p.country);
    if (ci) { c3.appendChild(el("span", "flag", ci.flag)); c3.appendChild(document.createTextNode(ci.name)); c3.appendChild(el("span", "cc", ci.code)); }
    else c3.appendChild(el("span", "muted", "Unknown"));
    if (p.glCheck) c3.appendChild(el("div", "gl " + p.glCheck, p.glCheck === "ok" ? "GoLogin reports the same country ✓" :
      p.glCheck === "bad" ? "GoLogin reports " + p.glCode + " — differs" : "GoLogin API reports no country: flag not verified"));
    tr.appendChild(c3);
    const c4 = el("td"); c4.appendChild(el("div", "", p.hasProxy === undefined ? "Not scanned yet" : (p.hasProxy ? p.cur : "No proxy")));
    tr.appendChild(c4);
    const c5 = el("td"), us = uiStatus(p.status); c5.appendChild(el("span", "badge b-" + us, us));
    if (p.note && (p.status === "Failed" || p.status === "Skipped" || p.status === "Pending")) { const n = el("div", "sm2", p.note.slice(0, 70)); n.title = p.note; c5.appendChild(n); }
    tr.appendChild(c5);
    tr.appendChild(el("td", "sm2", p.updated ? new Date(p.updated).toLocaleString() : "—"));
    const c7 = el("td"), b = el("button", "btn ghost sm", p.status === "Failed" ? "Retry" : "Apply");
    b.disabled = !ok || busy; b.title = ok ? "" : (skipReason(p) || ""); b.onclick = () => applyOne(p); c7.appendChild(b); tr.appendChild(c7);
    tb.appendChild(tr);
  }
  $("empty").hidden = P.length > 0; $("shownCount").textContent = rows.length;
  $("selHead").disabled = busy; updateSel(); 
}
function updateSel() {
  $("selCount").textContent = S.sel.size; $("applySel").disabled = !S.sel.size || S.running || S.loading;
  const vis = L.applyFilters(S.profiles, S.filter).filter(eligible);
  $("selHead").checked = vis.length > 0 && vis.every(p => S.sel.has(p.id));
}
// Progress panel: persistent animated components (see progress-fx.js). They only DISPLAY the real run numbers below.
const fxPanels = typeof ProgressFX === "function" ? [...document.querySelectorAll("[data-prog]")].map(b => new ProgressFX(b)) : [];
const STEP_TXT = { "Pending": "Preparing", "Generating Proxy": "Generating proxy", "Assigning Proxy": "Assigning proxy", "Verifying": "Verifying proxy", "Success": "Done ✓" };
function renderProgress() {
  const total = S.run.scope.size, r = Object.values(S.run.res), c = k => r.filter(v => v === k).length;
  const done = r.length, cur = S.run.current;
  const model = {
    total, done, pending: Math.max(0, total - done), success: c("Success"), failed: c("Failed"), skipped: c("Skipped"),
    active: S.run.active, paused: S.paused, dry: !!S.run.dry, mock: !!S.run.mock,
    current: cur ? cur.name + " · " + (STEP_TXT[cur.status] || cur.status) + (cur.hasProxy === false ? " · new proxy" : "") : ""
  };
  for (const f of fxPanels) f.update(model);
}

// ---------------- wiring ----------------
function showView(v) {
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  if (v === "activity") renderHistory();
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => showView(b.dataset.view));
$("gotoSettings").onclick = () => showView("settings");
$("load").onclick = loadProfiles;
$("rescan").onclick = () => { S.profiles.forEach(p => { p.hasProxy = undefined; }); render(); scan(); };
$("applyAll").onclick = applyAll;
$("applySel").onclick = applySelected;
$("start").onclick = async () => {        // original "Start Automation": all Pending profiles with a detected state
  if (S.running) return;
  if (!S.profiles.length) { alert("Click Load GoLogin Profiles first."); return; }
  if (!(await confirmFirstTime())) return;
  const todo = S.profiles.filter(p => p.status === "Pending" && p.state);
  runQueue(todo, todo);
};
$("pause").onclick = () => { S.paused = true; log("Paused."); render(); };
$("resume").onclick = () => { S.paused = false; log("Resumed."); render(); };
$("stop").onclick = () => { S.stopped = true; };
$("retry").onclick = () => {
  const failed = S.profiles.filter(p => p.status === "Failed");
  if (!failed.length) return toast("No failed profiles to retry.");
  failed.forEach(p => { p.status = "Pending"; p.note = ""; });
  runQueue(failed.filter(eligible), failed);
};
$("search").oninput = e => { S.filter.q = e.target.value; render(); };
$("fView").onchange = e => { S.filter.view = e.target.value; render(); };
$("fCountry").onchange = e => { S.filter.country = e.target.value; render(); };
$("selAll").onclick = () => { L.applyFilters(S.profiles, S.filter).filter(eligible).forEach(p => S.sel.add(p.id)); render(); };
$("selNone").onclick = () => { S.sel.clear(); render(); };
$("selHead").onchange = e => {
  const vis = L.applyFilters(S.profiles, S.filter).filter(eligible);
  vis.forEach(p => e.target.checked ? S.sel.add(p.id) : S.sel.delete(p.id)); render();
};
$("clearHist").onclick = async () => { await set("history", []); renderHistory(); toast("Activity cleared."); };
for (const f of FIELDS) $(f).addEventListener("input", updateIndicators);
loadSettings().then(() => { render(); renderHistory(); });
