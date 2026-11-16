// Pure helper functions (no DOM, no chrome.* APIs) so they can be unit-tested in Node.
(function (root) {
  // Country is read ONLY from the proxy username that is actually applied/configured, e.g.
  // "...-region-US-st-Florida". It is never guessed from host names or profile names.
  const CC_RE = /(?:^|[-_.:;])(?:region|country|cc|cr)[-_.:]([A-Za-z]{2})(?![A-Za-z])/i;
  let names = null;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { names = null; }

  function detectCountryCode(username) {
    const m = CC_RE.exec(username || "");
    return m ? m[1].toUpperCase() : null;
  }
  function flagEmoji(code) {
    if (!/^[A-Z]{2}$/.test(code || "")) return "";
    return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  // Returns {code,name,flag} or null when the code is not a real ISO 3166-1 alpha-2 region.
  function countryInfo(code) {
    if (!/^[A-Z]{2}$/.test(code || "")) return null;
    let name = null;
    try { name = names ? names.of(code) : null; } catch (e) { return null; }
    if (!name || name === code || /unknown region/i.test(name)) return null;
    return { code, name, flag: flagEmoji(code) };
  }
  const hasProxy = p => !!(p && p.mode && p.mode !== "none");
  const proxyLabel = p => !hasProxy(p) ? "No proxy" :
    (p.host || "?") + (p.port ? ":" + p.port : "") + (p.username ? " (" + p.username + ")" : "");
  // GoLogin may or may not report a country on the proxy object. Read-only probe, never written.
  function probeGoLoginCountry(proxy) {
    if (!proxy) return null;
    for (const k of ["country", "countryCode", "country_code"]) {
      const v = proxy[k];
      if (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim())) return v.trim().toUpperCase();
    }
    return null;
  }
  function redact(msg, secrets) {
    msg = String(msg);
    for (const s of secrets || []) if (s) msg = msg.split(s).join("***");
    return msg;
  }
  const isEligible = p => !!p.state;
  function applyFilters(profiles, f) {
    const q = (f.q || "").trim().toLowerCase();
    return profiles.filter(p => {
      if (q && !(p.name || "").toLowerCase().includes(q) && !(p.id || "").toLowerCase().includes(q)) return false;
      if (f.country && f.country !== "all") {
        if (f.country === "unknown") { if (p.country) return false; }
        else if (p.country !== f.country) return false;
      }
      switch (f.view) {
        case "with": return p.hasProxy === true;
        case "without": return p.hasProxy === false;
        case "success": return p.status === "Success";
        case "failed": return p.status === "Failed";
        default: return true;
      }
    });
  }
  function stats(profiles) {
    const c = fn => profiles.filter(fn).length;
    return {
      total: profiles.length,
      withProxy: c(p => p.hasProxy === true),
      withoutProxy: c(p => p.hasProxy === false),
      success: c(p => p.status === "Success"),
      failed: c(p => p.status === "Failed")
    };
  }
  const api = { detectCountryCode, flagEmoji, countryInfo, hasProxy, proxyLabel, probeGoLoginCountry,
                redact, isEligible, applyFilters, stats };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Lib = api;
})(typeof self !== "undefined" ? self : this);
