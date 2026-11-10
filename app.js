/* FF Stat Hub — plain JS, no build step. Data comes from data/*.json written by ~/.atlas/bin/stathub. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const D = {};               // meta, players, stats, teams, news
let BY = {};                // id -> player
let F = {};                 // field name -> index
const LAST_FANTASY_WEEK = 18;   // rest of season = the whole regular season (his call 2026-11-09)
const PLAYOFFS = [15, 17];      // fantasy playoffs
const BOT = "https://t.me/Clutchclips_bot";

async function load(name) {
  // 10-minute cache key; if that copy is bad (e.g. a CDN-cached broken file), fetch a fresh one.
  try {
    const r = await fetch(`data/${name}.json?v=30&t=${Date.now() / 600000 | 0}`);
    if (!r.ok) throw new Error(name + " " + r.status);
    return await r.json();
  } catch (e) {
    const r = await fetch(`data/${name}.json?fresh=${Date.now()}`, {cache: "no-store"});
    if (!r.ok) throw new Error(name + " " + r.status);
    return r.json();
  }
}


/* ---------------- scoring: half PPR (the data's base), full PPR, standard ---------------- */
const SC = {half: [0, "half-PPR", "Half-PPR", "Half PPR"], ppr: [0.5, "full-PPR", "Full-PPR", "PPR"], std: [-0.5, "standard", "Standard", "Standard"]};
let SCORING = (() => { try { return localStorage.getItem("scoring") || "half"; } catch { return "half"; } })();
if (!SC[SCORING]) SCORING = "half";
const SCL = () => SC[SCORING][1], SCU = () => SC[SCORING][2];
function applyScoring() {
  const pi = D.meta.fields.indexOf("pts"), ri = D.meta.fields.indexOf("rec"), adj = SC[SCORING][0];
  if (!D.statsHalf) D.statsHalf = D.stats;
  D.stats = Object.fromEntries(Object.entries(D.statsHalf).map(([id, ws]) => [id, ws.map(w => { const x = w.slice(); x[pi] = Math.round((w[pi] + adj * (w[ri] || 0)) * 100) / 100; return x; })]));
  for (const p of D.players) {
    const ws = D.stats[p.id] || [];
    p.gp = ws.length; p.ppg = ws.length ? Math.round(ws.reduce((a, w) => a + w[pi], 0) / ws.length * 10) / 10 : 0;
  }
  D.players.sort((a, b) => b.ppg - a.ppg || a.name.localeCompare(b.name));
  ROS_BY_RANK = null; SCF = {}; LEAGUE = null;
}
/* Expert projections are half-PPR; scale each player's by how his own season changes under the chosen scoring. */
let SCF = {};
function scF(id) {
  if (SCORING === "half" || !id) return 1;
  if (SCF[id] != null) return SCF[id];
  const pi = D.meta.fields.indexOf("pts");
  const h = (D.statsHalf[id] || []).reduce((a, w) => a + w[pi], 0), c = (D.stats[id] || []).reduce((a, w) => a + w[pi], 0);
  return (SCF[id] = h > 0 ? c / h : 1);
}

/* ---------------- helpers ---------------- */
const f1 = n => (n == null || !isFinite(n)) ? "–" : (Math.round(n * 10) / 10).toFixed(1);
const pct = n => (n == null || !isFinite(n)) ? "–" : Math.round(n * 100) + "%";
const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
function weeks(id) { return (D.stats[id] || []).map(w => Object.fromEntries(D.meta.fields.map((f, i) => [f, w[i]]))); }
function sum(ws, k) { return ws.reduce((a, w) => a + (w[k] || 0), 0); }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago"; return Math.round(s / 86400) + "d ago";
}
function when(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], {weekday: "short", hour: "numeric", minute: "2-digit"});
}
const OUT = new Set(["Out", "IR", "PUP", "Sus", "Suspended", "NA", "DNR"]);
function injBadge(p) {
  if (!p.inj) return "";
  const cls = OUT.has(p.inj) ? "b-out" : (p.inj === "Questionable" || p.inj === "Doubtful") ? "b-q" : "";
  return `<span class="badge ${cls}" title="${esc(p.injn)}">${esc(p.inj)}${p.injb ? " · " + esc(p.injb) : ""}</span>`;
}
function headUrl(u, size) {   // NFL's image server resizes on the fly: ~2 KB instead of ~700 KB per photo
  const px = Math.round(size * 2);
  return u.replace("/image/upload/f_auto,q_auto/", `/image/upload/f_auto,q_auto,w_${px},h_${px},c_fill,g_face/`);
}
function head(p, size = 36) {
  return p.head ? `<img src="${esc(headUrl(p.head, size))}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background:var(--panel2)" loading="lazy">`
                : `<span style="width:${size}px;height:${size}px;border-radius:50%;background:var(--panel2);display:inline-block;flex:none"></span>`;
}

/* ---------------- roster (localStorage only, never in the repo) ---------------- */
function roster() { try { return JSON.parse(localStorage.getItem("roster") || "[]"); } catch { return []; } }
function setRoster(ids) { try { localStorage.setItem("roster", JSON.stringify(ids)); } catch {} }
function matchName(name) {
  const n = norm(name); if (!n) return null;
  return D.players.find(p => norm(p.name) === n) || D.players.find(p => norm(p.name).startsWith(n)) ||
         D.players.find(p => norm(p.name).includes(n)) || null;
}

/* ---------------- search ---------------- */
// search: punctuation splits words ("Amon-Ra" -> "amon ra"), the joined form also matches ("amonra"),
// and a 1-letter typo is forgiven on words of 4+ letters. Exact prefix hits rank above typo hits.
const snorm = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]+/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, " ").replace(/\s+/g, " ").trim();
function near(a, b) {                       // edit distance <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; }     // swapped letters count as one typo
    else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
const NICK = {jsn: "jaxon smith njigba", cmc: "christian mccaffrey", arsb: "amon ra st brown", sunshine: "amon ra st brown", ajb: "aj brown", aj: "aj brown", tmac: "terry mclaurin", mhj: "marvin harrison", btj: "brian thomas", kw: "kenneth walker", bijan: "bijan robinson", jjj: "justin jefferson", jj: "justin jefferson", cd: "ceedee lamb", ceedee: "ceedee lamb", hollywood: "marquise brown", dk: "dk metcalf", tk: "travis kelce", ekeler: "austin ekeler", jt: "jonathan taylor", dhop: "deandre hopkins", nuk: "deandre hopkins", lamar: "lamar jackson", mahomes: "patrick mahomes", saquon: "saquon barkley"};
function search(q, limit = 8) {
  let n = snorm(q); if (!n) return [];
  if (NICK[n.replace(/ /g, "")]) n = NICK[n.replace(/ /g, "")];
  const parts = n.split(" "), joinedQ = n.replace(/ /g, "");
  const exact = [], fuzzy = [];
  for (const p of D.players) {
    const pn = p._s || (p._s = snorm(p.name)), words = p._w || (p._w = pn.split(" ")), joined = p._j || (p._j = pn.replace(/ /g, ""));
    if (parts.every(t => words.some(w => w.startsWith(t))) || joined.startsWith(joinedQ) || (joinedQ.length > 2 && joined.includes(joinedQ))) { exact.push(p); continue; }
    if (fuzzy.length < limit && parts.every(t => words.some(w => w.startsWith(t) || (t.length >= 4 && (near(t, w.slice(0, t.length)) || near(t, w.slice(0, t.length + 1)) || near(t, w.slice(0, t.length - 1))))))) fuzzy.push(p);
  }
  // last resort for multi-word searches: any player whose other name matches (e.g. "Travion Henderson")
  if (!exact.length && !fuzzy.length && parts.length > 1)
    for (const p of D.players) if (parts.some(t => t.length >= 4 && p._w.some(w => w === t || (w.length >= 5 && near(t, w))))) { fuzzy.push(p); if (fuzzy.length >= limit) break; }
  return exact.concat(fuzzy).slice(0, limit);   // players.json is sorted by ppg, so the best guesses come first
}
function attachSearch(input, box, onPick) {
  let sel = 0, res = [];
  // stop iPhone autocorrect/autocap from rewriting names as you type ("Amon" -> "Almond")
  for (const [k, v] of [["autocorrect", "off"], ["autocapitalize", "off"], ["autocomplete", "off"], ["spellcheck", "false"]]) input.setAttribute(k, v);
  const draw = () => {
    res = search(input.value);
    if (!res.length) { box.hidden = true; return; }
    box.innerHTML = res.map((p, i) => `<button type="button" role="option" class="${i === sel ? "on" : ""}" data-i="${i}">${head(p, 28)}<span><b>${esc(p.name)}</b> <span class="muted small">${p.pos} · ${p.team}</span> ${injBadge(p)}</span><span class="r">${p.gp ? f1(p.ppg) + " ppg" : ""}</span></button>`).join("");
    box.hidden = false;
  };
  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("keydown", e => {
    if (box.hidden) return;
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, res.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && res[sel]) { e.preventDefault(); pick(res[sel]); }
    else if (e.key === "Escape") box.hidden = true;
  });
  box.addEventListener("mousedown", e => e.preventDefault());
  box.addEventListener("click", e => { const b = e.target.closest("button"); if (b) pick(res[+b.dataset.i]); });
  input.addEventListener("blur", () => setTimeout(() => box.hidden = true, 150));
  function pick(p) { box.hidden = true; input.value = ""; input.blur(); onPick(p); }
}

/* ---------------- the numbers ---------------- */
function teamGames(team) { return (D.teams.sched[team] || []).filter(g => g[3]).map(g => g[0]); }
function summary(id) {
  const p = BY[id], ws = weeks(id);
  const tg = p ? teamGames(p.team) : [];
  const last4wk = tg.slice(-4);
  const l4 = ws.filter(w => last4wk.includes(w.wk));
  const s = agg(ws), r = agg(l4);
  return {p, ws, s, l4: r, gp: ws.length, l4gp: l4.length, teamGames: tg};
}
function agg(ws) {
  const g = ws.length || 0, t = k => sum(ws, k);
  const o = {g};
  for (const k of ["cmp","att","pyd","ptd","int","car","ryd","rtd","tgt","rec","recyd","rectd","fl","rzc","rzt","glc","glt","pts","snaps","tmc","tmt"]) o[k] = t(k);
  o.ppg = g ? o.pts / g : 0;
  o.snp = g ? sum(ws, "snp") / g / 100 : 0;
  o.ypc = o.car ? o.ryd / o.car : null;
  o.ypt = o.tgt ? o.recyd / o.tgt : null;
  o.cpct = o.att ? o.cmp / o.att : null;
  o.tshare = o.tmt ? o.tgt / o.tmt : 0;
  o.oshare = (o.tmc + o.tmt) ? (o.car + o.tgt) / (o.tmc + o.tmt) : 0;
  o.cshare = o.tmc ? o.car / o.tmc : 0;
  o.rz = o.rzc + o.rzt; o.gl = o.glc + o.glt;
  return o;
}
/* the share that matters for the position */
function share(pos, a) { return pos === "RB" ? a.oshare : pos === "QB" ? null : a.tshare; }

function nextGames(team, fromWk) {
  return (D.teams.sched[team] || []).filter(g => !g[3] && g[0] >= fromWk && g[0] <= LAST_FANTASY_WEEK).sort((a, b) => a[0] - b[0]);
}
function nextWeek() {
  // first week with an unplayed game anywhere
  let w = 99;
  for (const t in D.teams.sched) for (const g of D.teams.sched[t]) if (!g[3]) w = Math.min(w, g[0]);
  return w === 99 ? D.meta.week + 1 : w;
}
function matchupFactor(opp, pos) {
  const a = (D.teams.dvp[opp] || {})[pos], lg = D.teams.league[pos];
  if (!a || !lg) return {f: 1, allowed: null, lg};
  const raw = a / lg;
  return {f: Math.max(0.8, Math.min(1.2, 1 + (raw - 1) * 0.5)), allowed: a, lg};
}
function rank(opp, pos) {
  const arr = Object.entries(D.teams.dvp).map(([t, v]) => [t, v[pos] || 0]).sort((a, b) => b[1] - a[1]);
  const i = arr.findIndex(x => x[0] === opp);
  return i < 0 ? null : i + 1;   // 1 = gives up the most
}

/* Teammates at the same position: who's out (more work) and who's coming back (less). */
function roomInfo(id) {
  const p = BY[id]; if (!p) return {mates: [], adj: 1, notes: []};
  const ids = ((D.teams.rooms[p.team] || {})[p.pos] || []).filter(x => BY[x]);
  if (!ids.includes(id)) ids.push(id);
  const tg = teamGames(p.team), last = tg.slice(-1)[0], last4 = tg.slice(-4);
  const mates = ids.map(x => {
    const q = BY[x], ws = weeks(x).filter(w => w.team === p.team);
    const s = agg(ws), l4 = agg(ws.filter(w => last4.includes(w.wk)));
    const missedLast = ws.length > 0 && !ws.some(w => w.wk === last);
    return {q, s, l4, ws, missedLast};
  }).filter(m => m.ws.length || m.q.id === id || m.q.inj)
    .sort((a, b) => (b.l4.car + b.l4.tgt) - (a.l4.car + a.l4.tgt) || (b.s.car + b.s.tgt) - (a.s.car + a.s.tgt));
  const notes = []; let adj = 1;
  for (const m of mates) {
    if (m.q.id === id) continue;
    const sh = share(p.pos, m.s) ?? 0;
    const games = m.ws.length;
    if (games >= 2 && sh >= 0.18 && m.missedLast && !OUT.has(m.q.inj)) {
      adj *= 0.9;
      notes.push({t: `${m.q.name} looks set to return (${pct(sh)} share in ${games} games, ${m.q.inj || "no injury tag"}). Cuts into the work.`, f: 0.9, neg: true});
    } else if (sh >= 0.18 && (OUT.has(m.q.inj) || m.q.inj === "Doubtful")) {
      adj *= 1.05;
      notes.push({t: `${m.q.name} is ${m.q.inj} (${pct(sh)} share). More work to go around.`, f: 1.05});
    }
  }
  return {mates, adj, notes};
}

function injuryFactor(p) {
  if (!p.inj) return {f: 1};
  if (OUT.has(p.inj)) return {f: 0, t: `${p.inj}${p.injb ? " (" + p.injb + ")" : ""}: not expected to play`};
  if (p.inj === "Doubtful") return {f: 0.25, t: `Doubtful${p.injb ? " (" + p.injb + ")" : ""}`};
  if (p.inj === "Questionable") return {f: 0.85, t: `Questionable${p.injb ? " (" + p.injb + ")" : ""}`};
  return {f: 1};
}

/* A weekly projection made of numbers he can see. */
function project(id, wk) {
  const S = summary(id), p = S.p;
  const base = S.gp ? (S.l4gp ? 0.6 * S.l4.ppg + 0.4 * S.s.ppg : S.s.ppg) : 0;
  const g = (D.teams.sched[p.team] || []).find(x => x[0] === wk);
  const room = roomInfo(id);
  const inj = injuryFactor(p);
  const why = [];
  if (!S.gp) why.push({t: "No games played this season.", neg: true});
  else why.push({t: `Avg ${f1(S.s.ppg)} pts (${S.gp} g), last ${S.l4gp}: ${f1(S.l4.ppg)}`});
  const sh = share(p.pos, S.s), sh4 = share(p.pos, S.l4);
  if (sh != null && S.l4gp) {
    const d = (sh4 - sh) * 100;
    why.push({t: `${p.pos === "RB" ? "Opportunity" : "Target"} share ${pct(sh4)} last ${S.l4gp} vs ${pct(sh)} season (${Math.round(d) === 0 ? "steady" : (d > 0 ? "up " : "down ") + Math.abs(Math.round(d))})`, neg: d < -4, pos: d > 4});
  }
  if (S.l4gp) why.push({t: `Snaps ${pct(S.l4.snp)} · red zone ${f1(S.l4.rz / S.l4gp)}/g · goal line ${f1(S.l4.gl / S.l4gp)}/g (last ${S.l4gp})`});
  let mf = {f: 1}, opp = null;
  if (!g) { why.unshift({t: `BYE in week ${wk}`, neg: true}); return {id, p, proj: 0, base, why, bye: true, S}; }
  opp = g[1]; mf = matchupFactor(opp, p.pos);
  const rk = rank(opp, p.pos);
  const ord = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  const mtxt = rk == null ? "" : rk <= 16 ? `${rk === 1 ? "the" : ord(rk)} easiest ${p.pos} matchup` : `${33 - rk === 1 ? "the" : ord(33 - rk)} toughest ${p.pos} matchup`;
  if (mf.allowed != null) why.push({t: `${g[2] ? "vs" : "@"} ${opp}: allows ${f1(mf.allowed)} ${SCL()} pts/g to ${p.pos}s (league avg ${f1(mf.lg)}), ${mtxt} → ×${mf.f.toFixed(2)}`, neg: mf.f < 0.97, pos: mf.f > 1.03});
  for (const n of room.notes) why.push({t: n.t + ` ×${n.f}`, neg: n.neg, pos: !n.neg});
  if (inj.t) why.push({t: inj.t + ` → ×${inj.f}`, neg: true});
  const adj = mf.f * room.adj * inj.f;
  const proj = base * adj;
  // floor / ceiling: his 20th and 80th percentile weeks this season, scaled by the same factors
  const pts = S.ws.map(w => w.pts).sort((x, y) => x - y);
  const q = f => { if (!pts.length) return 0; const i = (pts.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i); return pts[lo] + (pts[hi] - pts[lo]) * (i - lo); };
  const floor = Math.min(q(0.2) * adj, proj * 0.75), ceil = Math.max(q(0.8) * adj, proj * 1.25);
  // the position trade-off, in numbers
  if (S.l4gp) {
    const g4 = S.l4gp, L = S.l4;
    if (p.pos === "RB") why.push({t: `RB profile: ${f1((L.car + L.tgt) / g4)} carries+targets/g, ${f1(L.glc / g4)} goal-line carries/g, ${f1(L.tgt / g4)} targets/g (last ${g4})`});
    else if (p.pos === "WR" || p.pos === "TE") why.push({t: `${p.pos} profile: ${f1(L.tgt / g4)} targets/g, ${pct(L.tshare)} target share, ${L.ypt == null ? "–" : L.ypt.toFixed(1)} yds/target, ${L.rzt} red-zone targets (last ${g4})`});
    else if (p.pos === "QB") why.push({t: `QB profile: ${f1(L.att / g4)} att/g, ${f1(L.pyd / g4)} pass yds/g, ${f1(L.car / g4)} rushes/g (last ${g4})`});
  }
  why.push({t: `Range: floor ${f1(floor)} / ceiling ${f1(ceil)} (his 20th and 80th percentile weeks, same factors)`});
  const nl = newsLine(id); if (nl) why.push({t: nl});
  return {id, p, proj, base, floor, ceil, why, opp, home: g[2], mf: mf.f, roomAdj: room.adj, injF: inj.f, S};
}

