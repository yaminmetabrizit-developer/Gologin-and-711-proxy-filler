// Full state names. Abbreviations below are matched only when written in CAPITALS (e.g. "CA").
const STATE_ABBR = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",
  DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",
  MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",
  WI:"Wisconsin",WY:"Wyoming"
};
// Extra custom rules you can edit in the app: { "alias text": "State Name" }
const DEFAULT_ALIASES = { "NYC": "New York" };

function detectState(name, aliases) {
  const found = new Set();
  let text = " " + name + " ";
  const all = {};
  for (const s of Object.values(STATE_ABBR)) all[s.toLowerCase()] = s;
  for (const [k, v] of Object.entries(aliases || {})) all[k.toLowerCase()] = v;
  const keys = Object.keys(all).sort((a, b) => b.length - a.length); // longest first
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?<![A-Za-z])" + esc + "(?![A-Za-z])", "gi");
    if (re.test(text)) { found.add(all[k]); text = text.replace(re, " "); }
  }
  for (const tok of text.match(/(?<![A-Za-z])[A-Z]{2}(?![A-Za-z])/g) || []) {
    if (STATE_ABBR[tok]) found.add(STATE_ABBR[tok]);
  }
  if (found.size === 1) return { state: [...found][0] };
  if (found.size > 1) return { error: "More than one state: " + [...found].join(", ") };
  return { error: "No state found" };
}
