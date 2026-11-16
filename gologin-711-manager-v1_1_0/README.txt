GoLogin + 711Proxy Manager  v1.1.0   (upgrade of "GoLogin 711 Proxy Assigner")

INSTALL (Chrome): 1) Unzip this folder. 2) Open chrome://extensions  3) Turn ON "Developer mode" (top right).
4) Click "Load unpacked" and choose the unzipped folder. 5) Click the extension icon to open the tool.

FIRST TEST: Settings tab -> tick "Test mode", Save. Overview -> Load GoLogin Profiles. Nothing real changes.
REAL TEST: untick Test mode, paste GoLogin token + 711 password, Save, Load profiles. Keep "Dry run" ON first and read the notes.
Then untick Dry run, tick "only first profile", press APPLY TO ALL PROFILES (or Apply on one row). Open that profile in GoLogin
and confirm the proxy username ends with the state.

WHICH PROFILES ARE UPDATED (changed in v1.1.0)
 Every profile that has a US state in its name is processed, whether or not it already has a proxy:
  - profile has NO proxy  -> a new state-matched 711 proxy is generated and assigned automatically (no setting needed)
  - profile HAS a proxy   -> the proxy is replaced (as before)
  - no state in the name  -> skipped, with the reason shown in the Profiles tab and recorded in Activity
 This applies to: Apply to All, Apply to Selected, single-row Apply, Start (Pending only) and Retry Failed.
 Each change is verified by re-reading the profile from GoLogin. If verification fails the previous proxy (or "no proxy") is restored
 and the failure is recorded in Activity with the full reason. Settings problems (e.g. missing 711 password) fail immediately with a clear message.
 The old "Also assign proxies to profiles that have no proxy yet" checkbox was removed because this is now the default.

PROGRESS PANEL (new in v1.1.0)
 Overview and Activity show a live "Quantum Core" panel: progress ring + percentage, the profile currently being processed, and live counts
 (Completed / Pending / Successful / Skipped / Failed). The orbits, space-time grid, equations and particles are decorative only; all numbers are real.
 It stops animating when the tab is hidden or the panel is off-screen, runs at 30fps max, and honours your OS "reduce motion" setting.

TEST MODE CHECK: Settings -> tick Test mode, untick Dry run, Save. Load profiles. Profile "Texas Profile 02" starts WITH a fake proxy, the others start
 with none; "Mystery Profile 05" has no state. APPLY TO ALL: the dialog shows how many get a NEW proxy vs REPLACED, and the Mystery profile is skipped.

COUNTRY / FLAG
 The country is read from the proxy username that is applied (e.g. ...-region-US-st-Florida). It is never guessed from host or
 profile names; if it cannot be read, "Unknown" is shown. GoLogin does not document an API field for the flag, so the tool cannot set it.
 After each apply it re-reads the proxy from GoLogin; if GoLogin's API reports a country it is compared, otherwise the row says
 "GoLogin API reports no country: flag not verified". Confirm the flag in the GoLogin app (open the proxy and press Check Proxy).