/* Rest-of-season value: each remaining game through week 17, with matchup, room and injury. */
function ros(id) {
  const p = BY[id], S = summary(id), from = nextWeek();
  const games = nextGames(p.team, from);
  // Rest of season leans on the whole season plus the USAGE trend: a real role change moves it,
  // a few cold (or hot) scoring weeks on the same usage barely do.
  const pts = S.gp ? (S.l4gp ? 0.75 * S.s.ppg + 0.25 * S.l4.ppg : S.s.ppg) : 0;
  const sh = p.pos === "QB" ? null : share(p.pos, S.s), sh4 = p.pos === "QB" ? null : share(p.pos, S.l4);
  const snapT = S.s.snp ? S.l4.snp / S.s.snp : 1;
  let usageF = 1;
  if (S.l4gp >= 2 && S.gp >= 4) {
    const r = sh ? sh4 / sh : snapT;
    usageF = Math.max(0.8, Math.min(1.2, 1 + (r - 1) * 0.5));
  }
  const base = pts * usageF;
  const room = roomInfo(id);
  let miss = 0;
  if (p.inj === "IR" || p.inj === "PUP") miss = 4; else if (OUT.has(p.inj)) miss = 1;
  let total = 0, mfs = [];
  games.forEach((g, i) => {
    const mf = matchupFactor(g[1], p.pos).f; mfs.push(mf);
    let f = 1;
    if (i < miss) f = 0; else if (i === 0 && p.inj === "Doubtful") f = 0.25; else if (i === 0 && p.inj === "Questionable") f = 0.85;
    total += base * mf * room.adj * f;
  });
  const sos = mfs.length ? mfs.reduce((a, b) => a + b, 0) / mfs.length : 1;
  return {id, p, S, base, usageF, sh, sh4, games: games.length, miss, sos, roomAdj: room.adj, roomNotes: room.notes, total};
}


/* ---------------- expert consensus, used across the hub (start/sit, compare, trade) ---------------- */
function expertWeek(id, wk) {
  const C = D.consensus || {};
  if (C.week !== wk || (C.release && Date.now() < new Date(C.release))) return null;
  const p = BY[id]; if (!p) return null;
  const rows = (C.pos || {})[p.pos] || [];
  const i = rows.findIndex(r => r.id === id);
  return i < 0 ? null : {...rows[i], crank: i + 1};
}
function expertPending(wk) {
  const C = D.consensus || {};
  return C.week === wk && C.release && Date.now() < new Date(C.release) ? new Date(C.release) : null;
}
/* Our projection blended with the experts': 60% expert consensus points, 40% ours. */
function projectX(id, wk) {
  const x = project(id, wk), e0 = expertWeek(id, wk);
  if (!e0 || x.bye || e0.proj == null) return x;
  const e = {...e0, proj: e0.proj * scF(id)};
  const ours = x.proj, blend = 0.6 * e.proj + 0.4 * ours, k = ours > 0 ? blend / ours : 1;
  x.ours = ours; x.expert = e.proj; x.proj = blend;
  x.floor = ours > 0 ? x.floor * k : blend * 0.75; x.ceil = ours > 0 ? x.ceil * k : blend * 1.25;
  const pos = x.p.pos;
  const srcs = [e.ffbr && `Footballers ${pos}${e.ffbr}`, e.fp && `FantasyPros ${pos}${e.fp}`, e.rw && `RotoWire ${pos}${e.rw}`, e.es && `ESPN ${pos}${e.es}`].filter(Boolean).join(", ");
  const add = [{t: `Expert consensus: ${pos}${e.crank} this week (${srcs}), ${f1(e.proj)} pts. Our numbers: ${f1(ours)}. Blended 60/40 = ${f1(blend)}`, pos: e.proj > ours * 1.1, neg: e.proj < ours * 0.9}];
  for (const t of e.ffb || []) add.push({t: `Fantasy Footballers: ${(TAKE_TXT[t.take] || t.take)}: ${t.note}`, pos: ["start", "like"].includes(t.take), neg: ["sit", "fade"].includes(t.take)});
  for (const t of (e.other || []).slice(0, 2)) add.push({t: `${t.src}: ${(TAKE_TXT[t.take] || t.take)}: ${t.note}`});
  x.why.unshift(...add);
  return x;
}
/* Rest of season with the experts: FantasyPros ROS rank turned into points (what our model gives the player
   at that rank), blended 50/50 with our own ROS points. */
let ROS_BY_RANK = null;
function rosX(id) {
  const x = ros(id), p = BY[id];
  const r = (D.ros.players || []).find(z => z.id === id);
  const pr = r && parseInt(String(r.prank || "").replace(/\D/g, ""));
  if (!pr) return x;
  if (!ROS_BY_RANK) {
    ROS_BY_RANK = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) ROS_BY_RANK[pos] = D.players.filter(q => q.pos === pos && (D.stats[q.id] || []).length).map(q => ros(q.id).total).sort((a, b) => b - a);
  }
  const arr = ROS_BY_RANK[p.pos] || [];
  const ev = arr[Math.min(pr, arr.length) - 1];
  if (ev == null) return x;
  x.ours = x.total; x.expertRank = r.prank; x.expertVal = ev; x.total = 0.5 * x.total + 0.5 * ev;
  return x;
}
/* ---------------- lucky or real (no Claude) ---------------- */
let POSEFF = null;
function posEff() {
  if (POSEFF) return POSEFF;
  const t = {};
  for (const p of D.players) {
    const ws = weeks(p.id); if (!ws.length) continue;
    const x = t[p.pos] || (t[p.pos] = {car: 0, ryd: 0, tgt: 0, recyd: 0});
    x.car += sum(ws, "car"); x.ryd += sum(ws, "ryd"); x.tgt += sum(ws, "tgt"); x.recyd += sum(ws, "recyd");
  }
  POSEFF = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, {ypc: v.car ? v.ryd / v.car : 0, ypt: v.tgt ? v.recyd / v.tgt : 0}]));
  return POSEFF;
}
/* Expected TDs come from where his carries and targets happened (league TD rate from each spot on the field). */
function luck(id) {
  const p = BY[id], L = (D.luck.players || {})[id];
  if (!p || !L) return null;
  const [xtd, td] = L, S = summary(id), eff = posEff()[p.pos] || {};
  const flags = [];
  const diff = td - xtd;
  if (diff >= 2.5 && td >= xtd * 1.5) flags.push({k: "hot", t: `Running hot: ${td} TDs vs ${xtd.toFixed(1)} expected from his usage. Expect fewer; sell-high candidate.`});
  else if (diff <= -2.5) flags.push({k: "due", t: `Due: ${td} TDs vs ${xtd.toFixed(1)} expected from his red-zone and goal-line work. TDs should come; buy-low candidate.`});
  if (p.pos === "RB" && S.s.car >= 60 && eff.ypc) {
    const d = S.s.ypc - eff.ypc;
    if (d >= 1) flags.push({k: "hot", t: `Efficiency hot: ${S.s.ypc.toFixed(1)} yds/carry vs ${eff.ypc.toFixed(1)} for RBs. Hard to keep up.`});
    else if (d <= -0.9) flags.push({k: "due", t: `Efficiency cold: ${S.s.ypc.toFixed(1)} yds/carry vs ${eff.ypc.toFixed(1)} for RBs. Volume is real; yards should rebound.`});
  }
  if ((p.pos === "WR" || p.pos === "TE") && S.s.tgt >= 35 && eff.ypt) {
    const d = S.s.ypt - eff.ypt;
    if (d >= 2.5) flags.push({k: "hot", t: `Efficiency hot: ${S.s.ypt.toFixed(1)} yds/target vs ${eff.ypt.toFixed(1)} for ${p.pos}s.`});
    else if (d <= -2.2) flags.push({k: "due", t: `Efficiency cold: ${S.s.ypt.toFixed(1)} yds/target vs ${eff.ypt.toFixed(1)} for ${p.pos}s; the targets are there.`});
  }
  const tdFlag = flags.find(f => f.t.startsWith("Running") || f.t.startsWith("Due"));
  return {xtd, td, flags, tag: tdFlag ? tdFlag.k : (flags[0] ? flags[0].k : null)};
}
function luckTag(id) {
  const L = luck(id); if (!L || !L.tag) return "";
  const why = luckExplain(id);
  return L.tag === "hot" ? tipTag("sig sell", "HOT · SELL", `Why sell ${BY[id].name}: ${why}`)
                         : tipTag("sig buy", "DUE · BUY", `Why buy ${BY[id].name}: ${why}`);
}


/* Tap-or-hover explanations for tags like HOT · SELL, so anyone can see why. */
function tipTag(cls, label, text) {
  return `<span class="${cls} has-tip" data-tip="${esc(text)}" title="${esc(text)}" tabindex="0" role="button">${esc(label)} <span class="ib" aria-hidden="true">i</span></span>`;
}
function showTip(el) {
  let t = document.getElementById("tip");
  if (!t) { t = document.createElement("div"); t.id = "tip"; t.setAttribute("role", "tooltip"); document.body.appendChild(t); }
  if (t.dataset.for === el.dataset.tip && !t.hidden) { t.hidden = true; return; }
  t.textContent = el.dataset.tip; t.dataset.for = el.dataset.tip; t.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
  t.style.width = w + "px";
  t.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
  const below = r.bottom + 8 + t.offsetHeight < innerHeight;
  t.style.top = (below ? r.bottom + 8 : r.top - t.offsetHeight - 8) + "px";
}
document.addEventListener("click", e => {
  const el = e.target.closest(".has-tip");
  if (el) { e.preventDefault(); e.stopPropagation(); showTip(el); return; }
  const t = document.getElementById("tip"); if (t) t.hidden = true;
}, true);
document.addEventListener("keydown", e => { const el = e.target.closest && e.target.closest(".has-tip"); if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showTip(el); } });
addEventListener("scroll", () => { const t = document.getElementById("tip"); if (t) t.hidden = true; }, {passive: true});


