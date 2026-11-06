/* Stat Hub — plain JS, no build step. Data comes from data/*.json written by ~/.atlas/bin/stathub. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const D = {};               // meta, players, stats, teams, news
let BY = {};                // id -> player
let F = {};                 // field name -> index
const LAST_FANTASY_WEEK = 17;
const BOT = "https://t.me/Clutchclips_bot";

async function load(name) {
  const r = await fetch(`data/${name}.json?t=${Date.now() / 600000 | 0}`);
  if (!r.ok) throw new Error(name + " " + r.status);
  return r.json();
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
function head(p, size = 36) {
  return p.head ? `<img src="${esc(p.head)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background:var(--panel2)" loading="lazy">`
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
function search(q, limit = 8) {
  const n = norm(q); if (!n) return [];
  const parts = n.split(" ");
  const out = [];
  for (const p of D.players) {
    const pn = p._n || (p._n = norm(p.name));
    const words = pn.split(" ");
    let ok = parts.every(t => words.some(w => w.startsWith(t)) || pn.startsWith(t));
    if (!ok && n.length > 3) ok = pn.includes(n);
    if (ok) { out.push(p); if (out.length >= 60) break; }
  }
  return out.slice(0, limit);   // players.json is already sorted by ppg, so the best guesses come first
}
function attachSearch(input, box, onPick) {
  let sel = 0, res = [];
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
  if (mf.allowed != null) why.push({t: `${g[2] ? "vs" : "@"} ${opp}: allows ${f1(mf.allowed)} half-PPR pts/g to ${p.pos}s (league avg ${f1(mf.lg)}), ${mtxt} → ×${mf.f.toFixed(2)}`, neg: mf.f < 0.97, pos: mf.f > 1.03});
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

/* ---------------- views ---------------- */
const V = {};
function setTab(t) { document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === t)); }
function stamp() {
  const c = D.meta.check || {};
  return `<p class="note">Week ${D.meta.week} stats · updated ${ago(D.meta.updated)} · ${c.games_checked}/${c.games_final} games cross-checked vs ESPN box scores (${c.fixes} corrected) · half PPR</p>`;
}