/* Player-specific "why sell / why buy": his numbers vs the league, his team, his schedule, and a fair value. */
let LEAGUE = null;
function leagueCtx() {
  if (LEAGUE) return LEAGUE;
  const pos = {}, team = {};
  for (const p of D.players) {
    const ws = weeks(p.id); if (!ws.length) continue;
    const a = agg(ws), L = (D.luck.players || {})[p.id];
    (pos[p.pos] = pos[p.pos] || []).push({id: p.id, a, td: L ? L[1] : null, xtd: L ? L[0] : null});
    for (const w of ws) { const t = team[w.team] || (team[w.team] = {}); t[w.wk] = Math.max(t[w.wk] || 0, (w.tmc || 0) + (w.tmt || 0)); }
  }
  const vol = Object.entries(team).map(([t, wk]) => [t, Object.values(wk).reduce((x, y) => x + y, 0) / Object.keys(wk).length]).sort((x, y) => y[1] - x[1]);
  return (LEAGUE = {pos, volRank: Object.fromEntries(vol.map(([t, v], i) => [t, {v, rank: i + 1}]))});
}
function rankOf(list, id, val, min) {
  const xs = list.filter(x => min(x.a)).map(x => [x.id, val(x.a)]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  const i = xs.findIndex(x => x[0] === id);
  return i < 0 ? null : {rank: i + 1, n: xs.length};
}
function luckExplain(id) {
  const p = BY[id], L = luck(id); if (!p || !L) return "";
  const S = summary(id), a = S.s, ctx = leagueCtx(), list = ctx.pos[p.pos] || [], eff = posEff()[p.pos] || {};
  const hot = L.tag === "hot", out = [];
  // 1) touchdowns vs his usage
  const tdDiff = L.td - L.xtd;
  if (Math.abs(tdDiff) >= 1.5) out.push(p.pos === "QB"
    ? `${L.td} rushing TDs, but his carries (${a.rzc} in the red zone, ${a.glc} inside the 5) usually produce about ${L.xtd.toFixed(1)}. That's ${Math.abs(tdDiff).toFixed(1)} ${tdDiff > 0 ? "more" : "fewer"} than expected.`
    : `${L.td} TDs, but his touches (${a.rz} in the red zone, ${a.gl} inside the 5) usually produce about ${L.xtd.toFixed(1)}. That's ${Math.abs(tdDiff).toFixed(1)} ${tdDiff > 0 ? "more" : "fewer"} than expected.`);
  // 2) efficiency vs the position, with his rank
  if (p.pos === "RB" && a.ypc != null && eff.ypc) {
    const r = rankOf(list, id, x => x.ypc, x => x.car >= 60);
    out.push(`${a.ypc.toFixed(1)} yards per carry vs ${eff.ypc.toFixed(1)} for RBs${r ? ` (${ord(r.rank)} of ${r.n})` : ""}.`);
  } else if ((p.pos === "WR" || p.pos === "TE") && a.ypt != null && eff.ypt) {
    const r = rankOf(list, id, x => x.ypt, x => x.tgt >= 35);
    out.push(`${a.ypt.toFixed(1)} yards per target vs ${eff.ypt.toFixed(1)} for ${p.pos}s${r ? ` (${ord(r.rank)} of ${r.n})` : ""}.`);
  }
  // 3) his role and his team
  const sh = share(p.pos, a), sh4 = share(p.pos, S.l4);
  if (sh != null) {
    const r = rankOf(list, id, x => share(p.pos, x), x => x.g >= 4);
    out.push(`He gets ${pct(sh)} of ${p.team}'s ${p.pos === "RB" ? "carries and targets" : "targets"}${r ? ` (${ord(r.rank)} among ${p.pos}s)` : ""}${S.l4gp >= 2 && Math.abs(sh4 - sh) >= 0.04 ? `, ${sh4 > sh ? "up" : "down"} to ${pct(sh4)} over the last ${S.l4gp}` : ""}.`);
  }
  const tv = ctx.volRank[p.team];
  if (tv) out.push(`${p.team} runs ${Math.round(tv.v)} plays a game (${ord(tv.rank)} most in the NFL).`);
  // 4) the schedule ahead
  const up = nextGames(p.team, nextWeek()).slice(0, 4);
  if (up.length) {
    const tags = up.map(g => { const f = matchupFactor(g[1], p.pos).f; return f > 1.03 ? "easy" : f < 0.97 ? "tough" : "avg"; });
    const e = tags.filter(t => t === "easy").length, h = tags.filter(t => t === "tough").length;
    out.push(`Next ${up.length}: ${up.map(g => (g[2] ? "" : "@") + g[1]).join(", ")} (${e} easy, ${h} tough).`);
  }
  // 5) fair value once the luck evens out
  let adj = -tdDiff * 6;
  if (p.pos === "RB" && a.ypc != null && eff.ypc) adj -= (a.ypc - eff.ypc) * a.car * 0.1 * 0.5;
  if ((p.pos === "WR" || p.pos === "TE") && a.ypt != null && eff.ypt) adj -= (a.ypt - eff.ypt) * a.tgt * 0.1 * 0.5;
  const fair = S.gp ? Math.max(0, a.ppg + adj / S.gp) : a.ppg;
  out.push(hot ? `Fair value is about ${f1(fair)} ${SCL()} pts/game, not his ${f1(a.ppg)}. Sell if someone pays for the ${f1(a.ppg)}.`
               : `Fair value is about ${f1(fair)} ${SCL()} pts/game, above his ${f1(a.ppg)}. Buy while he's priced off the ${f1(a.ppg)}.`);
  return out.join(" ");
}


/* In-tab quick filter: narrows the list on screen as you type (the header search is the full player search). */
const TQ = {};
function tabSearch(key, ph) {
  return `<div class="tabsearch"><input class="tabq" data-tq="${key}" type="search" placeholder="${esc(ph)}" value="${esc(TQ[key] || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="${esc(ph)}"></div>`;
}
function applyTabQ() {
  const inp = document.querySelector("#app .tabq"); if (!inp) return;
  const q = norm(inp.value);
  const items = document.querySelectorAll("#app .news-grid > *, #app .card.list > .pl, #app .card.list > a.pl, #app .rt tbody tr:not(.tot), #app .wv");
  let shown = 0;
  items.forEach(el => { const hit = !q || norm(el.innerText).includes(q); el.hidden = !hit; if (hit) shown++; });
  let none = document.getElementById("tq-none");
  if (q && !shown) { if (!none) { none = document.createElement("p"); none.id = "tq-none"; none.className = "muted"; inp.parentNode.after(none); } none.textContent = `No match for "${inp.value}" here. Try the search at the top.`; }
  else if (none) none.remove();
}
document.addEventListener("input", e => { const t = e.target; if (t.classList && t.classList.contains("tabq")) { TQ[t.dataset.tq] = t.value; applyTabQ(); } });

/* ---------------- usage charts (inline SVG, one series each) ---------------- */
function spark(title, pts, fmt, max) {
  const W = 300, H = 92, padL = 30, padR = 8, padT = 10, padB = 20;
  const vals = pts.map(p => p.v).filter(v => v != null);
  const nice = v => v <= 1 ? Math.min(1, Math.ceil(v * 1.2 * 10) / 10) : Math.ceil(v * 1.15 / 5) * 5;
  const top = max || nice(Math.max(0.05, ...vals));
  const x = i => padL + (pts.length < 2 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (pts.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  let path = "", started = false;
  pts.forEach((p, i) => { if (p.v == null) { started = false; return; } path += (started ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1) + " "; started = true; });
  const grid = [0, 0.5, 1].map(f => `<line x1="${padL}" x2="${W - padR}" y1="${y(top * f)}" y2="${y(top * f)}" class="cg"/><text x="${padL - 4}" y="${y(top * f) + 3}" class="ct" text-anchor="end">${fmt(top * f)}</text>`).join("");
  const dots = pts.map((p, i) => p.v == null ? `<text x="${x(i)}" y="${y(0) - 4}" class="ct" text-anchor="middle">–</text>` :
    `<g class="pt"><circle cx="${x(i)}" cy="${y(p.v)}" r="12" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.v)}" r="4" class="cd"/><title>Wk ${p.wk}${p.opp ? " vs " + p.opp : ""}: ${fmt(p.v)}</title></g>`).join("");
  const last = [...pts].reverse().find(p => p.v != null);
  const xl = pts.map((p, i) => `<text x="${x(i)}" y="${H - 5}" class="ct" text-anchor="middle">${p.wk}</text>`).join("");
  return `<figure class="chart"><figcaption>${title}${last ? ` <b>${fmt(last.v)}</b>` : ""}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} by week">${grid}<path d="${path}" class="cl"/>${dots}${xl}</svg></figure>`;
}
function usageCharts(id) {
  const p = BY[id]; if (!p || p.pos === "QB" && !weeks(id).length) return "";
  const tg = teamGames(p.team).slice(-6), ws = weeks(id);
  const row = wk => ws.find(w => w.wk === wk);
  const pts = f => tg.map(wk => { const w = row(wk); return {wk, opp: w?.opp, v: w ? f(w) : null}; });
  const P = v => Math.round(v * 100) + "%";
  const charts = [spark("Snap %", pts(w => w.snp / 100), P, 1)];
  if (p.pos === "QB") charts.push(spark("Pass attempts", pts(w => w.att), v => Math.round(v)), spark("Rush attempts", pts(w => w.car), v => Math.round(v)));
  else {
    charts.push(spark("Target share", pts(w => w.tmt ? w.tgt / w.tmt : 0), P, null));
    if (p.pos === "RB") charts.push(spark("Rush share", pts(w => w.tmc ? w.car / w.tmc : 0), P, 1), spark("Carries", pts(w => w.car), v => Math.round(v)));
    else charts.push(spark("Carries", pts(w => w.car), v => Math.round(v)));
  }
  return `<h2>Usage · last ${tg.length} team games</h2><div class="charts">${charts.join("")}</div>`;
}

/* ---------------- matchups ---------------- */
function buildKDefDvp() {
  // points allowed to kickers (by defense) and points defenses score against each offense
  const add = (map, team, v) => { const x = map[team] || (map[team] = [0, 0]); x[0] += v; x[1]++; };
  const k = {}, d = {};
  for (const K of D.kdef.K || []) for (const [wk, opp, pts] of K.weeks || []) add(k, opp, pts);
  for (const X of D.kdef.DEF || []) for (const [wk, opp, pts] of X.weeks || []) add(d, opp, pts);
  for (const [t, v] of Object.entries(k)) (D.teams.dvp[t] = D.teams.dvp[t] || {}).K = Math.round(v[0] / v[1] * 10) / 10;
  for (const [t, v] of Object.entries(d)) (D.teams.dvp[t] = D.teams.dvp[t] || {}).DEF = Math.round(v[0] / v[1] * 10) / 10;
  for (const pos of ["K", "DEF"]) {
    const vals = Object.values(D.teams.dvp).map(x => x[pos]).filter(v => v != null);
    D.teams.league[pos] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : 0;
  }
}
function heat(v, lo, hi) {
  // sequential diverging-free scale: tough (low) → easy (high), one purple-to-green ramp, text stays ink
  if (v == null) return "";
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const stops = ["#5b1f2a", "#6b3a2a", "#3a3f55", "#2a5a3c", "#1f7a45"];
  return stops[Math.min(4, Math.floor(t * 5))];
}
/* Schedule strength without the wall of colors: one player's schedule, or ranked lists. */
function schedStats(team, pos, from, to) {
  const games = (D.teams.sched[team] || []).filter(g => !g[3] && g[0] >= from && g[0] <= to);
  const vals = games.map(g => (D.teams.dvp[g[1]] || {})[pos]).filter(v => v != null);
  return {games, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null};
}
function teamSchedRanks(pos, from, to) {
  const rows = Object.keys(D.teams.sched).map(t => ({t, ...schedStats(t, pos, from, to)})).filter(r => r.avg != null).sort((a, b) => b.avg - a.avg);
  const rank = {}; rows.forEach((r, i) => rank[r.t] = i + 1);
  return {rows, rank, n: rows.length};
}
function ord(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"); }
function easeTag(v, pos) {
  const lg = D.teams.league[pos]; if (v == null || !lg) return `<span class="ez avg">–</span>`;
  const r = v / lg;
  return r >= 1.08 ? `<span class="ez easy">Easy</span>` : r <= 0.92 ? `<span class="ez hard">Hard</span>` : `<span class="ez avg">Avg</span>`;
}
function rankWords(rank, n, pos, what) {
  return rank <= n / 2 ? `${rank === 1 ? "Easiest" : ord(rank) + " easiest"} ${pos} ${what}` : `${n - rank + 1 === 1 ? "Toughest" : ord(n - rank + 1) + " toughest"} ${pos} ${what}`;
}
function schedView(pos) {
  const wk = nextWeek(), PO = PLAYOFFS;
  const ros = teamSchedRanks(pos, wk, LAST_FANTASY_WEEK), po = teamSchedRanks(pos, PO[0], PO[1]);
  const pick = V.schedP && BY[V.schedP] ? BY[V.schedP] : null;
  let one = "";
  if (pick && pos === pick.pos) {
    const st = schedStats(pick.team, pos, wk, LAST_FANTASY_WEEK);
    const all = (D.teams.sched[pick.team] || []).filter(g => !g[3] && g[0] >= wk && g[0] <= LAST_FANTASY_WEEK);
    const weeksAll = []; for (let w = wk; w <= LAST_FANTASY_WEEK; w++) weeksAll.push(w);
    one = `<div class="card"><div class="row wrap"><a href="#/p/${pick.id}"><b>${esc(pick.name)}</b></a><span class="muted small">${pick.pos} · ${pick.team}</span>
      <span class="small" style="margin-left:auto">${rankWords(ros.rank[pick.team], ros.n, pos, "schedule ROS")} · ${rankWords(po.rank[pick.team], po.n, pos, "playoff schedule")}</span></div>
      <div class="schedrows">${weeksAll.map(w => { const g = all.find(x => x[0] === w); if (!g) return `<div class="sr ${w >= 15 && w <= 17 ? "po" : ""}"><b>Wk ${w}</b><span class="muted">BYE</span><span></span></div>`;
        const v = (D.teams.dvp[g[1]] || {})[pos]; return `<div class="sr ${w >= 15 && w <= 17 ? "po" : ""}"><b>Wk ${w}</b><span>${g[2] ? "vs" : "@"} ${g[1]} <span class="muted tiny">allows ${v == null ? "?" : f1(v)} to ${pos}s</span></span>${easeTag(v, pos)}</div>`; }).join("")}</div></div>`;
  } else if (pick) one = `<p class="muted small">Pick the ${pick.pos} tab to see ${esc(pick.name)}'s schedule.</p>`;
  const teamLevel = pos === "K" || pos === "DEF";
  const playersFor = ranks => {
    if (teamLevel) return ranks.rows.map(r => ({t: r.t, avg: r.avg, label: `${r.t} ${pos === "DEF" ? "D/ST" : "K"}`, sub: pos === "K" ? ((D.kdef.K || []).find(k => k.team === r.t)?.name || "") : ""}));
    const pool = D.players.filter(p => p.pos === pos && p.gp >= MIN_GP).slice(0, pos === "QB" || pos === "TE" ? 30 : 60);
    return pool.map(p => ({p, t: p.team, avg: ranks.rows.find(r => r.t === p.team)?.avg ?? null})).filter(x => x.avg != null).sort((a, b) => b.avg - a.avg);
  };
  // one card per TEAM (the schedule is the team's), with the players who matter at this position right now:
  // who's active and getting the work, and who's hurt (and so who gets the boost)
  const ACTIVE_N = {QB: 1, RB: 2, WR: 3, TE: 1};
  const teamRoom = t => {
    const ps = D.players.filter(p => p.pos === pos && p.team === t && p.gp >= 1);
    const work = p => { const S = summary(p.id); return pos === "QB" ? p.ppg : (share(pos, S.l4gp ? S.l4 : S.s) || 0) * 100 + p.ppg * 0.3; };
    const hurt = ps.filter(p => OUT.has(p.inj) && p.ppg >= 6).sort((a, b) => b.ppg - a.ppg).slice(0, 2);
    const active = ps.filter(p => !OUT.has(p.inj)).sort((a, b) => work(b) - work(a))
      .filter((p, j) => j === 0 || p.ppg >= 5).slice(0, ACTIVE_N[pos] || 2);      // the lead guy, plus anyone with a real role
    return {active, hurt};
  };
  const teamCard = (r, i, ranks, title) => {
    const {active, hurt} = teamRoom(r.t);
    const boost = hurt.length && active.length ? ` <span class="tk good">↑ with ${esc(hurt.map(h => h.name.split(" ").slice(-1)[0]).join(" & "))} out</span>` : "";
    const who = active.map((p, j) => `<a href="#/p/${p.id}"><b>${esc(p.name)}</b></a> <span class="muted small">${f1(p.ppg)} ppg${p.inj ? " · " + esc(p.inj) : ""}</span>${j === 0 ? boost : ""}`).join("<br>");
    const out = hurt.map(h => `<span class="muted small">${esc(h.name)} · <b class="v-bad">${esc(h.inj)}</b></span>`).join(" · ");
    return `<div class="pl">${rnk(i)}<span class="grow"><b>${esc(r.t)}</b> <span class="muted tiny">${rankWords(ranks.rank[r.t], ranks.n, pos, title.includes("playoff") ? "playoff schedule" : "schedule ROS")} · opponents allow ${f1(r.avg)}/g</span>
      <div style="margin-top:4px">${who || '<span class="muted small">No regular contributor</span>'}</div>${out ? `<div style="margin-top:2px">${out}</div>` : ""}</span>${easeTag(r.avg, pos)}</div>`;
  };
  const list = (title, ranks, n) => {
    if (!teamLevel) {
      const rs = ranks.rows.slice().sort((a, b) => b.avg - a.avg);
      const best = rs.slice(0, n), worst = rs.slice(-5).reverse();
      return `<h2>${title}</h2><div class="card list">${best.map((r, i) => teamCard(r, i, ranks, title)).join("")}</div>
      <p class="small muted" style="margin:8px 0 2px">Toughest (watch out):</p><div class="card list">${worst.map((r, i) => teamCard(r, rs.length - 1 - i, ranks, title)).join("")}</div>`;
    }
    const xs = playersFor(ranks), best = xs.slice(0, n), worst = xs.slice(-5).reverse();
    const row = (x, i, rk) => `<div class="pl">${rnk(i)}${x.p ? head(x.p) : ""}<span class="grow">${x.p ? `<a href="#/p/${x.p.id}"><b>${esc(x.p.name)}</b></a>` : `<b>${esc(x.label)}</b>`} <span class="muted small">${x.p ? x.p.pos + " · " + x.t + " · " + f1(x.p.ppg) + " ppg" : esc(x.sub || "")}</span><br><span class="muted tiny">${rankWords(rk, ranks.n, pos, title.includes("playoff") ? "playoff schedule" : "schedule ROS")} · opponents allow ${f1(x.avg)}/g</span></span>${easeTag(x.avg, pos)}</div>`;
    return `<h2>${title}</h2><div class="card list">${best.map((x, i) => row(x, i, ranks.rank[x.t])).join("")}</div>
      <p class="small muted" style="margin:8px 0 2px">Toughest (watch out):</p><div class="card list">${worst.map((x, i) => row(x, xs.length - 1 - i, ranks.rank[x.t])).join("")}</div>`;
  };
  return `<div class="pick" style="margin:8px 0"><input id="sched-q" placeholder="Search a player's schedule…" autocomplete="off"><div class="sugg" hidden></div></div>
  ${one}
  <p class="muted small">Easy / Avg / Hard compares what each opponent allows to ${pos === "DEF" ? "defenses" : pos + "s"} with the league average (8% either way). Weeks 15–17 are the fantasy playoffs.</p>
  <div class="cols"><div class="col">${list(`Best rest-of-season schedules (wk ${wk}–${LAST_FANTASY_WEEK})`, ros, 15)}</div><div class="col">${list("Best playoff schedules (wk 15–17)", po, 15)}</div></div>`;
}
function matchupGrid(pos) {
  const wk0 = nextWeek(), wks = []; for (let w = wk0; w <= LAST_FANTASY_WEEK; w++) wks.push(w);
  const vals = Object.values(D.teams.dvp).map(x => x[pos]).filter(v => v != null).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.1)] ?? 0, hi = vals[Math.floor(vals.length * 0.9)] ?? 1;
  const teams = Object.keys(D.teams.sched).sort();
  const rowsAll = teams.map(t => {
    const sch = D.teams.sched[t];
    const cells = wks.map(w => { const g = sch.find(x => x[0] === w); if (!g) return {bye: true}; const v = (D.teams.dvp[g[1]] || {})[pos]; return {opp: g[1], home: g[2], v}; });
    const play = cells.filter(c => !c.bye && c.v != null), po = cells.filter((c, i) => wks[i] >= 15 && wks[i] <= 17 && !c.bye && c.v != null);
    const avg = a => a.length ? a.reduce((s, c) => s + c.v, 0) / a.length : 0;
    return {t, cells, ros: avg(play), po: avg(po)};
  });
  const sortBy = V.mx?.sort || "ros";
  rowsAll.sort((a, b) => b[sortBy] - a[sortBy]);
  return `<p class="muted small">Each team's remaining opponents, colored by ${SCL()} points those defenses allow to ${pos === "DEF" ? "defenses (how generous each offense is)" : pos + "s"}. Green = easy, red = tough. Weeks 15–17 (gold) are the fantasy playoffs.</p>
  <div class="seg"><span class="muted small" style="align-self:center">Sort:</span><button class="chip ${sortBy === "ros" ? "on" : ""}" data-mxs="ros">Rest of season</button><button class="chip ${sortBy === "po" ? "on" : ""}" data-mxs="po">Playoffs (15–17)</button></div>
  <div class="scroll grid-wrap"><table class="mx"><thead><tr><th>Team</th>${wks.map(w => `<th class="${w >= 15 && w <= 17 ? "po" : ""}">${w}</th>`).join("")}<th>ROS</th><th class="po">PO</th></tr></thead><tbody>
  ${rowsAll.map(r => `<tr><td><b>${r.t}</b></td>${r.cells.map((c, i) => c.bye ? `<td class="bye ${wks[i] >= 15 && wks[i] <= 17 ? "po" : ""}">BYE</td>` :
    `<td class="${wks[i] >= 15 && wks[i] <= 17 ? "po" : ""}" style="background:${heat(c.v, lo, hi)}" title="${c.home ? "vs" : "@"} ${c.opp}: allows ${c.v == null ? "?" : f1(c.v)}">${c.home ? "" : '<span class="at">@</span>'}${c.opp}</td>`).join("")}
    <td>${f1(r.ros)}</td><td class="po">${f1(r.po)}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="legend"><span>Tough</span>${["#5b1f2a", "#6b3a2a", "#3a3f55", "#2a5a3c", "#1f7a45"].map(c => `<i style="background:${c}"></i>`).join("")}<span>Easy</span></div>`;
}

/* ---------------- views ---------------- */
const V = {};
function setTab(t) { document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === t)); }
function stamp() {
  const c = D.meta.check || {};
  return `<p class="note">Week ${D.meta.week} stats · updated ${ago(D.meta.updated)} · ${c.games_checked}/${c.games_final} games cross-checked vs ESPN box scores (${c.fixes} corrected) · ${SCL()}</p>`;
}

const LIST_LEN = {QB: 36, RB: 60, WR: 72, TE: 36, FLEX: 100, K: 32, DEF: 32};
const MIN_GP = 3;
function rnk(i) { return `<span class="rk ${["gold", "silver", "bronze"][i] || ""}">${i + 1}</span>`; }
V.home = () => {
  setTab("home");
  const view = (V.home.view === "rw" ? "wk" : V.home.view) || "wk";
  const pos = V.home.pos || "RB";
  const sub = `<div class="subtabs"><button class="${view === "wk" ? "on" : ""}" data-view="wk">This week</button><button class="${view === "ppg" ? "on" : ""}" data-view="ppg">Points per game</button><button class="${view === "ros" ? "on" : ""}" data-view="ros">Rest of season</button><button class="${view === "mx" ? "on" : ""}" data-view="mx">Best matchups ROS</button></div>`;
  const posSeg = `<div class="seg">${["QB","RB","WR","TE","FLEX","K","DEF"].map(x => `<button class="chip ${x === pos ? "on" : ""}" data-pos="${x}">${x}</button>`).join("")}</div>`;
  const mxPos = pos === "FLEX" ? "RB" : pos;
  const mxSeg = `<div class="seg">${["QB","RB","WR","TE","K","DEF"].map(x => `<button class="chip ${x === mxPos ? "on" : ""}" data-pos="${x}">${x}</button>`).join("")}</div>`;
  return `<h1>Rankings</h1>${sub}${view === "mx" ? mxSeg + schedView(mxPos) : posSeg + tabSearch("rank", "Search this list…") + (view === "ros" ? rosList(pos) : view === "wk" ? weeklyList(pos) : ppgList(pos))}${stamp()}`;
};
function ppgList(pos) {
  const n = LIST_LEN[pos];
  let list;
  if (pos === "K") list = (D.kdef.K || []).filter(k => k.gp >= MIN_GP).slice(0, n).map(kRow).join("");
  else if (pos === "DEF") list = (D.kdef.DEF || []).slice(0, n).map(defRow).join("");
  else {
    const ok = pos === "FLEX" ? (p => p.pos === "RB" || p.pos === "WR" || p.pos === "TE") : (p => p.pos === pos);
    const ps = D.players.filter(p => ok(p) && p.gp >= MIN_GP).slice(0, n);
    list = `<div class="only-narrow">${ps.map((p, i) => plRow(p, i)).join("")}</div>` + `<div class="only-wide">${ppgTable(ps)}</div>`;
  }
  const note = pos === "K" ? "Kickers: FG 0–39 = 3, 40–49 = 4, 50+ = 5, PAT = 1."
    : pos === "DEF" ? "Defenses: sack 1, INT / fumble rec / safety / block 2, TD 6, plus points-allowed tiers (0 = 10 … 35+ = −4)." : "";
  return `<p class="muted small">${SCU()} · min ${MIN_GP} games</p>
  <div class="card list">${list || '<p class="muted">No data yet.</p>'}</div>${note ? `<p class="note">${note}</p>` : ""}`;
}
function ppgTable(ps) {
  return `<table class="rt"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th>GP</th><th>Total</th><th>PPG</th><th>Snap%</th><th>Car/g</th><th>Tgt/g</th><th>Share</th><th>RZ/g</th><th>TD</th><th>xTD</th><th>Flag</th></tr></thead><tbody>
  ${ps.map((p, i) => { const S = summary(p.id), a = S.s, L = (D.luck.players || {})[p.id]; return `<tr><td>${rnk(i)}</td><td><a href="#/p/${p.id}">${esc(p.name)}</a> ${recBadge(p.id)} ${injBadge(p)}</td><td>${p.pos}</td><td>${p.team}</td><td>${p.gp}</td><td>${f1(sum(weeks(p.id), "pts"))}</td><td><b>${f1(p.ppg)}</b></td><td>${pct(a.snp)}</td><td>${f1(a.car / a.g)}</td><td>${f1(a.tgt / a.g)}</td><td>${p.pos === "QB" ? "–" : pct(share(p.pos, a))}</td><td>${f1(a.rz / a.g)}</td><td>${a.rtd + a.rectd + (p.pos === "QB" ? a.ptd : 0)}</td><td>${L ? L[0].toFixed(1) : "–"}</td><td>${luckTag(p.id)}</td></tr>`; }).join("")}</tbody></table>`;
}
function kRow(k, i) {
  return `<div class="pl">${rnk(i)}${head(k)}<span class="grow"><b>${esc(k.name)}</b><br><span class="muted small">K · ${k.team} · ${k.gp} gp · <b class="ink2">${f1(k.ppg * k.gp)}</b> total pts · FG ${k.fgm}/${k.fga} · 50+: ${k.fg50} · PAT ${k.pat}${k.patm ? "/" + (k.pat + k.patm) : ""}</span></span><span class="r"><b>${f1(k.ppg)}</b><br><span class="muted tiny">ppg</span></span></div>`;
}
function defRow(d, i) {
  return `<div class="pl">${rnk(i)}<span class="grow"><b>${esc(d.team)} D/ST</b><br><span class="muted small">${d.gp} gp · <b class="ink2">${f1(d.ppg * d.gp)}</b> total pts · ${d.sack} sacks · ${d.int} INT · ${d.fr} FR · ${d.td} TD · allows ${f1(d.papg)}/g</span></span><span class="r"><b>${f1(d.ppg)}</b><br><span class="muted tiny">ppg</span></span></div>`;
}
/* This week: FantasyPros weekly expert consensus + their projection, next to our own projection and the
   matchup. Once a game is played, the row shows what he actually scored, so you can see who the experts missed. */
const WEEK_LEN = {QB: 36, RB: 60, WR: 72, TE: 36, FLEX: 150, K: 32, DEF: 32};
function gradeCls(g) { return !g ? "" : g[0] === "A" ? "v-good" : g[0] === "B" ? "" : "v-bad"; }
function fpWeeklyList(pos, W0) {
  const W = W0 || D.weekly || {}, all = (W.pos || {})[pos] || [];
  if (!all.length) return `<p class="muted">Weekly rankings aren't loaded yet. They refresh every 3 hours.</p>`;
  const wk = Number(W.week), done = all.filter(r => r.status === "closed").length;
  const lbl = pos === "FLEX" ? "FLEX" : pos;
  const rows = all.slice(0, WEEK_LEN[pos]).map((r, i) => {
    const p = r.id ? BY[r.id] : null, mpos = r.pos;
    let ours = null, act = null;
    if (p && (D.stats[p.id] || []).length) {
      const pr = project(p.id, wk); if (!pr.bye) ours = pr.proj;
      const w = weeks(p.id).find(x => x.wk === wk); if (w) act = w.pts;
    } else if (r.pos === "K" || r.pos === "DEF") {
      const X = r.pos === "K" ? (D.kdef.K || []).find(k => k.team === r.team && norm(k.name) === norm(r.name)) : (D.kdef.DEF || []).find(d => d.team === r.team);
      if (X) { ours = X.ppg * matchupFactor(r.oppid, r.pos).f; const w = (X.weeks || []).find(x => x[0] === wk); if (w) act = w[2]; }
    }
    if (r.status !== "closed") act = null;
    if (act != null) ours = null;   // our projection would already include this game, so don't show it next to the result
    const name = p ? `<a href="#/p/${p.id}"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.pos === "DEF" ? r.name.replace(/ D\/?ST$/i, "") + " D/ST" : r.name)}</b>`;
    const ez = r.oppid ? easeTag((D.teams.dvp[r.oppid] || {})[mpos], mpos) : "";
    const actTxt = act == null ? "" : ` · <b class="${r.proj && act >= r.proj ? "v-good" : r.proj && act < r.proj * 0.7 ? "v-bad" : ""}">scored ${f1(act)}</b>`;
    return `<div class="pl">${rnk(i)}${p ? head(p) : ""}<span class="grow">${name} ${p ? injBadge(p) : ""} ${ez}${r.grade ? ` <span class="tiny ${gradeCls(r.grade)}" title="FantasyPros start/sit grade"><b>${esc(r.grade)}</b></span>` : ""}<br>
      <span class="muted small">${r.pos} · ${r.team} ${esc(r.opp)} · experts ${esc(r.prank || lbl + (i + 1))} (range ${r.min}–${r.max})${ours != null ? ` · ours ${f1(ours)}` : ""}${actTxt}</span></span>
      <span class="r"><b>${r.proj == null ? "–" : f1(r.proj * scF(r.id))}</b><br><span class="muted tiny">proj pts</span></span></div>`;
  }).join("");
  const banner = done === all.length
    ? `<div class="card small" style="margin:8px 0">Week ${wk} games are done, so each row shows what he actually scored next to the projection. Week ${wk + 1} rankings post Tuesday and swap in here automatically.</div>`
    : done ? `<p class="muted small">${done} of ${all.length} have played; those rows show what they scored.</p>` : "";
  return `<p class="small"><b>Week ${wk} rankings</b> <span class="muted">· games ${weekDates(wk)} ·</span> <b>Expert consensus</b></p>
  ${banner}<div class="card list">${rows}</div>
  <p class="note">Sources: FantasyPros. Big number = projected ${SCL()} points. "Ours" = our own projection. Grade = FantasyPros start/sit grade.</p>`;
}

/* This week = expert consensus: FantasyPros (2x) + RotoWire + ESPN projections, nudged by what the Fantasy
   Footballers say in their free articles and podcast (they count most). New week posts Tuesday 4 PM CT. */
const CT_FMT = d => d.toLocaleString("en-US", {timeZone: "America/Chicago", weekday: "long", hour: "numeric", minute: "2-digit"});
function weekDates(wk) {
  const ds = []; for (const t in D.teams.sched) for (const g of D.teams.sched[t]) if (g[0] === wk && g[4]) ds.push(g[4]);
  if (!ds.length) return "this week";
  ds.sort(); const f = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", {month: "short", day: "numeric"});
  return f(ds[0]) === f(ds[ds.length - 1]) ? f(ds[0]) : `${f(ds[0])}–${f(ds[ds.length - 1])}`;
}
function lockCard(title, sub) { return `<div class="card" style="text-align:center;padding:22px 14px"><div style="font-size:28px">🔒</div><b>${esc(title)}</b><p class="muted small" style="margin:6px 0 0">${sub}</p></div>`; }
const TAKE_TXT = {start: "START", sit: "SIT", like: "LIKE", fade: "FADE", add: "ADD", stash: "STASH", drop: "DROP"};
function takeChip(t, ffb) {
  const good = ["start", "like", "add", "stash"].includes(t.take);
  return `<span class="tk ${good ? "good" : "bad"}${ffb ? " ffb" : ""}">${ffb ? "Fantasy Footballers" : esc(t.src)}: ${TAKE_TXT[t.take] || esc(t.take)}</span>`;
}
function weeklyList(pos) {
  const C = D.consensus || {}, T = C.week, rel = C.release ? new Date(C.release) : null;
  if (rel && Date.now() < rel) {
    const P = Number((D.weeklyPrev || {}).week) === T - 1 ? D.weeklyPrev : Number((D.weekly || {}).week) === T - 1 ? D.weekly : null;
    const recap = P ? `<h2>Week ${T - 1} recap: expert projections vs what they scored</h2>` + fpWeeklyList(pos, P) : "";
    return lockCard(`Week ${T} rankings drop ${CT_FMT(rel)} CT`, `Sources: Fantasy Footballers, FantasyPros, RotoWire, ESPN.`) + recap;
  }
  const rows = (C.pos || {})[pos];
  if (!rows || !rows.length) return fpWeeklyList(pos);
  const lbl = pos;
  const body = rows.slice(0, WEEK_LEN[pos]).map((r, i) => {
    const p = BY[r.id]; if (!p) return "";
    const ppos = p.pos;
    let oppid = r.oppid, oppTxt = r.opp;
    if (!oppid) { const g = (D.teams.sched[p.team] || []).find(x => x[0] === T); if (g) { oppid = g[1]; oppTxt = (g[2] ? "vs. " : "at ") + g[1]; } else oppTxt = "BYE"; }
    const w = weeks(p.id).find(x => x.wk === T);
    const act = w ? w.pts : null;
    const ez = oppid ? easeTag((D.teams.dvp[oppid] || {})[ppos], ppos) : "";
    const srcs = [r.ffbr && `Fantasy Footballers ${ppos}${r.ffbr}`, r.fp && `FantasyPros ${ppos}${r.fp}`, r.rw && `RotoWire ${ppos}${r.rw}`, r.es && `ESPN ${ppos}${r.es}`].filter(Boolean).join(" · ");
    const ffb = (r.ffb || []).slice(0, 1).map(t => `<div class="tiny" style="margin-top:3px">${takeChip(t, true)} <span class="ink2">${esc(t.note)}</span></div>`).join("");
    const oth = (r.other || []).slice(0, 2).map(t => `<div class="tiny" style="margin-top:3px">${takeChip(t, false)} <span class="muted">${esc(t.note)}</span></div>`).join("");
    const actTxt = act == null ? "" : ` · <b class="${r.proj && act >= r.proj ? "v-good" : r.proj && act < r.proj * 0.7 ? "v-bad" : ""}">scored ${f1(act)}</b>`;
    return `<div class="pl">${rnk(i)}${head(p)}<span class="grow"><a href="#/p/${p.id}"><b>${esc(p.name)}</b></a> ${recBadge(p.id)} ${injBadge(p)} ${ez}${r.grade ? ` <span class="tiny ${gradeCls(r.grade)}" title="FantasyPros start/sit grade"><b>${esc(r.grade)}</b></span>` : ""}<br>
      <span class="muted small">${ppos} · ${p.team} ${esc(oppTxt || "")} · ${srcs}${actTxt}${p.gp ? ` · season ${f1(sum(weeks(p.id), "pts"))} pts` : ""}</span>${ffb}${oth}</span>
      <span class="r"><b>${r.proj == null ? "–" : f1(r.proj * scF(r.id))}</b><br><span class="muted tiny">proj pts</span></span></div>`;
  }).join("");
  const ffbN = (C.ffb || []).length;
  return `<p class="small"><b>Week ${T} rankings</b> <span class="muted">· games ${weekDates(T)} ·</span> <b>Expert consensus</b></p>
  <div class="card list">${body}</div>
  <p class="note">Sources: ${esc([...(ffbN ? ["Fantasy Footballers"] : []), ...(C.sources || [])].join(", "))}. Proj pts = the sources' average. Updated ${ago(C.updated)}.</p>`;
}

/* ---------------- record watch: chasing history, this week's big games, milestones (no Claude) ---------------- */
const fmtN = n => Math.round(n).toLocaleString();
function bigFor(id) { return ((D.records || {}).big || []).find(b => b.id === id); }
function recBadge(id) {
  const b = bigFor(id); if (!b) return "";
  const txt = [...b.feats, ...b.highs].join(", ");
  return tipTag("trophy", "🏆", `${b.name}, week ${D.records.week} vs ${b.opp}: ${txt}.`);
}
function recordWatch() {
  const R = D.records; if (!R || !R.pace) return `<p class="muted">Record watch isn't loaded yet.</p>`;
  const link = (id, name) => BY[id] ? `<a href="#/p/${id}"><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`;
  const pace = R.pace.map(c => {
    const rows = c.chasers.map((x, i) => {
      const f = Math.min(1, x.pace / c.record), on = x.pace >= c.record;
      return `<div class="rw-row">${rnk(i)}<span class="grow">${link(x.id, x.name)} <span class="muted small">${esc(x.pos)} · ${esc(x.team)}</span>
        <div class="bar"><i style="width:${(f * 100).toFixed(1)}%" class="${on ? "on" : ""}"></i></div>
        <span class="small ${on ? "v-good" : "ink2"}">${on ? "<b>On record pace:</b> " : ""}${fmtN(x.total)} so far · on pace for <b>${fmtN(x.pace)}</b>${on ? "" : ` · ${fmtN(c.record - x.pace)} short`}</span></span></div>`;
    }).join("");
    return `<div class="card"><div class="row"><b>${esc(c.label)}</b><span class="muted small" style="margin-left:auto">Record ${fmtN(c.record)} · ${esc(c.holder)}, ${c.year}</span></div>${rows}</div>`;
  }).join("");
  const big = (R.big || []).map((b, i) => `<div class="pl">${rnk(i)}${BY[b.id] ? head(BY[b.id]) : ""}<span class="grow">${link(b.id, b.name)} <span class="muted small">${esc(b.pos)} · ${esc(b.team)} vs ${esc(b.opp)}</span><br>
    ${b.feats.map(f => `<span class="tk good">${esc(f)}</span>`).join(" ")} ${b.highs.map(h => `<span class="tk ffb">🏆 ${esc(h)}</span>`).join(" ")}</span></div>`).join("");
  const miles = (R.milestones || []).map(m => `<div class="pl"><span class="grow">${link(m.id, m.name)} <span class="muted small">${esc(m.pos)} · ${esc(m.team)}</span><br>
    <span class="small ink2">${m.first ? `<b>${esc(m.label)}</b>: ${fmtN(m.total)} so far, ${fmtN(m.need)} to go` : `<b>${fmtN(m.need)}</b> ${esc(m.label.toLowerCase())} from <b>${fmtN(m.milestone)}</b> career (${fmtN(m.total)} now)`}</span></span>
    <span class="r"><b>~${m.games}</b><br><span class="muted tiny">game${m.games === 1 ? "" : "s"}</span></span></div>`).join("");
  return `<p class="small"><b>Record watch</b> <span class="muted">· ${R.season} season through week ${R.week} · this week's big games are in News → Week ${R.week} recap</span></p>
  <h2>Chasing history</h2><p class="muted small">Single-season NFL records and the closest chasers, on a 17-game pace.</p>${pace}
  <h2>Milestones coming up</h2><div class="card list">${miles || '<p class="muted">Nobody close to a milestone right now.</p>'}</div>
  <p class="note">Career numbers and career highs use regular-season games since ${R.since}. Records are the official NFL single-season marks.</p>`;
}
V.records = () => { setTab("records"); return `<h1>Records</h1>${recordWatch()}`; };

/* Week recap (News tab): the week's big games with fantasy points in the chosen scoring, plus top scorers. */
function weekPts(id, wk) { const w = weeks(id).find(x => x.wk === wk); return w ? w.pts : null; }
function recapView() {
  const R = D.records || {}, wk = R.week;
  if (!wk) return `<p class="muted">No recap yet.</p>`;
  const link = (id, name) => BY[id] ? `<a href="#/p/${id}"><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`;
  // the week's 12 best fantasy games (in the chosen scoring), with big-game / career-high tags where they apply
  const tags = Object.fromEntries((R.big || []).map(b => [b.id, b]));
  // every stat, written out: passing, rushing, receiving, turnovers
  const statLine = w => {
    const out = [];
    if (w.att) out.push(`${w.cmp}/${w.att}, ${w.pyd} pass yds, ${w.ptd} TD${w.int ? `, ${w.int} INT` : ""}`);
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (w.car) out.push(`${pl(w.car, "carry", "carries")}, ${w.ryd} rush yds${w.rtd ? `, ${w.rtd} TD` : ""}`);
    if (w.tgt || w.rec) out.push(`${pl(w.rec, "catch", "catches")} (${pl(w.tgt, "target", "targets")}), ${w.recyd} rec yds${w.rectd ? `, ${w.rectd} TD` : ""}`);
    if (w.fl) out.push(`${w.fl} fumble${w.fl > 1 ? "s" : ""} lost`);
    if (w.two) out.push(`${w.two} two-point conversion${w.two > 1 ? "s" : ""}`);
    return out.join(" · ");
  };
  // 1–2 green highlight pills for every player: his standout numbers this week
  const pills = w => {
    const c = [];
    const td = (w.rtd || 0) + (w.rectd || 0);
    if (w.ptd >= 2) c.push([w.ptd * 10, `${w.ptd} pass TD`]);
    if (w.pyd >= 250) c.push([w.pyd / 10, `${w.pyd} pass yds`]);
    if (td >= 1) c.push([td * 12, `${td} TD${td > 1 ? "s" : ""}`]);
    if (w.ryd >= 50) c.push([w.ryd / 5, `${w.ryd} rush yds`]);
    if (w.recyd >= 50) c.push([w.recyd / 5, `${w.recyd} rec yds`]);
    if (w.rec >= 7) c.push([w.rec * 2, `${w.rec} catches`]);
    if (w.ryd + w.recyd >= 150 && w.ryd >= 30 && w.recyd >= 30) c.push([(w.ryd + w.recyd) / 4, `${w.ryd + w.recyd} scrimmage yds`]);
    return c.sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
  };
  const line = w => [];
  let bigList = D.players.filter(p => ["QB", "RB", "WR", "TE"].includes(p.pos))
    .map(p => { const w = weeks(p.id).find(x => x.wk === wk); if (!w) return null; const t = tags[p.id];
      return {id: p.id, name: p.name, pos: p.pos, team: w.team, opp: w.opp, feats: pills(w), highs: t ? t.highs : [], stat: statLine(w), pts: w.pts}; })
    .filter(Boolean);
  const big = bigList.sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1)).slice(0, 12).map((b, i) => { const pts = b.pts; return `<div class="pl">${rnk(i)}${BY[b.id] ? head(BY[b.id]) : ""}<span class="grow">${link(b.id, b.name)} <span class="muted small">${esc(b.pos)} · ${esc(b.team)} vs ${esc(b.opp)}</span><br>
    <span class="small ink2">${esc(b.stat || "")}</span>${b.feats.length || b.highs.length ? "<br>" : ""}${b.feats.map(f => `<span class="tk good">${esc(f)}</span>`).join(" ")} ${b.highs.map(h => `<span class="tk ffb">🏆 ${esc(h)}</span>`).join(" ")}</span>
    <span class="r"><b>${pts == null ? "–" : f1(pts)}</b><br><span class="muted tiny">pts</span></span></div>`; }).join("");
  const inTop = new Set(bigList.slice().sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1)).slice(0, 12).map(b => b.id));
  const also = (R.big || []).filter(b => !inTop.has(b.id)).map(b => ({...b, pts: weekPts(b.id, wk)})).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
  const alsoHtml = also.map(b => `<div class="pl"><span class="grow">${link(b.id, b.name)} <span class="muted small">${esc(b.pos)} · ${esc(b.team)} vs ${esc(b.opp)}</span><br>
    ${b.feats.map(f => `<span class="tk good">${esc(f)}</span>`).join(" ")} ${b.highs.map(h => `<span class="tk ffb">🏆 ${esc(h)}</span>`).join(" ")}</span>
    <span class="r"><b>${b.pts == null ? "–" : f1(b.pts)}</b><br><span class="muted tiny">pts</span></span></div>`).join("");
  const kd = (pos, rows) => `<div class="col"><h2>Top ${pos === "K" ? "kickers" : "defenses"}</h2><div class="card list">${rows.map((x, i) => `<div class="pl">${rnk(i)}<span class="grow"><b>${esc(x.label)}</b><br><span class="muted small">vs ${esc(x.opp)}${x.sub ? " · " + esc(x.sub) : ""}</span></span><span class="r"><b>${f1(x.pts)}</b><br><span class="muted tiny">pts</span></span></div>`).join("") || '<p class="muted">No data.</p>'}</div></div>`;
  const kRows = (D.kdef.K || []).map(k => { const w = (k.weeks || []).find(x => x[0] === wk); return w ? {label: `${k.name} (${k.team})`, opp: w[1], pts: w[2]} : null; }).filter(Boolean).sort((a, b) => b.pts - a.pts).slice(0, 5);
  const dRows = (D.kdef.DEF || []).map(d => { const w = (d.weeks || []).find(x => x[0] === wk); return w ? {label: `${d.team} D/ST`, opp: w[1], pts: w[2], sub: w[3] != null ? `allowed ${w[3]}` : ""} : null; }).filter(Boolean).sort((a, b) => b.pts - a.pts).slice(0, 5);
  const top = ["QB", "RB", "WR", "TE"].map(pos => {
    const xs = D.players.filter(p => p.pos === pos).map(p => ({p, pts: weekPts(p.id, wk)})).filter(x => x.pts != null).sort((a, b) => b.pts - a.pts).slice(0, 5);
    return `<div class="col"><h2>Top ${pos}s</h2><div class="card list">${xs.map((x, i) => { const w = weeks(x.p.id).find(z => z.wk === wk);
      return `<a class="pl" href="#/p/${x.p.id}">${rnk(i)}${head(x.p)}<span class="grow"><b>${esc(x.p.name)}</b> ${recBadge(x.p.id)}<br><span class="muted small">${x.p.team} ${w ? "vs " + w.opp : ""}</span>${w ? `<br><span class="small ink2">${esc(statLine(w))}</span>` : ""}</span><span class="r"><b>${f1(x.pts)}</b><br><span class="muted tiny">pts</span></span></a>`; }).join("")}</div></div>`;
  }).join("");
  return `<p class="small"><b>Week ${wk} recap</b> <span class="muted">· ${SCU()} points</span></p>
  <h2>Top 12 scorers</h2><div class="card list">${big || '<p class="muted">Nothing huge this week.</p>'}</div>
  ${alsoHtml ? `<h2>Also big games</h2><div class="card list">${alsoHtml}</div>` : ""}
  <div class="cols">${top}${kd("K", kRows)}${kd("DEF", dRows)}</div>`;
}
/* Rest of season: FantasyPros expert consensus next to our own ROS score; big gaps = buy/sell. */
function gamesLeft(team) { return nextGames(team, nextWeek()).length; }
function sigWhy(r) {
  const d = r.det, bits = [];
  bits.push(`${f1(d.S.s.ppg)} ppg season, ${f1(d.S.l4.ppg)} last ${d.S.l4gp}`);
  if (d.sh != null && d.S.l4gp) bits.push(`${d.p.pos === "RB" ? "opp" : "target"} share ${pct(d.sh4)} vs ${pct(d.sh)}`);
  if (Math.abs(d.sos - 1) >= 0.03) bits.push(`schedule ${d.sos > 1 ? "easier" : "tougher"} (${d.sos.toFixed(2)})`);
  if (d.roomAdj !== 1) bits.push(d.roomAdj < 1 ? "teammate returning" : "teammate out");
  if (d.miss) bits.push(`misses ~${d.miss} (${d.p.inj})`);
  if (d.games < 8) bits.push(`${d.games} games left`);
  return bits.join(" · ");
}
function rosList(pos) {
  const all = D.ros.players || [];
  const inPos = pos === "FLEX" ? (r => ["RB","WR","TE"].includes(r.pos)) : (r => r.pos === pos);
  const rows = all.filter(inPos).slice(0, LIST_LEN[pos]).map(r => {
    let ours = null;
    let det = null;
    if (r.id && BY[r.id] && (D.stats[r.id] || []).length) { det = ros(r.id); ours = det.total; }
    else if (r.pos === "K") { const k = (D.kdef.K || []).find(k => k.team === r.team && norm(k.name) === norm(r.name)); if (k) ours = k.ppg * gamesLeft(k.team); }
    else if (r.pos === "DEF") { const d = (D.kdef.DEF || []).find(d => d.team === r.team); if (d) ours = d.ppg * gamesLeft(d.team); }
    return {...r, ours, det};
  });
  // our rank within the same list, so the two ranks are comparable
  const scored = rows.filter(r => r.ours != null).sort((a, b) => b.ours - a.ours);
  scored.forEach((r, i) => r.ourRank = i + 1);
  rows.forEach((r, i) => {
    r.ecrRank = i + 1;
    if (r.ourRank == null || (r.det && r.det.S.gp < MIN_GP)) return;   // too few games to call it
    const gap = r.ecrRank - r.ourRank, need = Math.max(8, Math.round(r.ecrRank * 0.4));
    r.sig = gap >= need ? "BUY" : gap <= -need ? "SELL" : "";
    r.gap = gap;
  });
  const lbl = pos === "FLEX" ? "FLEX" : pos;
  // show in OUR order (best ROS points first); players we can't score yet go to the bottom in expert order
  const shown = [...scored, ...rows.filter(r => r.ours == null)];
  const body = shown.map((r, i) => {
    const p = r.id ? BY[r.id] : null;
    const name = p ? `<a href="#/p/${p.id}"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`;
    const sig = r.sig ? tipTag(`sig ${r.sig === "BUY" ? "buy" : "sell"}`, r.sig, `Experts rank him ${lbl}${r.ecrRank}; our numbers rank him ${lbl}${r.ourRank}. ${r.sig === "BUY" ? "Our numbers like him more than the experts do, so he may be undervalued: a good time to trade for him." : "Our numbers like him less than the experts do, so he may be overvalued: a good time to trade him away."}${r.det ? " Why: " + sigWhy(r) + "." : ""}`) : "";
    const why = r.sig && r.det ? sigWhy(r) : "";
    return `<div class="pl">${rnk(i)}${p ? head(p) : ""}<span class="grow">${name} ${p ? injBadge(p) : ""} ${sig}<br><span class="muted small">${r.pos} · ${r.team}${r.bye ? " · bye " + r.bye : ""} · experts ${lbl}${r.ecrRank} (overall ${r.ecr}, range ${r.min}–${r.max})${r.ourRank ? ` · ours ${lbl}${r.ourRank}` : ""}</span>${why ? `<br><span class="tiny ${r.sig === "BUY" ? "v-good" : "v-bad"}">${esc(why)}</span>` : ""}</span>
      <span class="r"><b>${r.ours == null ? "–" : f1(r.ours)}</b><br><span class="muted tiny">our ROS pts</span></span></div>`;
  }).join("");
  const buys = rows.filter(r => r.sig === "BUY").length, sells = rows.filter(r => r.sig === "SELL").length;
  return `<p class="muted small">Ordered by our ROS points; expert rank (FantasyPros) under each name.
 ${buys} buys · ${sells} sells (tap ⓘ on a tag for why).</p>
  <div class="card list">${body || '<p class="muted">No consensus data yet.</p>'}</div>`;
}
function plRow(p, i) {
  return `<a class="pl" href="#/p/${p.id}">${typeof i === "number" ? rnk(i) : ""}${head(p)}<span class="grow"><b>${esc(p.name)}</b> ${recBadge(p.id)} ${injBadge(p)} ${typeof i === "number" ? luckTag(p.id) : ""}<br><span class="muted small">${p.pos} · ${p.team}${p.gp ? ` · ${p.gp} gp` : ""}${typeof i === "number" && p.gp ? ` · <b class="ink2">${f1(sum(weeks(p.id), "pts"))}</b> total pts` : ""}</span></span><span class="r"><b>${p.gp ? f1(p.ppg) : "–"}</b><br><span class="muted tiny">ppg</span></span></a>`;
}

function statTiles(p, a, n) {
  const T = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
  let h = T(f1(a.ppg), "pts/g") + T(f1(a.pts), "pts");
  if (p.pos === "QB") h += T(a.att ? `${a.cmp}/${a.att}` : "–", "cmp/att") + T(pct(a.cpct), "cmp %") + T(a.pyd, "pass yds") + T(a.ptd, "pass TD") + T(a.int, "INT");
  if (p.pos === "QB" || p.pos === "RB" || a.car) h += T(a.car, "carries") + T(a.ryd, "rush yds") + T(a.ypc == null ? "–" : a.ypc.toFixed(1), "yds/carry") + T(a.rtd, "rush TD");
  if (p.pos !== "QB") h += T(a.tgt, "targets") + T(a.rec, "rec") + T(a.recyd, "rec yds") + T(a.ypt == null ? "–" : a.ypt.toFixed(1), "yds/target") + T(a.rectd, "rec TD") + T(pct(a.tshare), "target share");
  if (p.pos === "RB") h += T(pct(a.oshare), "opp share");
  h += T(pct(a.snp), "snap %") + T(a.rzc, "RZ carries") + T(a.rzt, "RZ targets") + T(a.glc, "GL carries") + T(a.glt, "GL targets");
  return `<div class="tiles">${h}</div>`;
}