const LIST_LEN = {QB: 36, RB: 60, WR: 72, TE: 36, FLEX: 100, K: 32, DEF: 32};
const MIN_GP = 3;
function rnk(i) { return `<span class="rk ${i === 0 ? "gold" : ""}">${i + 1}</span>`; }
V.home = () => {
  setTab("home");
  const view = V.home.view || "ppg";
  const pos = V.home.pos || "RB";
  const sub = `<div class="subtabs"><button class="${view === "ppg" ? "on" : ""}" data-view="ppg">Points per game</button><button class="${view === "ros" ? "on" : ""}" data-view="ros">Rest of season</button></div>`;
  const posSeg = `<div class="seg">${["QB","RB","WR","TE","FLEX","K","DEF"].map(x => `<button class="chip ${x === pos ? "on" : ""}" data-pos="${x}">${x}</button>`).join("")}</div>`;
  return `<h1>Rankings</h1>${sub}${posSeg}${view === "ros" ? rosList(pos) : ppgList(pos)}${stamp()}`;
};
function ppgList(pos) {
  const n = LIST_LEN[pos];
  let list;
  if (pos === "K") list = (D.kdef.K || []).filter(k => k.gp >= MIN_GP).slice(0, n).map(kRow).join("");
  else if (pos === "DEF") list = (D.kdef.DEF || []).slice(0, n).map(defRow).join("");
  else {
    const ok = pos === "FLEX" ? (p => p.pos === "RB" || p.pos === "WR" || p.pos === "TE") : (p => p.pos === pos);
    list = D.players.filter(p => ok(p) && p.gp >= MIN_GP).slice(0, n).map((p, i) => plRow(p, i)).join("");
  }
  const note = pos === "K" ? "Kickers: FG 0–39 = 3, 40–49 = 4, 50+ = 5, PAT = 1."
    : pos === "DEF" ? "Defenses: sack 1, INT / fumble rec / safety / block 2, TD 6, plus points-allowed tiers (0 = 10 … 35+ = −4)." : "";
  return `<p class="muted small">Half-PPR points per game · top ${n} · at least ${MIN_GP} games played.</p>
  <div class="card list">${list || '<p class="muted">No data yet.</p>'}</div>${note ? `<p class="note">${note}</p>` : ""}`;
}
function kRow(k, i) {
  return `<div class="pl">${rnk(i)}${head(k)}<span class="grow"><b>${esc(k.name)}</b><br><span class="muted small">K · ${k.team} · ${k.gp} gp · FG ${k.fgm}/${k.fga} · 50+: ${k.fg50} · PAT ${k.pat}${k.patm ? "/" + (k.pat + k.patm) : ""}</span></span><span class="r"><b>${f1(k.ppg)}</b><br><span class="muted tiny">ppg</span></span></div>`;
}
function defRow(d, i) {
  return `<div class="pl">${rnk(i)}<span class="grow"><b>${esc(d.team)} D/ST</b><br><span class="muted small">${d.gp} gp · ${d.sack} sacks · ${d.int} INT · ${d.fr} FR · ${d.td} TD · allows ${f1(d.papg)}/g</span></span><span class="r"><b>${f1(d.ppg)}</b><br><span class="muted tiny">ppg</span></span></div>`;
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
  const body = rows.map((r, i) => {
    const p = r.id ? BY[r.id] : null;
    const name = p ? `<a href="#/p/${p.id}"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`;
    const sig = r.sig ? `<span class="sig ${r.sig === "BUY" ? "buy" : "sell"}" title="Expert ${lbl}${r.ecrRank} vs our ${lbl}${r.ourRank}">${r.sig}</span>` : "";
    const why = r.sig && r.det ? sigWhy(r) : "";
    return `<div class="pl">${rnk(i)}${p ? head(p) : ""}<span class="grow">${name} ${p ? injBadge(p) : ""} ${sig}<br><span class="muted small">${r.pos} · ${r.team}${r.bye ? " · bye " + r.bye : ""} · experts ${lbl}${r.ecrRank} (overall ${r.ecr}, range ${r.min}–${r.max})${r.ourRank ? ` · ours ${lbl}${r.ourRank}` : ""}</span>${why ? `<br><span class="tiny ${r.sig === "BUY" ? "v-good" : "v-bad"}">${esc(why)}</span>` : ""}</span>
      <span class="r"><b>${r.ours == null ? "–" : f1(r.ours)}</b><br><span class="muted tiny">our ROS pts</span></span></div>`;
  }).join("");
  const buys = rows.filter(r => r.sig === "BUY").length, sells = rows.filter(r => r.sig === "SELL").length;
  return `<p class="muted small">Ordered by the expert consensus (${esc(D.ros.source || "FantasyPros")}). Our ROS points = per-game value × each remaining opponent through week ${LAST_FANTASY_WEEK} × teammate changes × injuries.
  <b class="v-good">BUY</b> = our numbers rank him well above the experts; <b class="v-bad">SELL</b> = well below. ${buys} buys · ${sells} sells.</p>
  <div class="card list">${body || '<p class="muted">No consensus data yet.</p>'}</div>`;
}
function plRow(p, i) {
  return `<a class="pl" href="#/p/${p.id}">${typeof i === "number" ? rnk(i) : ""}${head(p)}<span class="grow"><b>${esc(p.name)}</b> ${injBadge(p)}<br><span class="muted small">${p.pos} · ${p.team}${p.gp ? ` · ${p.gp} gp` : ""}</span></span><span class="r"><b>${p.gp ? f1(p.ppg) : "–"}</b><br><span class="muted tiny">ppg</span></span></a>`;
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
  return `<h2>${label} · ${p.team}</h2>
  <div class="scroll"><table class="room"><thead><tr><th>Player</th><th>Status</th><th>${p.pos === "RB" ? "Opp" : "Tgt"} share L4</th><th></th><th>Season</th><th>Car L4</th><th>Tgt L4</th><th>RZ L4</th><th>GL L4</th><th>Snap% L4</th></tr></thead><tbody>
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
    <div class="row">${link ? `<a href="#/p/${c.pid}" class="row" style="color:var(--ink)">${head(p, 32)}<b>${esc(p.name || c.name)}</b></a>` : ""}<span class="muted small">${esc(p.pos || c.pos)} · ${esc(p.team || c.team)}</span> ${BY[c.pid] ? injBadge(BY[c.pid]) : ""}<span class="muted small" style="margin-left:auto">${ago(c.updated)}</span></div>
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
  <div class="hero">${p.head ? `<img src="${esc(p.head)}" alt="">` : `<span style="width:72px;height:72px;border-radius:50%;background:var(--panel2)"></span>`}
    <div class="grow"><h1>${esc(p.name)}</h1>
    <div class="muted">${p.pos} · ${p.team}${p.num ? " #" + p.num : ""}${p.age ? " · age " + p.age : ""}${p.yrs != null ? " · yr " + (p.yrs + 1) : ""}</div>
    <div style="margin-top:4px">${injBadge(p)} ${nxt ? `<span class="badge">Wk ${nxt[0]} ${nxt[2] ? "vs" : "@"} ${nxt[1]}</span>` : ""}</div></div></div>
  <div class="row wrap" style="margin:12px 0">
    <a class="btn" href="#/c/${id}">Compare</a>
    <button class="btn ghost" data-act="ss" data-id="${id}">Start/Sit</button>
    <button class="btn ghost" data-act="trade" data-id="${id}">Trade</button>
    <button class="btn ghost" data-act="mine" data-id="${id}">${mine ? "✓ On my roster" : "+ My roster"}</button>
  </div>
  ${p.injn ? `<p class="small ink2">${esc(p.injn)}</p>` : ""}
  <h2>Season · ${S.gp} games</h2>${S.gp ? statTiles(p, S.s) : `<p class="muted">No stats yet this season.</p>`}
  ${S.l4gp ? `<h2>Last ${S.l4gp} games</h2>${statTiles(p, L4)}` : ""}
  ${S.gp ? `<h2>Week by week</h2>${weekTable(p, S.ws)}` : ""}
  ${roomTable(id)}
  <h2>Latest news</h2>${newsFor(id)}
  ${stamp()}`;
};

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
    row("Half-PPR pts/game", X.ppg, Y.ppg, f1);
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
  const wk = nextWeek(), PA = project(a, wk), PB = project(b, wk), RA = ros(a), RB = ros(b);
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
  <p class="note">Green = the better number.</p>
  <div class="row wrap" style="margin:10px 0"><a class="btn ghost sm" href="#/c/${b}/${a}">Swap</a><button class="btn ghost sm" data-act="ss2" data-ids="${a},${b}">Start/Sit these two</button></div>
  ${roomTable(a)}${roomTable(b)}
  ${[a, b].map(id => { const P = project(id, wk); return `<h2>${esc(BY[id].name)}: week ${wk} factors</h2><ul class="why">${P.why.map(w => `<li>${esc(w.t)}</li>`).join("")}</ul>`; }).join("")}
  ${[a, b].map(id => { const c = (D.news?.cards || []).find(c => c.pid === id); return c ? `<h2>${esc(BY[id].name)}: latest news</h2>${newsCard(c, 3, false)}` : ""; }).join("")}
  </div>
  <h2>Change player</h2>${pickB}
  ${stamp()}`;
};

/* ---- news ---- */
V.news = () => {
  setTab("news");
  const filt = V.news.f || "all";
  const mine = new Set(roster());
  let cards = D.news.cards;
  if (filt === "mine") cards = cards.filter(c => mine.has(c.pid));
  else if (filt !== "all") cards = cards.filter(c => (BY[c.pid]?.pos || c.pos) === filt);
  return `<h1>News</h1>
  <p class="muted small">One card per player. A new report updates the card; repeats are folded in. Updated ${ago(D.news.updated)}.</p>
  <div class="seg">${["all","mine","QB","RB","WR","TE"].map(x => `<button class="chip ${x === filt ? "on" : ""}" data-nf="${x}">${x === "all" ? "All" : x === "mine" ? "My roster" : x}</button>`).join("")}</div>
  ${cards.slice(0, 120).map(c => newsCard(c)).join("") || `<p class="muted">Nothing yet.</p>`}`;
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
    const res = V.ssIds.map(id => project(id, wk)).sort((x, y) => y.proj - x.proj);
    V.ssLast = {wk, res, start: V.ssN};
    out = anaPanel("startsit", [...res.map(x => x.id), "start" + V.ssN], false) + `<div id="nums"><h2>Week ${wk} ranking · start ${V.ssN} of ${n}</h2>` + res.map((x, i) => `<div class="card rank"><div class="n">${i + 1}</div>
      <div class="grow"><a href="#/p/${x.id}"><b>${esc(x.p.name)}</b></a> <span class="muted small">${x.p.pos} · ${x.p.team}</span> ${injBadge(x.p)}
      <div class="small" style="margin-top:2px">${i < V.ssN ? '<b class="v-good">START</b>' : '<b class="v-bad">SIT</b>'}</div>
      <ul class="why">${x.why.map(w => `<li class="${w.neg ? "v-bad" : w.pos ? "v-good" : ""}" style="color:${w.neg || w.pos ? "" : "var(--ink2)"}">${esc(w.t)}</li>`).join("")}</ul></div>
      <div class="proj"><b>${f1(x.proj)}</b><span class="muted tiny">proj pts</span><div class="tiny muted" style="margin-top:4px">${x.bye ? "" : `${f1(x.floor)}–${f1(x.ceil)}`}</div></div></div>`).join("") +
      `</div><p class="note">Ranked across positions on projected half-PPR points, so RB vs WR vs TE works like a FLEX call; the small range is floor–ceiling. Projection = 60% last-4 average + 40% season average, × matchup (points the defense allows to the position, half weight), × backfield/room changes, × injury. Every factor is listed.</p>
      <button class="btn ghost" data-act="ask-ss">Ask the coach on Telegram</button>`;
  }
  return `<h1>Start / Sit</h1><p class="muted small">Add 3 or more players, any positions. It ranks them all like a FLEX call. Week ${wk}.</p>
  <div class="card list">${slots.join("")}</div>
  <div class="row wrap" style="margin-top:8px"><button class="btn ghost sm" data-act="ss-add">+ Add player</button>
    ${n >= 2 ? `<span class="muted small" style="margin-left:6px">Slots to fill:</span>${Array.from({length: Math.max(1, n - 1)}, (_, i) => i + 1).map(k => `<button class="chip ${k === V.ssN ? "on" : ""}" data-ssn="${k}">${k}</button>`).join("")}` : ""}</div>
  ${r.length ? `<p class="small muted" style="margin:10px 0 4px">From my roster:</p><div class="chips">${r.map(id => `<button class="chip" data-addss="${id}">+ ${esc(BY[id].name)}</button>`).join("")}</div>` : ""}
  ${out}`;
};

/* ---- trade ---- */
V.trade = () => {
  setTab("trade");
  V.give = V.give || []; V.get = V.get || [];
  let out = "";
  if (V.give.length && V.get.length) {
    const G = V.give.map(ros), R = V.get.map(ros);
    const tg = G.reduce((a, x) => a + x.total, 0), tr = R.reduce((a, x) => a + x.total, 0);
    const diff = tr - tg, pctd = diff / Math.max(tg, tr, 1);
    const verdict = pctd > 0.08 ? ["ACCEPT", "v-good", `You gain about ${f1(diff)} points rest of season (+${Math.round(pctd * 100)}%).`]
      : pctd < -0.08 ? ["DECLINE", "v-bad", `You lose about ${f1(-diff)} points rest of season (${Math.round(pctd * 100)}%).`]
      : ["CLOSE CALL", "v-even", `Within 8% either way (${diff >= 0 ? "+" : ""}${f1(diff)} pts). Decide on roster need.`];
    V.tradeLast = {G, R, tg, tr, verdict};
    const tbl = (xs, t) => `<h2>${t}</h2><div class="scroll"><table><thead><tr><th>Player</th><th>ROS pts</th><th>Per game</th><th>L4 ppg</th><th>Season ppg</th><th>Games left</th><th>Sched</th><th>Share L4</th><th>Room</th><th>Status</th></tr></thead><tbody>
      ${xs.map(x => `<tr><td><a href="#/p/${x.id}">${esc(x.p.name)}</a> <span class="muted">${x.p.pos}</span></td><td><b>${f1(x.total)}</b></td><td>${f1(x.base)}</td><td>${f1(x.S.l4.ppg)}</td><td>${f1(x.S.s.ppg)}</td><td>${x.games - x.miss}${x.miss ? ` <span class="muted">(-${x.miss})</span>` : ""}</td><td>${x.sos.toFixed(2)}</td><td>${pct(share(x.p.pos, x.S.l4))}</td><td>×${x.roomAdj.toFixed(2)}</td><td>${x.p.inj || "–"}</td></tr>`).join("")}
      <tr class="tot"><td>Total</td><td>${f1(xs.reduce((a, x) => a + x.total, 0))}</td><td colspan="8"></td></tr></tbody></table></div>
      ${xs.flatMap(x => x.roomNotes.map(n => `<p class="small ink2">• ${esc(n.t)}</p>`)).join("")}
      ${xs.map(x => newsLine(x.id)).filter(Boolean).map(t => `<p class="small ink2">• ${esc(t)}</p>`).join("")}`;
    out = `<div id="nums"><div class="card"><div class="verdict ${verdict[1]}">${verdict[0]}</div><div>${verdict[2]}</div>
      <div class="small muted" style="margin-top:4px">You give ${f1(tg)} · you get ${f1(tr)} projected half-PPR points through week ${LAST_FANTASY_WEEK}.</div></div>
      ${tbl(G, "You give")}${tbl(R, "You get")}</div>
      ${anaPanel("trade", [...V.give, "|", ...V.get], false)}
      <p class="note">ROS points = per-game value (75% season + 25% last 4, × usage trend: last-4 share vs season, half weight) × each remaining opponent's points allowed to the position (half weight) × room changes, minus games lost to injury (IR = 4 weeks, Out = 1). Byes counted. Sched 1.00 = average; higher = easier.</p>
      <button class="btn" data-act="ask-trade">Ask the coach</button> <span class="muted small">copies the numbers and opens @Clutchclips_bot</span>`;
  }
  return `<h1>Trade analyzer</h1>
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
  <h2>Look</h2><div class="seg">${["gameday","classic"].map(x => `<button class="chip ${(document.documentElement.dataset.look || "gameday") === x ? "on" : ""}" data-theme="${x}">${x === "gameday" ? "Gameday" : "Classic purple"}</button>`).join("")}</div>`;
};

/* ---------------- the "Ask" button (the only place Claude is involved) ---------------- */
async function ask(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it to the coach."); }
  catch { prompt("Copy this and send it to @Clutchclips_bot:", text); }
  setTimeout(() => window.open(BOT, "_blank"), 400);
}
function askSS() {
  const {wk, res} = V.ssLast;
  return `Start/sit, week ${wk}, half PPR, starting ${V.ssLast.start}. My Stat Hub numbers:\n` + res.map((x, i) => `${i + 1}. ${x.p.name} (${x.p.pos} ${x.p.team}) proj ${f1(x.proj)}: ` + x.why.map(w => w.t).join("; ")).join("\n") + `\nWho do I start? Short answer, Footballers take if they covered it.`;
}
function askTrade() {
  const {G, R, tg, tr, verdict} = V.tradeLast;
  const l = x => `${x.p.name} (${x.p.pos} ${x.p.team}): ROS ${f1(x.total)}, ${f1(x.base)}/g, L4 ${f1(x.S.l4.ppg)}, season ${f1(x.S.s.ppg)}, ${x.games - x.miss} games left, sched ${x.sos.toFixed(2)}, ${x.p.inj || "healthy"}`;
  return `Trade check, half PPR. Stat Hub says ${verdict[0]} (give ${f1(tg)} vs get ${f1(tr)} ROS pts).\nI give: ${G.map(l).join(" | ")}\nI get: ${R.map(l).join(" | ")}\nYour take in a few lines?`;
}

/* ---------------- written analysis (Claude, only when he asks; cached per player set per day) ---------------- */
const ANA = {};   // key -> {status, text, ...}
function anaKey(kind, ids) { return kind + ":" + (kind === "compare" ? [...ids].sort() : ids).join(","); }
function anaPanel(kind, ids, auto) {
  const k = anaKey(kind, ids), st = ANA[k];
  const label = kind === "compare" ? "Analysis" : kind === "trade" ? "Trade write-up" : "Start/sit write-up";
  let inner;
  if (!st || st.status === "none") inner = auto ? `<p class="muted small"><span class="spin"></span>Starting…</p>`
    : `<button class="btn" data-act="ana" data-kind="${kind}">Write the analysis</button> <span class="muted small">about 30–60 seconds; checks this week's injury news</span>`;
  else if (st.status === "working") inner = `<p class="muted small"><span class="spin"></span>Writing it now: pulling this week's injury and news context, then reading the numbers. About 30–60 seconds.</p>`;
  else if (st.status === "error") inner = `<p class="small v-bad">${esc(st.error || "Couldn't write it.")}</p><button class="btn ghost sm" data-act="ana" data-kind="${kind}">Try again</button>`;
  else if (st.status === "offline") inner = `<p class="small muted">Written analysis runs on the iMac. Open the hub from the iMac's address (http://192.168.68.62:8765) to use it.</p>`;
  else inner = md(st.text) + `<p class="note">Written ${when(st.at)} from the numbers above plus a web check of injuries and news. Saved for today, so reopening it is free.</p>`;
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
    const r = await fetch(`/api/analysis?kind=${kind}&ids=${encodeURIComponent(ids.join(","))}`);
    if (!r.ok) throw 0;
    ANA[k] = await r.json();
  } catch { ANA[k] = {status: "offline"}; }
  if (ANA[k].status === "working") anaPoll(kind, ids);
  else if (ANA[k].status === "none" && auto) return anaStart(kind, ids);
  refreshAna(kind, ids);
}
async function anaStart(kind, ids) {
  const k = anaKey(kind, ids);
  const nums = ($("#nums")?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 12000);
  const names = ids.map(id => BY[id]?.name || id);
  ANA[k] = {status: "working"}; refreshAna(kind, ids);
  try {
    const r = await fetch("/api/analysis", {method: "POST", headers: {"Content-Type": "application/json"},
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
    try { const r = await fetch(`/api/analysis?kind=${kind}&ids=${encodeURIComponent(ids.join(","))}`); ANA[k] = await r.json(); } catch {}
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
  else if (r === "news") html = V.news();
  else if (r === "ss") html = V.ss();
  else if (r === "trade") html = V.trade();
  else if (r && r.startsWith("roster")) html = V.roster();
  else html = V.home();
  $("#app").innerHTML = html;
  ["give", "get", "rIds"].forEach(wirePicker);
  document.querySelectorAll(".ss-slot").forEach(inp => attachSearch(inp, inp.nextElementSibling, p => {
    if (!V.ssIds.includes(p.id)) V.ssIds.push(p.id);
    render(); setTimeout(() => document.querySelector(".ss-slot")?.focus(), 0);
  }));
  const anaEl = $("#ana");
  if (anaEl) anaCheck(anaEl.dataset.kind, anaEl.dataset.ids.split(","), anaEl.dataset.kind === "compare");
}
let lastHash = "";
window.addEventListener("hashchange", () => { if (location.hash.split("/")[1] !== lastHash.split("/")[1] || location.hash.startsWith("#/p") || location.hash.startsWith("#/c")) scrollTo(0, 0); lastHash = location.hash; render(); });

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act],[data-pos],[data-nf],[data-rm],[data-addss],[data-ssn],[data-view],[data-theme]");
  if (!t) return;
  if (t.dataset.pos) { V.home.pos = t.dataset.pos; render(); return; }
  if (t.dataset.view) { V.home.view = t.dataset.view; render(); return; }
  if (t.dataset.theme) { try { localStorage.setItem("theme", t.dataset.theme); } catch {} document.documentElement.dataset.look = t.dataset.theme; render(); return; }
  if (t.dataset.nf) { V.news.f = t.dataset.nf; render(); return; }
  if (t.dataset.rm) { V[t.dataset.rm] = V[t.dataset.rm].filter(x => x !== t.dataset.id); if (t.dataset.rm === "rIds") setRoster(V.rIds); render(); return; }
  if (t.dataset.ssn) { V.ssN = +t.dataset.ssn; render(); return; }
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
  render();
})();