function weekCards(p, ws) {
  const qb = p.pos === "QB";
  return `<div class="wkcards">${ws.slice().reverse().map(w => `<div class="wkc"><div class="row"><b>Wk ${w.wk}</b><span class="muted small">${w.team !== p.team ? w.team + " " : ""}vs ${w.opp}</span><b style="margin-left:auto">${f1(w.pts)}</b><span class="muted tiny">pts</span></div>
    <div class="small ink2">${w.snp ? w.snp + "% snaps · " : ""}${qb ? `${w.cmp}/${w.att}, ${w.pyd} yds, ${w.ptd} TD, ${w.int} INT · ` : ""}${w.car ? `${w.car} car, ${w.ryd} yds${w.rtd ? ", " + w.rtd + " TD" : ""}` : ""}${!qb && w.tgt ? `${w.car ? " · " : ""}${w.rec}/${w.tgt} tgt, ${w.recyd} yds${w.rectd ? ", " + w.rectd + " TD" : ""}` : ""}${w.rzc + w.rzt ? ` · RZ ${w.rzc + w.rzt}` : ""}${w.glc + w.glt ? ` · GL ${w.glc + w.glt}` : ""}${w.fix ? ' · <span title="Corrected to the ESPN box score">✓ESPN</span>' : ""}</div></div>`).join("")}</div>`;
}
function weekTable(p, ws) {
  const qb = p.pos === "QB";
  const cols = qb
    ? [["wk","Wk"],["opp","Opp"],["pts","Pts"],["snp","Snap%"],["cmp","Cmp"],["att","Att"],["pyd","PYd"],["ptd","PTD"],["int","INT"],["car","Car"],["ryd","RYd"],["rtd","RTD"],["rzc","RZ car"],["glc","GL car"],["fl","FL"]]
    : [["wk","Wk"],["opp","Opp"],["pts","Pts"],["snp","Snap%"],["car","Car"],["ryd","RYd"],["ypc","YPC"],["rtd","RTD"],["tgt","Tgt"],["rec","Rec"],["recyd","RecYd"],["ypt","Y/Tgt"],["rectd","RecTD"],["ts","Tgt%"],["rzc","RZ car"],["rzt","RZ tgt"],["glc","GL car"],["glt","GL tgt"],["fl","FL"]];
  const val = (w, k) => k === "ypc" ? (w.car ? (w.ryd / w.car).toFixed(1) : "–") : k === "ypt" ? (w.tgt ? (w.recyd / w.tgt).toFixed(1) : "–")
    : k === "ts" ? (w.tmt ? pct(w.tgt / w.tmt) : "–") : k === "snp" ? (w.snp ? w.snp + "%" : "–") : k === "pts" ? f1(w.pts) : w[k];
  const fixed = w => new Set((w.fix || "").split(",").filter(Boolean));
  const a = agg(ws);
  const tot = {wk: "Total", opp: "", pts: f1(a.pts), snp: pct(a.snp), cmp: a.cmp, att: a.att, pyd: a.pyd, ptd: a.ptd, int: a.int, car: a.car, ryd: a.ryd, ypc: a.ypc == null ? "–" : a.ypc.toFixed(1), rtd: a.rtd, tgt: a.tgt, rec: a.rec, recyd: a.recyd, ypt: a.ypt == null ? "–" : a.ypt.toFixed(1), rectd: a.rectd, ts: pct(a.tshare), rzc: a.rzc, rzt: a.rzt, glc: a.glc, glt: a.glt, fl: a.fl};
  return `<div class="scroll"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>
    ${ws.map(w => { const fx_ = fixed(w); return `<tr>${cols.map(c => `<td class="${fx_.has(c[0]) ? "fx" : ""}" ${fx_.has(c[0]) ? 'title="Corrected to the ESPN box score"' : ""}>${c[0] === "opp" ? (w.team !== p.team ? w.team + " " : "") + w.opp : val(w, c[0])}</td>`).join("")}</tr>`; }).join("")}
    <tr class="tot">${cols.map(c => `<td>${tot[c[0]]}</td>`).join("")}</tr></tbody></table></div>`;
}

function roomTable(id) {
  const p = BY[id], R = roomInfo(id);
  if (p.pos === "QB") return "";
  const label = p.pos === "RB" ? "Backfield" : p.pos === "WR" ? "WR room" : "TE room";
  const rows = R.mates.slice(0, 6);
  const maxSh = Math.max(0.01, ...rows.map(m => share(p.pos, m.l4) || 0));
  const cards = `<div class="only-narrow">${rows.map(m => { const s4 = share(p.pos, m.l4) || 0; return `<div class="roomc ${m.q.id === id ? "me" : ""}"><div class="row"><a href="#/p/${m.q.id}"><b>${esc(m.q.name)}</b></a>${m.q.inj ? injBadge(m.q) : m.missedLast && m.ws.length ? '<span class="badge">missed last game</span>' : ""}<b style="margin-left:auto">${pct(s4)}</b></div>
    <div class="meter" style="margin:5px 0"><i style="width:${(s4 / maxSh * 100).toFixed(0)}%"></i></div><div class="tiny muted">Last 4: ${m.l4.car} car · ${m.l4.tgt} tgt · RZ ${m.l4.rz} · GL ${m.l4.gl} · ${m.l4.g ? pct(m.l4.snp) + " snaps" : "–"} · season share ${pct(share(p.pos, m.s))}</div></div>`; }).join("")}</div>`;
  return `<h2>${label} · ${p.team}</h2>${cards}
  <div class="scroll only-wide"><table class="room"><thead><tr><th>Player</th><th>Status</th><th>${p.pos === "RB" ? "Opp" : "Tgt"} share L4</th><th></th><th>Season</th><th>Car L4</th><th>Tgt L4</th><th>RZ L4</th><th>GL L4</th><th>Snap% L4</th></tr></thead><tbody>
  ${rows.map(m => { const s4 = share(p.pos, m.l4) || 0; return `<tr class="${m.q.id === id ? "me" : ""}">
    <td><a href="#/p/${m.q.id}">${esc(m.q.name)}</a></td><td>${m.q.inj ? injBadge(m.q) : m.missedLast && m.ws.length ? '<span class="badge">missed last game</span>' : "–"}</td>
    <td>${pct(s4)}</td><td><div class="meter" role="img" aria-label="${pct(s4)}"><i style="width:${(s4 / maxSh * 100).toFixed(0)}%"></i></div></td>
    <td>${pct(share(p.pos, m.s))}</td><td>${m.l4.car}</td><td>${m.l4.tgt}</td><td>${m.l4.rz}</td><td>${m.l4.gl}</td><td>${m.l4.g ? pct(m.l4.snp) : "–"}</td></tr>`; }).join("")}
  </tbody></table></div>
  ${R.notes.length ? `<ul class="why">${R.notes.map(n => `<li>${esc(n.t)}</li>`).join("")}</ul>` : ""}`;
}

function newsLine(id) {
  const c = (D.news?.cards || []).find(c => c.pid === id);
  if (!c) return "";
  const it = c.items[0];
  return `Latest news (${when(it.t)}, ${it.src}): ${it.head}${it.body && it.body !== it.head ? " " + it.body.slice(0, 220) : ""}`;
}
function newsFor(id, n = 3) {
  const c = (D.news?.cards || []).find(c => c.pid === id);
  if (!c) return `<p class="muted small">No news in the last 10 days.</p>`;
  return newsCard(c, n, false);
}
function newsCard(c, n = 4, link = true) {
  const p = BY[c.pid] || c;
  const [first, ...rest] = c.items;
  return `<div class="card news">
    <div class="row">${link ? `<a href="#/p/${c.pid}" class="row" style="color:var(--ink)">${head(p, 32)}<b>${esc(p.name || c.name)}</b></a> ${recBadge(c.pid)}` : ""}<span class="muted small">${esc(p.pos || c.pos)} · ${esc(p.team || c.team)}</span> ${BY[c.pid] ? injBadge(BY[c.pid]) : ""}<span class="muted small" style="margin-left:auto">${ago(c.updated)}</span></div>
    <div class="item" style="border:0;margin-top:6px;padding-top:0"><div class="head">${esc(first.head)}</div>${first.body && first.body !== first.head ? `<div class="ink2 small">${esc(first.body)}</div>` : ""}
    <div class="tiny muted">Broke ${when(first.t)} · ${esc(first.src)}${c.sources.length > 1 ? ` · also ${esc(c.sources.filter(s => s !== first.src).join(", "))}` : ""}${first.url ? ` · <a href="${esc(first.url)}" target="_blank" rel="noopener">source</a>` : ""}</div></div>
    ${rest.slice(0, n - 1).map(i => `<div class="item"><div class="small"><b>${esc(i.head)}</b></div><div class="tiny muted">${when(i.t)} · ${esc(i.src)}</div></div>`).join("")}
  </div>`;
}

V.player = id => {
  setTab("home");
  const p = BY[id]; if (!p) return `<p>Player not found.</p>`;
  const S = summary(id);
  const L4 = S.l4;
  const nxt = nextGames(p.team, nextWeek())[0];
  const mine = roster().includes(id);
  return `
  <div class="hero">${p.head ? `<img src="${esc(headUrl(p.head, 72))}" alt="">` : `<span style="width:72px;height:72px;border-radius:50%;background:var(--panel2)"></span>`}
    <div class="grow"><h1>${esc(p.name)} ${recBadge(id)}</h1>
    <div class="muted">${p.pos} · ${p.team}${p.num ? " #" + p.num : ""}${p.age ? " · age " + p.age : ""}${p.yrs != null ? " · yr " + (p.yrs + 1) : ""}</div>
    <div style="margin-top:4px">${injBadge(p)} ${nxt ? `<span class="badge">Wk ${nxt[0]} ${nxt[2] ? "vs" : "@"} ${nxt[1]}</span>` : ""}</div></div></div>
  <div class="row wrap" style="margin:12px 0">
    <a class="btn" href="#/c/${id}">Compare</a>
    <button class="btn ghost" data-act="ss" data-id="${id}">Start/Sit</button>
    <button class="btn ghost" data-act="trade" data-id="${id}">Trade</button>
    <button class="btn ghost" data-act="mine" data-id="${id}">${mine ? "✓ On my roster" : "+ My roster"}</button>
  </div>
  ${p.injn ? `<p class="small ink2">${esc(p.injn)}</p>` : ""}
  <div id="nums" class="cols">
  <div class="col">
  <h2>Season · ${S.gp} games</h2>${S.gp ? statTiles(p, S.s) : `<p class="muted">No stats yet this season.</p>`}
  ${S.l4gp ? `<h2>Last ${S.l4gp} games</h2>${statTiles(p, L4)}` : ""}
  ${luckBlock(id)}
  ${S.gp ? outlookBlock(id) : ""}
  </div>
  <div class="col">
  ${S.gp ? usageCharts(id) : ""}
  ${roomTable(id)}
  <h2>Latest news</h2>${newsFor(id)}
  </div>
  <div class="span">${S.gp ? `<h2>Week by week</h2><div class="only-wide">${weekTable(p, S.ws)}</div><div class="only-narrow">${weekCards(p, S.ws)}</div>` : ""}</div>
  </div>
  ${S.gp ? anaPanel("profile", [id], true) : ""}
  ${stamp()}`;
};

function luckBlock(id) {
  const L = luck(id); if (!L) return "";
  const tdLine = `<b style="color:var(--ink)">${L.td}</b> TDs vs <b style="color:var(--ink)">${L.xtd.toFixed(1)}</b> expected from where his carries and targets came (league TD rate from each spot on the field).`;
  const ex = L.tag ? `<p style="margin:8px 0 0">${esc(luckExplain(id))}</p>` : "";
  return `<h2>Lucky or real</h2><div class="card small ink2">${tdLine}${ex}${L.flags.length ? `<ul class="why">${L.flags.map(f => `<li class="${f.k === "hot" ? "v-bad" : "v-good"}">${esc(f.t)}</li>`).join("")}</ul>` : `<div style="margin-top:4px">Nothing unusual: his scoring matches his usage.</div>`}</div>`;
}
function byeWeek(team) {
  const wks = new Set((D.teams.sched[team] || []).map(g => g[0]));
  for (let w = 1; w <= 18; w++) if (!wks.has(w)) return w;
  return null;
}
function outlookBlock(id) {
  const R = ros(id), p = BY[id], up = nextGames(p.team, nextWeek()).slice(0, 4);
  const opp = up.map(g => { const m = matchupFactor(g[1], p.pos); return `Wk ${g[0]} ${g[2] ? "vs" : "@"} ${g[1]} (${m.f > 1.03 ? "easy" : m.f < 0.97 ? "tough" : "neutral"})`; }).join(" · ");
  return `<h2>Outlook</h2><div class="card small ink2">Rest of season: <b style="color:var(--ink)">${f1(R.total)}</b> projected ${SCL()} pts over ${R.games} games left${R.miss ? ` (${esc(R.p.inj)}: misses ~${R.miss})` : ""} (${f1(R.base)}/g, schedule ${R.sos.toFixed(2)}, usage trend ×${R.usageF.toFixed(2)}${R.roomAdj !== 1 ? `, room ×${R.roomAdj.toFixed(2)}` : ""}). Bye week ${byeWeek(p.team) ?? "–"}.<br>Next: ${opp || "–"}</div>`;
}
/* His roster, written out for the trade and start/sit write-ups (it never leaves his device otherwise). */
function rosterContext(extraGive = [], extraGet = []) {
  const ids = roster().filter(id => BY[id]);
  if (!ids.length) return "";
  const after = ids.filter(id => !extraGive.includes(id)).concat(extraGet.filter(id => !ids.includes(id)));
  const line = list => ["QB", "RB", "WR", "TE"].map(pos => {
    const ps = list.map(id => BY[id]).filter(p => p && p.pos === pos).sort((a, b) => b.ppg - a.ppg);
    return `${pos} (${ps.length}): ` + (ps.map(p => `${p.name} ${p.team} ${f1(p.ppg)} ppg, ${(() => { const b = byeWeek(p.team); return b == null ? "bye ?" : b < nextWeek() ? `bye done (wk ${b})` : `bye wk ${b}`; })()}${p.inj ? ", " + p.inj : ""}`).join("; ") || "none");
  }).join("\n");
  return `<h2>Your roster</h2><div class="card small ink2" style="white-space:pre-line">${esc(line(ids))}</div>` +
    (extraGive.length || extraGet.length ? `<h2>Your roster after the trade</h2><div class="card small ink2" style="white-space:pre-line">${esc(line(after))}</div>` : "");
}
/* The same roster facts as plain text, sent quietly with trade / start-sit write-ups (not shown on the page). */
function rosterText(give = [], get = []) {
  const ids = roster().filter(id => BY[id]);
  if (!ids.length) return "His roster: not entered.";
  const wk = nextWeek();
  const line = list => ["QB", "RB", "WR", "TE"].map(pos => {
    const ps = list.map(id => BY[id]).filter(p => p && p.pos === pos).sort((a, b) => b.ppg - a.ppg);
    return `${pos} (${ps.length}): ` + (ps.map(p => { const b = byeWeek(p.team); return `${p.name} ${p.team} ${f1(p.ppg)} ppg, ${b == null ? "bye ?" : b < wk ? "bye done" : b === wk ? "ON BYE THIS WEEK" : "bye wk " + b}${p.inj ? ", " + p.inj : ""}`; }).join("; ") || "none");
  }).join("\n");
  const after = ids.filter(id => !give.includes(id)).concat(get.filter(id => !ids.includes(id)));
  return `HIS ROSTER (this is week ${wk}):\n${line(ids)}` + (give.length || get.length ? `\n\nHIS ROSTER AFTER THE TRADE:\n${line(after)}` : "");
}
function rosterTag() {
  const r = roster().slice().sort().join(","); let h = 0;
  for (const c of r) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return "r" + h.toString(36);
}

/* ---- waivers ---- */
function ownMax() { try { return +(localStorage.getItem("ownMax") || 60); } catch { return 60; } }
function ownBadge(o) {
  if (o == null) return "";
  return `<span class="badge" title="Rostered in ${o.toFixed(1)}% of ESPN leagues">${o < 10 ? o.toFixed(1) : o.toFixed(0)}% rostered</span>`;
}
V.waivers = () => {
  setTab("waivers");
  const W = D.waivers || {players: []};
  const hide = V.wHide, posF = V.wPos || "ALL";
  const mine = new Set(roster());
  const maxOwn = ownMax();
  let list = W.players.filter(e => BY[e.id]);
  const hidden = list.filter(e => e.own != null && e.own > maxOwn).length;
  list = list.filter(e => e.own == null || e.own <= maxOwn);
  if (hide) list = list.filter(e => !mine.has(e.id));
  if (posF !== "ALL") list = list.filter(e => e.pos === posF);
  const card = (e, i) => {
    const p = BY[e.id];
    const st = e.starter ? `<div class="small ink2" style="margin-top:4px">${e.starter.news ? `News on ${esc(e.starter.name)}: ${esc(e.starter.news.head)} <span class="muted">(${when(e.starter.news.t)})</span>` : ""}</div>` : "";
    return `<div class="card wv">${rnk(i)}<div class="grow"><div class="row wrap" style="gap:6px"><a href="#/p/${p.id}"><b>${esc(p.name)}</b></a><span class="muted small">${p.pos} · ${p.team}</span>${ownBadge(e.own)}${injBadge(p)}${mine.has(e.id) ? '<span class="badge">on my roster</span>' : ""}${e.type !== "jump" ? '<span class="sig buy">NEXT MAN UP</span>' : ""}</div>
      <ul class="why">${e.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>${st}
      ${e.news ? `<div class="tiny muted" style="margin-top:4px">Latest: ${esc(e.news.head)} (${when(e.news.t)}, ${esc(e.news.src)})</div>` : ""}</div>
      <div class="proj"><b>+${f1(e.gain)}</b><span class="muted tiny">opps gained</span>${e.trend ? `<div class="tiny muted" style="margin-top:4px">${e.trend.toLocaleString()} adds (48h, Sleeper)</div>` : ""}<div class="tiny muted">${f1(BY[e.id] ? BY[e.id].ppg : e.ppg)} ppg</div></div></div>`;
  };
  const wv = V.wView || "exp";
  const wsub = `<div class="subtabs"><button class="${wv === "exp" ? "on" : ""}" data-wv="exp">Expert consensus</button><button class="${wv === "use" ? "on" : ""}" data-wv="use">Usage jumps</button></div>`;
  const filters = `<div class="seg">${["ALL","QB","RB","WR","TE"].map(x => `<button class="chip ${x === posF ? "on" : ""}" data-wpos="${x}">${x === "ALL" ? "All" : x}</button>`).join("")}<button class="chip ${hide ? "on" : ""}" data-act="whide">${hide ? "✓ " : ""}Hide my roster</button></div>
  <div class="seg"><span class="muted small" style="align-self:center">Max rostered:</span>${[30, 45, 60, 75, 100].map(x => `<button class="chip ${x === maxOwn ? "on" : ""}" data-own="${x}">${x === 100 ? "Any" : x + "%"}</button>`).join("")}</div>`;
  if (wv === "exp") return `<h1>Waivers</h1>${wsub}${filters}${tabSearch("waiv", "Search waivers…")}${expertWaivers(posF, hide, mine, maxOwn)}`;
  return `<h1>Waivers</h1>${wsub}<p class="muted small"><b>Week ${W.week + 1} waivers</b> (pickups for week ${W.week + 1} games, based on week ${W.week} usage): usage jumps from last week vs the 3 before (snap %, target share, carries, opportunity share), plus backups moving up behind an injured starter. Ranked by opportunities gained. Only players rostered in ${maxOwn}% of leagues or fewer (ESPN roster %); ${hidden} more are hidden as likely taken. Players who are out are left off. Updated ${ago(W.updated)}.</p>
  ${filters}${tabSearch("waiv", "Search waivers…")}
  <div class="only-narrow">${list.slice(0, 60).map(card).join("") || '<p class="muted">Nothing flagged yet.</p>'}</div>
  <div class="only-wide card"><table class="rt"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Team</th><th>Rostered</th><th>Opps gained</th><th>Why</th><th>Adds 48h</th><th>PPG</th></tr></thead><tbody>
  ${list.slice(0, 60).map((e, i) => { const p = BY[e.id]; return `<tr><td>${rnk(i)}</td><td><a href="#/p/${p.id}">${esc(p.name)}</a> ${injBadge(p)} ${mine.has(e.id) ? '<span class="badge">mine</span>' : ""}</td><td>${p.pos}</td><td>${p.team}</td><td>${e.own == null ? "–" : e.own.toFixed(0) + "%"}</td><td><b>+${f1(e.gain)}</b></td><td class="wrapcell">${e.reasons.map(esc).join("<br>")}${e.starter?.news ? `<br><span class="muted">News: ${esc(e.starter.news.head)}</span>` : ""}</td><td>${e.trend ? e.trend.toLocaleString() : "–"}</td><td>${f1(BY[e.id] ? BY[e.id].ppg : e.ppg)}</td></tr>`; }).join("")}</tbody></table></div>`;
};

/* Expert waiver consensus: who the free expert articles say to add, Footballers (article + podcast) counted double. */
function expertWaivers(posF, hide, mine, maxOwn) {
  const X = D.wcons || {players: []}, rel = X.release ? new Date(X.release) : null;
  if (rel && Date.now() < rel) return lockCard(`Week ${X.week} waivers (expert consensus) open ${CT_FMT(rel)} CT`, "Right after Monday night. Sources: Fantasy Footballers, FantasyPros, RotoBaller, Sleeper.");
  let list = X.players || [];
  const hidden = list.filter(e => e.own != null && e.own > maxOwn).length;
  list = list.filter(e => e.own == null || e.own <= maxOwn);
  if (hide) list = list.filter(e => !mine.has(e.id));
  if (posF !== "ALL") list = list.filter(e => e.pos === posF);
  const ffbIn = (X.sources || []).includes("Fantasy Footballers");
  const nowCT = new Date().toLocaleString("en-US", {timeZone: "America/Chicago", weekday: "short"});
  const body = list.slice(0, 40).map((e, i) => {
    const p = e.id ? BY[e.id] : null;
    const name = p ? `<a href="#/p/${p.id}"><b>${esc(p.name)}</b></a>` : `<b>${esc(e.name)}</b>`;
    const chips = Object.keys(e.srcs).sort((a, b) => (b === "Fantasy Footballers") - (a === "Fantasy Footballers")).map(s => `<span class="tk good${s === "Fantasy Footballers" ? " ffb" : ""}">${esc(s)}</span>`).join(" ");
    const notes = (e.notes || []).slice(0, 2).map(n => `<div class="tiny" style="margin-top:3px"><span class="${n.src === "Fantasy Footballers" ? "v-good" : "muted"}">${esc(n.src)}:</span> <span class="ink2">${esc(n.note)}</span>${n.take === "stash" ? ' <span class="muted">(stash)</span>' : ""}</div>`).join("");
    const n = Object.keys(e.srcs).length;
    return `<div class="pl">${rnk(i)}${p ? head(p) : ""}<span class="grow">${name} <span class="muted small">${esc(e.pos || "")} · ${esc(e.team || "")}</span> ${ownBadge(e.own)} ${p ? injBadge(p) : ""} ${mine.has(e.id) ? '<span class="badge">on my roster</span>' : ""}<div style="margin-top:4px">${chips}</div>${notes}</span>
      <span class="r"><b>${n}</b><br><span class="muted tiny">source${n === 1 ? "" : "s"}</span></span></div>`;
  }).join("");
  return `<p class="small"><b>Week ${X.week} waivers</b> <span class="muted">· pickups for games ${weekDates(X.week)} ·</span> <b>Expert consensus</b></p>
  ${!ffbIn && ["Mon", "Tue"].includes(nowCT) ? `<div class="card small">Fantasy Footballers' picks aren't in yet (usually Tuesday around noon CT). They get added automatically.</div>` : ""}
  <div class="card list">${body || '<p class="muted">No expert waiver articles for this week yet.</p>'}</div>
  <p class="note">Sources: ${esc((X.sources || []).join(", ") || "none posted yet")}. Showing players rostered in ${maxOwn}% of ESPN leagues or fewer${hidden ? ` (${hidden} hidden as likely taken)` : ""}. Updated ${ago(X.updated)}.</p>`;
}

/* ---- compare ---- */
V.compare = (a, b) => {
  setTab("home");
  const A = BY[a];
  if (!A) return `<p>Pick a player first.</p>`;
  const pickB = `<div class="pick"><input id="pickb" placeholder="Compare ${esc(A.name)} with…" autocomplete="off"><div id="pickbs" class="sugg" hidden></div></div>`;
  if (!b || !BY[b]) {
    setTimeout(() => attachSearch($("#pickb"), $("#pickbs"), p => location.hash = `#/c/${a}/${p.id}`), 0);
    return `<h1>Compare</h1><p class="muted">${esc(A.name)} vs …</p>${pickB}`;
  }
  const B = BY[b], SA = summary(a), SB = summary(b);
  const rows = [];
  const sec = t => rows.push(`<tr class="sec"><td colspan="3">${t}</td></tr>`);
  // hi: true = higher is better, false = lower is better, null = no highlight
  const row = (label, va, vb, fmt = x => x, hi = true) => {
    let ca = "", cb = "";
    if (hi !== null && va != null && vb != null && isFinite(va) && isFinite(vb) && va !== vb) {
      const aw = hi ? va > vb : va < vb; ca = aw ? "win" : ""; cb = aw ? "" : "win";
    }
    rows.push(`<tr><td>${label}</td><td class="${ca}">${va == null ? "–" : fmt(va)}</td><td class="${cb}">${vb == null ? "–" : fmt(vb)}</td></tr>`);
  };
  const per = (s, k) => s.g ? s[k] / s.g : null;
  for (const [title, X, Y] of [["Season", SA.s, SB.s], [`Last 4 team games`, SA.l4, SB.l4]]) {
    sec(title);
    row("Games", X.g, Y.g, x => x, null);
    row(`${SCU()} pts/game`, X.ppg, Y.ppg, f1);
    row("Total pts", X.pts, Y.pts, f1);
    row("Snap %", X.snp, Y.snp, pct);
    if (A.pos === "QB" || B.pos === "QB") {
      row("Pass att/g", per(X, "att"), per(Y, "att"), f1); row("Cmp %", X.cpct, Y.cpct, pct);
      row("Pass yds/g", per(X, "pyd"), per(Y, "pyd"), f1); row("Pass TD", X.ptd, Y.ptd); row("INT", X.int, Y.int, x => x, false);
    }
    row("Carries/g", per(X, "car"), per(Y, "car"), f1); row("Rush yds/g", per(X, "ryd"), per(Y, "ryd"), f1);
    row("Yds/carry", X.ypc, Y.ypc, x => x.toFixed(1)); row("Rush TD", X.rtd, Y.rtd);
    row("Targets/g", per(X, "tgt"), per(Y, "tgt"), f1); row("Rec/g", per(X, "rec"), per(Y, "rec"), f1);
    row("Rec yds/g", per(X, "recyd"), per(Y, "recyd"), f1); row("Yds/target", X.ypt, Y.ypt, x => x.toFixed(1)); row("Rec TD", X.rectd, Y.rectd);
    row("Target share", X.tshare, Y.tshare, pct); row("Opportunity share", X.oshare, Y.oshare, pct); row("Carry share", X.cshare, Y.cshare, pct);
    row("Red zone carries", X.rzc, Y.rzc); row("Red zone targets", X.rzt, Y.rzt);
    row("Goal line carries", X.glc, Y.glc); row("Goal line targets", X.glt, Y.glt);
    row("Fumbles lost", X.fl, Y.fl, x => x, false);
  }
  const wk = nextWeek(), PA = projectX(a, wk), PB = projectX(b, wk), RA = rosX(a), RB = rosX(b);
  sec(`Outlook`);
  row(`Wk ${wk} projection`, PA.proj, PB.proj, f1);
  row(`Wk ${wk} opponent`, PA.bye ? "BYE" : `${PA.home ? "vs" : "@"} ${PA.opp}`, PB.bye ? "BYE" : `${PB.home ? "vs" : "@"} ${PB.opp}`, x => x, null);
  row(`Rest of season (to wk ${LAST_FANTASY_WEEK})`, RA.total, RB.total, f1);
  row("Schedule ease (1.00 = avg)", RA.sos, RB.sos, x => x.toFixed(2));
  row("Status", A.inj || "Healthy", B.inj || "Healthy", x => x, null);
  return `
  <h1>Compare</h1>
  ${anaPanel("compare", [a, b], true)}
  <div id="nums"><div class="scroll" style="margin-top:10px"><table class="cmp"><thead><tr><th></th><th><a href="#/p/${a}">${esc(A.name)}</a><br><span class="muted">${A.pos} · ${A.team}</span></th><th><a href="#/p/${b}">${esc(B.name)}</a><br><span class="muted">${B.pos} · ${B.team}</span></th></tr></thead>
  <tbody>${rows.join("")}</tbody></table></div>
  
  <div class="row wrap" style="margin:10px 0"><a class="btn ghost sm" href="#/c/${b}/${a}">Swap</a><button class="btn ghost sm" data-act="ss2" data-ids="${a},${b}">Start/Sit these two</button></div>
  ${roomTable(a)}${roomTable(b)}
  ${[a, b].map(id => { const P = projectX(id, wk); return `<h2>${esc(BY[id].name)}: week ${wk} factors</h2><ul class="why">${P.why.map(w => `<li>${esc(w.t)}</li>`).join("")}</ul>`; }).join("")}
  ${[a, b].map(id => { const c = (D.news?.cards || []).find(c => c.pid === id); return c ? `<h2>${esc(BY[id].name)}: latest news</h2>${newsCard(c, 3, false)}` : ""; }).join("")}
  </div>
  <h2>Change player</h2>${pickB}
  ${stamp()}`;
};

/* ---- news ---- */
/* Top news = what changes a lineup or a roster: injuries and practice status, IR, trades, signings,
   releases, suspensions, starting / depth-chart / role changes. Everything else (game recaps) is in All news. */
const BIG_NEWS = /injur|\bout\b|ruled out|questionable|doubtful|\bIR\b|injured reserve|placed on|activated|designated (him |\w+ )?(for|to) return|concussion|hamstring|ankle|knee|groin|calf|shoulder|foot\b|toe\b|back\b|achilles|acl\b|mcl\b|surgery|torn|fracture|sprain|strain|season-ending|week-to-week|day-to-day|traded|\btrade\b|acquired|signed|re-signed|released|waived|\bcut\b|claimed|suspend|benched|bench|named (the )?starter|will start|to start|starting (job|role|qb|quarterback|running back)|lead back|workhorse|demoted|promoted|depth chart|elevated|practice|\bDNP\b|did not practice|limited|full participant|return(s|ed|ing)? (to|from)|retire|reinstated|activated|holdout|expected to miss|will miss|miss(es)? time|sidelined|exits?|left (the game|sunday)|carted|evaluated|MRI|status|inactive|arrest|personal reasons|out for the season|\bPUP\b|game-time decision/i;
let ROS_RANK = null;
function relevant(c) {
  // fantasy-relevant players only: experts' top 250 rest-of-season, 8+ ppg (half PPR base), on his roster,
  // or a QB starting change
  if (!ROS_RANK) { ROS_RANK = {}; for (const r of (D.ros.players || [])) if (r.id) ROS_RANK[r.id] = r.ecr; }
  const p = BY[c.pid], it = (c.items || [])[0] || {};
  if (roster().includes(c.pid)) return true;
  if (ROS_RANK[c.pid] && ROS_RANK[c.pid] <= 250) return true;
  const half = (D.statsHalf || D.stats)[c.pid] || [], pi = D.meta.fields.indexOf("pts");
  if (half.length >= 2 && half.reduce((a, w) => a + w[pi], 0) / half.length >= 8) return true;
  if ((p?.pos || c.pos) === "QB" && /start/i.test(it.head || "")) return true;
  return false;
}
function isBig(c) {
  if (!relevant(c)) return false;
  const it = (c.items || [])[0] || {};
  if (it.status || it.injury) return true;
  return BIG_NEWS.test(it.head || "");
}
V.news = () => {
  setTab("news");
  const filt = V.news.f || "all", nv = V.news.v || "top";
  const mine = new Set(roster());
  let cards = nv === "top" ? D.news.cards.filter(isBig) : D.news.cards;
  const nTop = D.news.cards.filter(isBig).length;
  if (filt === "mine") cards = cards.filter(c => mine.has(c.pid));
  else if (filt !== "all") cards = cards.filter(c => (BY[c.pid]?.pos || c.pos) === filt);
  if (nv === "recap") return `<h1>News</h1>
  <div class="subtabs"><button data-nv="top">Top news (${nTop})</button><button data-nv="all">All news</button><button class="on" data-nv="recap">Week ${D.records.week} recap</button></div>
  ${recapView()}`;
  return `<h1>News</h1>
  <div class="subtabs"><button class="${nv === "top" ? "on" : ""}" data-nv="top">Top news (${nTop})</button><button class="${nv === "all" ? "on" : ""}" data-nv="all">All news</button>${(D.records || {}).week ? `<button class="${nv === "recap" ? "on" : ""}" data-nv="recap">Week ${D.records.week} recap</button>` : ""}</div>
  <p class="muted small">Updated ${ago(D.news.updated)}.</p>
  ${tabSearch("news", "Search news: player, team…")}
  <div class="seg">${["all","mine","QB","RB","WR","TE"].map(x => `<button class="chip ${x === filt ? "on" : ""}" data-nf="${x}">${x === "all" ? "All" : x === "mine" ? "My roster" : x}</button>`).join("")}</div>
  <div class="news-grid">${cards.slice(0, 300).map(c => newsCard(c)).join("") || `<p class="muted">Nothing yet.</p>`}</div>`;
};

/* ---- start/sit ---- */
function listPicker(key, label) {
  const ids = (V[key] = (V[key] || []).filter(id => BY[id]));
  return `<div class="pick"><input id="pk-${key}" placeholder="${label}" autocomplete="off"><div id="pks-${key}" class="sugg" hidden></div></div>
  <div class="chips" style="margin-top:8px">${ids.map(id => `<span class="chip">${esc(BY[id].name)} <span class="muted">${BY[id].pos}</span><span class="x" data-rm="${key}" data-id="${id}" role="button" aria-label="remove">✕</span></span>`).join("")}</div>`;
}
function wirePicker(key) {
  const i = $(`#pk-${key}`); if (!i) return;
  attachSearch(i, $(`#pks-${key}`), p => { if (!V[key].includes(p.id)) V[key].push(p.id); if (key === "rIds") setRoster(V.rIds); render(); setTimeout(() => $(`#pk-${key}`)?.focus(), 0); });
}
const SS_GROUPS = {QB: [["QB"], 1], RB: [["RB"], 2], WR: [["WR"], 2], TE: [["TE"], 1], FLEX: [["RB", "WR", "TE"], 6]};
function ssFromRoster(g) {
  const [poss, n] = SS_GROUPS[g], wk = nextWeek();
  const ps = roster().map(id => BY[id]).filter(p => p && poss.includes(p.pos));
  const ok = ps.filter(p => !OUT.has(p.inj) && byeWeek(p.team) !== wk);
  V.ssOut = ps.filter(p => !ok.includes(p)).map(p => `${p.name} (${OUT.has(p.inj) ? p.inj : "bye"})`);
  V.ssIds = ok.map(p => p.id); V.ssN = Math.min(n, Math.max(1, ok.length - 1)); V.ssGroup = g;
  V.ssSlots = Math.max(3, V.ssIds.length);
}
V.ss = () => {
  setTab("ss");
  V.ssIds = (V.ssIds || []).filter(id => BY[id]);
  V.ssSlots = Math.max(3, V.ssSlots || 3, V.ssIds.length + (V.ssIds.length >= 3 ? 0 : 1));
  const n = V.ssIds.length;
  V.ssN = Math.min(Math.max(1, V.ssN || 1), Math.max(1, n - 1));
  const wk = nextWeek();
  const r = roster().filter(id => BY[id] && !V.ssIds.includes(id));
  const slots = [];
  for (let i = 0; i < V.ssSlots; i++) {
    const id = V.ssIds[i];
    slots.push(id ? `<div class="pl-wrap">${plRow(BY[id])}<button class="rm" data-rm="ssIds" data-id="${id}" aria-label="Remove ${esc(BY[id].name)}">Remove</button></div>`
      : `<div class="pick" style="padding:8px 0;border-bottom:1px solid var(--line)"><input class="ss-slot" data-slot="${i}" placeholder="Player ${i + 1}: search…" autocomplete="off"><div class="sugg" hidden></div></div>`);
  }
  let out = "";
  if (n >= 2) {
    const res = V.ssIds.map(id => projectX(id, wk)).sort((x, y) => y.proj - x.proj);
    V.ssLast = {wk, res, start: V.ssN};
    out = anaPanel("startsit", [...res.map(x => x.id), "start" + V.ssN, rosterTag()], false) + `<div id="nums"><h2>Week ${wk} ranking · start ${V.ssN} of ${n}</h2>` + res.map((x, i) => `<div class="card rank"><div class="n">${i + 1}</div>
      <div class="grow"><a href="#/p/${x.id}"><b>${esc(x.p.name)}</b></a> <span class="muted small">${x.p.pos} · ${x.p.team}</span> ${injBadge(x.p)}
      <div class="small" style="margin-top:2px">${i < V.ssN ? '<b class="v-good">START</b>' : '<b class="v-bad">SIT</b>'}</div>
      <ul class="why">${x.why.map(w => `<li class="${w.neg ? "v-bad" : w.pos ? "v-good" : ""}" style="color:${w.neg || w.pos ? "" : "var(--ink2)"}">${esc(w.t)}</li>`).join("")}</ul></div>
      <div class="proj"><b>${f1(x.proj)}</b><span class="muted tiny">proj pts</span><div class="tiny muted" style="margin-top:4px">${x.bye ? "" : `${f1(x.floor)}–${f1(x.ceil)}`}</div></div></div>`).join("") +
      `</div><p class="note">${roster().length ? "Your roster is factored into the write-up (depth, byes, who else you could start). " : ""}Projection = expert consensus blended with our usage, matchup and injury numbers.</p>
      <button class="btn ghost" data-act="ask-ss">Ask the coach on Telegram</button>`;
  }
  return `<h1>Start / Sit</h1><p class="muted small"><b>Week ${wk} start/sit</b> (games ${weekDates(wk)}). Add 3 or more players, any positions. It ranks them all like a FLEX call.</p>
  <div class="card list">${slots.join("")}</div>
  <div class="row wrap" style="margin-top:8px"><button class="btn ghost sm" data-act="ss-add">+ Add player</button>
    ${n >= 2 ? `<span class="muted small" style="margin-left:6px">Slots to fill:</span>${Array.from({length: Math.max(1, n - 1)}, (_, i) => i + 1).map(k => `<button class="chip ${k === V.ssN ? "on" : ""}" data-ssn="${k}">${k}</button>`).join("")}` : ""}</div>
  ${out}`;
};

/* ---- trade ---- */
V.trade = () => {
  setTab("trade");
  V.give = V.give || []; V.get = V.get || [];
  let out = "";
  if (V.give.length && V.get.length) {
    const G = V.give.map(rosX), R = V.get.map(rosX);
    const tg = G.reduce((a, x) => a + x.total, 0), tr = R.reduce((a, x) => a + x.total, 0);
    const diff = tr - tg, pctd = diff / Math.max(tg, tr, 1);
    const verdict = pctd > 0.08 ? ["ACCEPT", "v-good", `You gain about ${f1(diff)} points rest of season (+${Math.round(pctd * 100)}%).`]
      : pctd < -0.08 ? ["DECLINE", "v-bad", `You lose about ${f1(-diff)} points rest of season (${Math.round(pctd * 100)}%).`]
      : ["CLOSE CALL", "v-even", `Within 8% either way (${diff >= 0 ? "+" : ""}${f1(diff)} pts). Decide on roster need.`];
    V.tradeLast = {G, R, tg, tr, verdict};
    const tcards = xs => `<div class="only-narrow">${xs.map(x => `<div class="card"><div class="row"><a href="#/p/${x.id}"><b>${esc(x.p.name)}</b></a><span class="muted small">${x.p.pos} · ${x.p.team}</span>${injBadge(x.p)}<b style="margin-left:auto">${f1(x.total)}</b><span class="muted tiny">ROS</span></div>${x.expertRank ? `<div class="small ink2">Experts ${esc(x.expertRank)} ROS (≈${f1(x.expertVal)} pts) · our numbers ${f1(x.ours)} → blended ${f1(x.total)}</div>` : ""}
      <div class="small ink2">${f1(x.base)}/g · L4 ${f1(x.S.l4.ppg)} · season ${f1(x.S.s.ppg)} · ${x.games} games left${x.miss ? ` (${esc(x.p.inj)}: misses ~${x.miss})` : ""} · sched ${x.sos.toFixed(2)} · share ${pct(share(x.p.pos, x.S.l4))} · room ×${x.roomAdj.toFixed(2)}</div></div>`).join("")}</div>`;
    const tbl = (xs, t) => `<h2>${t}</h2>${tcards(xs)}<div class="scroll only-wide"><table><thead><tr><th>Player</th><th>ROS pts</th><th>Experts</th><th>Ours</th><th>Per game</th><th>L4 ppg</th><th>Season ppg</th><th>Games left</th><th>Sched</th><th>Share L4</th><th>Room</th><th>Status</th></tr></thead><tbody>
      ${xs.map(x => `<tr><td><a href="#/p/${x.id}">${esc(x.p.name)}</a> <span class="muted">${x.p.pos}</span></td><td><b>${f1(x.total)}</b></td><td>${x.expertRank ? `${esc(x.expertRank)} (${f1(x.expertVal)})` : "–"}</td><td>${f1(x.ours ?? x.total)}</td><td>${f1(x.base)}</td><td>${f1(x.S.l4.ppg)}</td><td>${f1(x.S.s.ppg)}</td><td>${x.games}${x.miss ? ` <span class="muted">(${esc(x.p.inj)}, ~${x.miss} out)</span>` : ""}</td><td>${x.sos.toFixed(2)}</td><td>${pct(share(x.p.pos, x.S.l4))}</td><td>×${x.roomAdj.toFixed(2)}</td><td>${x.p.inj || "–"}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td>${f1(xs.reduce((a, x) => a + x.total, 0))}</td><td colspan="10"></td></tr></tbody></table></div>
      ${xs.flatMap(x => x.roomNotes.map(n => `<p class="small ink2">• ${esc(n.t)}</p>`)).join("")}
      ${xs.map(x => newsLine(x.id)).filter(Boolean).map(t => `<p class="small ink2">• ${esc(t)}</p>`).join("")}`;
    out = `<div id="nums"><div class="card"><div class="verdict ${verdict[1]}">${verdict[0]}</div><div>${verdict[2]}</div>
      <div class="small muted" style="margin-top:4px">You give ${f1(tg)} · you get ${f1(tr)} projected ${SCL()} points through week ${LAST_FANTASY_WEEK}.</div></div>
      ${tbl(G, "You give")}${tbl(R, "You get")}
      ${roster().length ? `<p class="note">Your roster is factored into the write-up (positional need, depth, byes).</p>` : `<p class="note">Add your players on the My Roster tab and the write-up will weigh positional need, depth and byes.</p>`}</div>
      ${anaPanel("trade", [...V.give, "|", ...V.get, rosterTag()], false)}
      <p class="note">Value = expert rest-of-season ranks blended with our numbers, through week ${LAST_FANTASY_WEEK}.</p>
      <button class="btn" data-act="ask-trade">Ask the coach</button> <span class="muted small">copies the numbers and opens @Clutchclips_bot</span>`;
  }
  return `<h1>Trade analyzer</h1><p class="muted small">Rest of season: weeks ${nextWeek()}–${LAST_FANTASY_WEEK}, experts + our numbers.</p>
  <div class="sides"><div class="card"><b>You give</b>${listPicker("give", "Add a player you give…")}</div>
  <div class="card"><b>You get</b>${listPicker("get", "Add a player you get…")}</div></div>
  ${out}`;
};

/* ---- roster ---- */
V.roster = () => {
  setTab("roster");
  const r = roster().filter(id => BY[id]);
  V.rIds = r;
  const order = {QB: 0, RB: 1, WR: 2, TE: 3};
  const sorted = r.map(id => BY[id]).sort((a, b) => (order[a.pos] - order[b.pos]) || (b.ppg - a.ppg));
  return `<h1>My roster</h1><p class="muted small">Saved on this device only. Used for Start/Sit quick picks and the News filter.</p>
  <div class="pick" style="margin-top:10px"><input id="pk-rIds" placeholder="Add a player to my roster…" autocomplete="off"><div id="pks-rIds" class="sugg" hidden></div></div>
  <div class="card list">${sorted.length ? sorted.map(p => `<div class="pl-wrap">${plRow(p)}<button class="rm" data-rm="rIds" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button></div>`).join("") : '<p class="muted">No players yet. Search above or paste names below.</p>'}</div>
  <h2>Paste names</h2>
  <textarea id="names" rows="4" placeholder="One per line or comma separated"></textarea>
  <div class="row" style="margin-top:8px"><button class="btn" data-act="paste">Add names</button><button class="btn ghost" data-act="clear">Clear roster</button></div>
  <p id="pastemsg" class="small muted"></p>
  <h2>Look</h2><div class="seg">${["gameday","classic"].map(x => `<button class="chip ${(document.documentElement.dataset.look || "gameday") === x ? "on" : ""}" data-theme="${x}">${x === "gameday" ? "Gameday" : "Classic purple"}</button>`).join("")}</div>
  <h2>Text colors</h2><div class="seg">${[["swap","White names, purple stats"],["ice","White names, neon blue stats"],["orig","Purple names, white stats"]].map(([x, l]) => `<button class="chip ${(document.documentElement.dataset.ink || "ice") === x ? "on" : ""}" data-setink="${x}">${l}</button>`).join("")}</div>`;
};

/* ---------------- the "Ask" button (the only place Claude is involved) ---------------- */
async function ask(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it to the coach."); }
  catch { prompt("Copy this and send it to @Clutchclips_bot:", text); }
  setTimeout(() => window.open(BOT, "_blank"), 400);
}
function askSS() {
  const {wk, res} = V.ssLast;
  return `Start/sit, week ${wk}, ${SCL()}, starting ${V.ssLast.start}. My FF Stat Hub numbers:\n` + res.map((x, i) => `${i + 1}. ${x.p.name} (${x.p.pos} ${x.p.team}) proj ${f1(x.proj)}: ` + x.why.map(w => w.t).join("; ")).join("\n") + `\nWho do I start? Short answer, Footballers take if they covered it.`;
}
function askTrade() {
  const {G, R, tg, tr, verdict} = V.tradeLast;
  const l = x => `${x.p.name} (${x.p.pos} ${x.p.team}): ROS ${f1(x.total)}, ${f1(x.base)}/g, L4 ${f1(x.S.l4.ppg)}, season ${f1(x.S.s.ppg)}, ${x.games} games left${x.miss ? ` (${x.p.inj}, misses ~${x.miss})` : ""}, sched ${x.sos.toFixed(2)}, ${x.p.inj || "healthy"}`;
  return `Trade check, ${SCL()}. FF Stat Hub says ${verdict[0]} (give ${f1(tg)} vs get ${f1(tr)} ROS pts).\nI give: ${G.map(l).join(" | ")}\nI get: ${R.map(l).join(" | ")}\nYour take in a few lines?`;
}

/* ---------------- written analysis (Claude, only when he asks; cached per player set per day) ---------------- */
const ANA = {};   // key -> {status, text, ...}
// Where write-ups get made: the iMac serves the site itself (same origin); on the public site the MacBook runs
// the same service at localhost:8766 (stathub serve, launchd com.enoch.stathub-serve). The phone has neither.
const API = /github\.io$|ffstathub\.com$/.test(location.hostname) ? "http://localhost:8766" : "";
const ANA_SECS = kind => kind === "compare" || kind === "trade" ? "about 1–2 minutes" : "about 30–60 seconds";
function anaKey(kind, ids) { return kind + ":" + (kind === "compare" ? [...ids].sort() : ids).join(","); }
function anaPanel(kind, ids, auto) {
  const k = anaKey(kind, ids), st = ANA[k];
  const label = kind === "compare" ? "Analysis" : kind === "trade" ? "Trade write-up" : kind === "profile" ? "Season write-up" : "Why this call";
  // No box at all until we know a write-up exists or can be made, and none when it can't (e.g. phone away from home).
  if (!st || st.status === "offline") return `<div id="ana" data-kind="${kind}" data-ids="${ids.join(",")}" hidden></div>`;
  let inner;
  if (st.status === "none") inner = auto ? `<p class="muted small"><span class="spin"></span>Starting…</p>`
    : `<button class="btn" data-act="ana" data-kind="${kind}">${kind === "startsit" ? "Explain this call" : "Write the analysis"}</button> <span class="muted small">${ANA_SECS(kind)}; checks this week's injury news</span>`;
  else if (st.status === "working") inner = `<p class="muted small"><span class="spin"></span>Writing it now: pulling this week's injury and news context, then reading the numbers. ${ANA_SECS(kind)[0].toUpperCase() + ANA_SECS(kind).slice(1)}.</p>`;
  else if (st.status === "error") inner = `<p class="small v-bad">${esc(st.error || "Couldn't write it.")}</p><button class="btn ghost sm" data-act="ana" data-kind="${kind}">Try again</button>`;
  else if (st.status === "offline") inner = `<p class="small muted">Can't write this one right now. Try again later.</p>`;
  else inner = md(st.text) + `<p class="note">Written ${when(st.at)} from the numbers ${kind === "profile" ? "on this page" : "above"} plus a web check of injuries and news. Saved ${kind === "profile" ? "until next week's stats land" : "for today"}, so reopening it is free.</p>`;
  return `<div class="ana" id="ana" data-kind="${kind}" data-ids="${ids.join(",")}"><div class="lbl">${label}</div>${inner}</div>`;
}
function md(t) {
  const lines = esc(t || "").split("\n"); let out = "", inList = false;
  const inline = x => x.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>");
  for (const ln of lines) {
    const l = ln.trim();
    if (/^[-*] /.test(l)) { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${inline(l.slice(2))}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    if (/^#{1,4} /.test(l)) out += `<h3>${inline(l.replace(/^#+ /, ""))}</h3>`;
    else if (l) out += `<p>${inline(l)}</p>`;
  }
  return out + (inList ? "</ul>" : "");
}
async function anaCheck(kind, ids, auto) {
  const k = anaKey(kind, ids);
  if (ANA[k] && ANA[k].status !== "none") { if (ANA[k].status === "working") anaPoll(kind, ids); return; }
  try {
    const r = await fetch(`${API}/api/analysis?kind=${kind}&ids=${encodeURIComponent(ids.join(","))}`);
    if (!r.ok) throw 0;
    ANA[k] = await r.json();
  } catch { ANA[k] = await published(kind, ids); }
  if (ANA[k].status === "working") anaPoll(kind, ids);
  else if (ANA[k].status === "none" && auto) return anaStart(kind, ids);
  refreshAna(kind, ids);
}
/* On the phone (GitHub Pages) there's no iMac server: show a write-up if one was already made today. */
async function published(kind, ids) {
  try {
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const period = kind === "profile" ? "wk" + D.meta.week : day;
    const idx = ANA._idx || (ANA._idx = await load("analysis/index"));
    const f = idx[`${period}|${kind}|${(kind === "compare" ? [...ids].sort() : ids).join(",")}`];
    if (f) return await load("analysis/" + f);
  } catch {}
  return {status: "offline"};
}
async function anaStart(kind, ids) {
  const k = anaKey(kind, ids);
  let nums = `Scoring: ${SC[SCORING][3]}.\n` + ($("#nums")?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 11000);
  if (kind === "trade" || kind === "startsit") nums += "\n\n" + rosterText(kind === "trade" ? V.give : [], kind === "trade" ? V.get : []);
  const names = ids.map(id => BY[id]?.name || id);
  ANA[k] = {status: "working"}; refreshAna(kind, ids);
  try {
    const r = await fetch(`${API}/api/analysis`, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({kind, ids, names, numbers: nums})});
    if (!r.ok) throw 0;
    ANA[k] = await r.json();
  } catch { ANA[k] = {status: "offline"}; }
  refreshAna(kind, ids);
  if (ANA[k].status === "working") anaPoll(kind, ids);
}
function anaPoll(kind, ids) {
  const k = anaKey(kind, ids);
  clearTimeout(anaPoll.t);
  anaPoll.t = setTimeout(async () => {
    try { const r = await fetch(`${API}/api/analysis?kind=${kind}&ids=${encodeURIComponent(ids.join(","))}`); ANA[k] = await r.json(); } catch {}
    refreshAna(kind, ids);
    if (ANA[k]?.status === "working") anaPoll(kind, ids);
  }, 3000);
}
function refreshAna(kind, ids) {
  const el = $("#ana");
  if (el && el.dataset.kind === kind && el.dataset.ids === ids.join(",")) el.outerHTML = anaPanel(kind, ids, false);
}

/* ---------------- router ---------------- */
function render() {
  const h = location.hash.replace(/^#\/?/, "");
  const [r, a, b] = h.split("/");
  let html;
  if (r === "p") html = V.player(a);
  else if (r === "c") html = V.compare(a, b);
  else if (!r || r === "news") html = V.news();
  else if (r === "records") html = V.records();   // News is the landing page
  else if (r === "waivers") html = V.waivers();
  else if (r === "ss") html = V.ss();
  else if (r === "trade") html = V.trade();
  else if (r && r.startsWith("roster")) html = V.roster();
  else html = V.home();
  $("#app").innerHTML = html;
  setTimeout(applyTabQ, 0);
  ["give", "get", "rIds"].forEach(wirePicker);
  const sq = $("#sched-q");
  if (sq) attachSearch(sq, sq.nextElementSibling, p => { V.schedP = p.id; if (["QB","RB","WR","TE"].includes(p.pos)) V.home.pos = p.pos; render(); });
  document.querySelectorAll(".ss-slot").forEach(inp => attachSearch(inp, inp.nextElementSibling, p => {
    if (!V.ssIds.includes(p.id)) V.ssIds.push(p.id);
    render(); setTimeout(() => document.querySelector(".ss-slot")?.focus(), 0);
  }));
  const anaEl = $("#ana");
  if (anaEl) anaCheck(anaEl.dataset.kind, anaEl.dataset.ids.split(","), anaEl.dataset.kind === "compare" || anaEl.dataset.kind === "profile");
}
let lastHash = "";
window.addEventListener("hashchange", () => { if (location.hash.split("/")[1] !== lastHash.split("/")[1] || location.hash.startsWith("#/p") || location.hash.startsWith("#/c")) scrollTo(0, 0); lastHash = location.hash; render(); });

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act],[data-pos],[data-nf],[data-nv],[data-rm],[data-addss],[data-ssn],[data-view],[data-theme],[data-setink],[data-ssg],[data-mxs],[data-wpos],[data-wv],[data-own],[data-sched]");
  if (!t) return;
  if (t.dataset.pos) { V.home.pos = t.dataset.pos; render(); return; }
  if (t.dataset.view) { V.home.view = t.dataset.view; render(); return; }
  if (t.dataset.wv) { V.wView = t.dataset.wv; render(); return; }
  if (t.dataset.mxs) { V.mx = {sort: t.dataset.mxs}; render(); return; }
  if (t.dataset.wpos) { V.wPos = t.dataset.wpos; render(); return; }
  if (t.dataset.own) { try { localStorage.setItem("ownMax", t.dataset.own); } catch {} render(); return; }
  if (t.dataset.setink) { try { localStorage.setItem("ink", t.dataset.setink); } catch {} document.documentElement.dataset.ink = t.dataset.setink; render(); return; }
  if (t.dataset.theme) { try { localStorage.setItem("theme", t.dataset.theme); } catch {} document.documentElement.dataset.look = t.dataset.theme; render(); window.dispatchEvent(new Event("resize")); document.dispatchEvent(new Event("visibilitychange")); return; }
  if (t.dataset.nf) { V.news.f = t.dataset.nf; render(); return; }
  if (t.dataset.nv) { V.news.v = t.dataset.nv; render(); return; }
  if (t.dataset.rm) { V[t.dataset.rm] = V[t.dataset.rm].filter(x => x !== t.dataset.id); if (t.dataset.rm === "rIds") setRoster(V.rIds); render(); return; }
  if (t.dataset.ssn) { V.ssN = +t.dataset.ssn; render(); return; }
  if (t.dataset.ssg) { ssFromRoster(t.dataset.ssg); render(); return; }
  if (t.dataset.addss) { V.ssIds = V.ssIds || []; V.ssIds.push(t.dataset.addss); render(); return; }
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case "ss": V.ssIds = V.ssIds || []; if (!V.ssIds.includes(id)) V.ssIds.push(id); location.hash = "#/ss"; break;
    case "ss2": V.ssIds = t.dataset.ids.split(","); location.hash = "#/ss"; break;
    case "trade": V.give = V.give || []; V.get = V.get || []; (roster().includes(id) ? V.give : V.get).push(id); location.hash = "#/trade"; break;
    case "mine": { const r = roster(); setRoster(r.includes(id) ? r.filter(x => x !== id) : [...r, id]); render(); break; }
    case "paste": {
      const names = $("#names").value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      const r = roster(), miss = [];
      for (const n of names) { const p = matchName(n); if (p) { if (!r.includes(p.id)) r.push(p.id); } else miss.push(n); }
      setRoster(r); render();
      $("#pastemsg").textContent = `Added ${names.length - miss.length}.` + (miss.length ? ` Not found: ${miss.join(", ")}` : "");
      break;
    }
    case "clear": setRoster([]); render(); break;
    case "ask-ss": ask(askSS()); break;
    case "whide": V.wHide = !V.wHide; render(); break;
    case "ss-clear": V.ssIds = []; V.ssOut = []; V.ssGroup = null; V.ssSlots = 3; V.ssN = 1; render(); break;
    case "ss-add": V.ssSlots = (V.ssSlots || 3) + 1; render(); setTimeout(() => [...document.querySelectorAll(".ss-slot")].pop()?.focus(), 0); break;
    case "ana": { const a = $("#ana"); anaStart(a.dataset.kind, a.dataset.ids.split(",")); break; }
    case "ask-trade": ask(askTrade()); break;
  }
});

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    [D.meta, D.players, D.stats, D.teams] = await Promise.all(["meta", "players", "stats", "teams"].map(load));
    D.news = await load("news").catch(() => ({cards: [], updated: D.meta.updated}));
    D.kdef = await load("kdef").catch(() => ({K: [], DEF: []}));
    D.ros = await load("ros").catch(() => ({players: []}));
    D.weekly = await load("weekly").catch(() => ({pos: {}}));
    D.weeklyPrev = await load("weekly_prev").catch(() => ({pos: {}}));
    D.consensus = await load("consensus").catch(() => ({}));
    D.wcons = await load("waiver_consensus").catch(() => ({players: []}));
    D.luck = await load("luck").catch(() => ({players: {}}));
    D.waivers = await load("waivers").catch(() => ({players: []}));
    D.records = await load("records").catch(() => ({}));
    buildKDefDvp();
    applyScoring();
  } catch (e) {
    $("#app").innerHTML = `<p>Couldn't load the data (${esc(e.message)}). Pull to refresh.</p>`; return;
  }
  BY = Object.fromEntries(D.players.map(p => [p.id, p]));
  // roster import link: #/roster?set=Name|Name
  const m = location.hash.match(/^#\/roster\?set=(.+)$/);
  if (m) {
    const ids = decodeURIComponent(m[1]).split("|").map(matchName).filter(Boolean).map(p => p.id);
    setRoster([...new Set([...roster(), ...ids])]);
    history.replaceState(null, "", "#/roster");
  }
  attachSearch($("#q"), $("#sugg"), p => location.hash = `#/p/${p.id}`);
  const scSel = $("#scoring");
  if (scSel) { scSel.value = SCORING; scSel.addEventListener("change", () => { SCORING = scSel.value; try { localStorage.setItem("scoring", SCORING); } catch {} applyScoring(); render(); toast(`Scoring: ${SC[SCORING][3]}`); }); }
  render();
})();

