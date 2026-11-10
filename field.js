/* The field behind the app, with real big plays drawn chalkboard style.
   Start spot, yards, result and players are real (nflverse play-by-play). There's no player-tracking
   data, so the route shape is illustrative. No Claude, no libraries: one canvas, the field cached offscreen. */
(function () {
  "use strict";
  const NOTE = "Real play from the official NFL play-by-play: start spot, side, run gap, pass depth, yards and result are real. Player steps are drawn from those (no player tracking data is public).";
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = document.createElement("canvas"); cv.id = "field"; cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  const cap = document.createElement("button"); cap.id = "playcap"; cap.type = "button"; cap.setAttribute("aria-live", "off");
  cap.setAttribute("aria-label", "About this play");
  document.body.appendChild(cap);
  const tip = document.createElement("div"); tip.id = "playtip"; tip.hidden = true; tip.setAttribute("role", "dialog");
  document.body.appendChild(tip);
  let held = false;   // while the info card is open, keep replaying the same play
  const escH = t => String(t || "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function openTip() {
    const p = plays[idx]?.p; if (!p) return;
    const meta = [p.matchup, p.dd && p.spot ? `${p.dd} at ${p.spot}` : p.dd, p.score ? `Score before the play: ${p.score}` : ""].filter(Boolean);
    tip.innerHTML = `<button class="x" type="button" aria-label="Close">✕</button><b>${escH(p.caption)}</b>`
      + meta.map(m => `<div class="m">${escH(m)}</div>`).join("")
      + (p.desc ? `<div class="d">“${escH(p.desc)}”</div><div class="src">Official play-by-play</div>` : "")
      + `<div class="n">${escH(NOTE)}</div>`;
    tip.hidden = false; held = true;
  }
  function closeTip() { tip.hidden = true; held = false; }
  cap.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); tip.hidden ? openTip() : closeTip(); });
  tip.addEventListener("click", e => { e.stopPropagation(); if (e.target.closest(".x")) closeTip(); });
  document.addEventListener("click", () => { if (!tip.hidden) closeTip(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !tip.hidden) closeTip(); });
  const ctx = cv.getContext("2d");
  const bg = document.createElement("canvas"), bctx = bg.getContext("2d");
  let W = 0, H = 0, dpr = 1, vert = false, plays = [], idx = 0, t0 = 0, raf = 0, last = 0, top = 0, bot = 0;

  // field units: u = 0..120 along the length (0 = left/bottom end line), v = 0..53.3 across
  const L = 120, Wd = 53.3;
  // the field fits between the sticky header/tab bar and the bottom bar, so both end zones are visible
  const FH = () => H - top - bot;
  const P = (u, v) => vert ? [v / Wd * W, top + (L - u) / L * FH()] : [u / L * W, top + v / Wd * FH()];
  const scale = () => vert ? FH() / L : W / L;      // px per yard along the field

  function drawField() {
    bg.width = W * dpr; bg.height = H * dpr;
    const g = bctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0b2a18"; g.fillRect(0, 0, W, H);
    // turf with 5-yard mow stripes
    for (let u = 0; u < L; u += 5) {
      g.fillStyle = (Math.floor(u / 5) % 2) ? "#1d4d2f" : "#1a4529";
      const [x1, y1] = P(u, 0), [x2, y2] = P(u + 5, Wd);
      g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1);
    }
    // end zones
    for (const [a, b] of [[0, 10], [110, 120]]) {
      const [x1, y1] = P(a, 0), [x2, y2] = P(b, Wd);
      g.fillStyle = "#2c1d5e";
      g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    // yard lines, every 5
    g.strokeStyle = "rgba(255,255,255,.42)"; g.lineWidth = 2;
    for (let u = 10; u <= 110; u += 5) { const [x1, y1] = P(u, 0), [x2, y2] = P(u, Wd); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    // sidelines
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.5)";
    for (const v of [0.4, Wd - 0.4]) { const [x1, y1] = P(0, v), [x2, y2] = P(L, v); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    // hash marks (every yard, two rows) and sideline ticks
    g.lineWidth = 1.2; g.strokeStyle = "rgba(255,255,255,.3)";
    for (let u = 11; u < 110; u++) {
      if (u % 5 === 0) continue;
      for (const [v1, v2] of [[0.8, 1.8], [22.2, 23.2], [30.1, 31.1], [Wd - 1.8, Wd - 0.8]]) {
        const [x1, y1] = P(u, v1), [x2, y2] = P(u, v2); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    }
    // yard numbers 10..50..10, on both sides
    const s = scale(), fs = Math.max(12, Math.min(44, s * 2.3));
    g.font = `800 ${fs}px "Arial Black",Impact,system-ui,sans-serif`; g.fillStyle = "rgba(255,255,255,.34)";
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let n = 10; n <= 90; n += 10) {
      const label = String(n <= 50 ? n : 100 - n);
      for (const [v, flip] of [[9, false], [Wd - 9, true]]) {
        const [x, y] = P(10 + n, v);
        g.save(); g.translate(x, y);
        g.rotate(vert ? (flip ? Math.PI / 2 : -Math.PI / 2) : (flip ? Math.PI : 0));
        g.fillText(label, 0, 0); g.restore();
      }
    }
    // FF STAT HUB painted in each end zone
    const efs = Math.max(14, Math.min(vert ? W * 0.13 : H * 0.11, s * 6.2) * 0.75);   // 11 letters now, was 8
    g.font = `italic 900 ${efs}px "Arial Black",Impact,system-ui,sans-serif`;
    for (const [u, rot] of [[5, vert ? Math.PI : -Math.PI / 2], [115, vert ? 0 : Math.PI / 2]]) {
      const [x, y] = P(u, Wd / 2);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = "rgba(255,255,255,.08)"; g.fillText("FF STAT HUB", 3, 3);
      g.strokeStyle = "rgba(167,139,250,.55)"; g.lineWidth = 2; g.strokeText("FF STAT HUB", 0, 0);
      g.fillStyle = "rgba(255,255,255,.30)"; g.fillText("FF STAT HUB", 0, 0);
      g.restore();
    }
    // night-game dimming so content on top stays readable
    g.setTransform(1, 0, 0, 1, 0, 0);
    const grad = g.createRadialGradient(bg.width / 2, bg.height / 2, 0, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.75);
    grad.addColorStop(0, "rgba(5,10,22,.22)"); grad.addColorStop(1, "rgba(5,10,22,.48)");
    g.fillStyle = grad; g.fillRect(0, 0, bg.width, bg.height);
  }

  /* ---- one play: formation + path, all in field units ----
     Real: start spot, pass depth (air yards), side of the field, run gap, yards gained, end spot.
     Reconstructed: the exact steps in between. Routes are picked from a real route tree to match the
     depth and side of the throw; runs press the real gap, then cut. Paths are smoothed so they flow. */
  function hash(p) { let h = 7; for (const c of (p.caption || "") + p.start) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  // straight stems with a rounded turn at each break (no overshoot loops), sampled densely.
  // Returns the dense path and, for each key point, the index where the path passes it.
  function smooth(pts, rad = 2.2, wideFrom = 1e9) {
    const out = [pts[0]], at = [0];
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let i = 1; i < pts.length - 1; i++) {
      const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
      const d1 = Math.hypot(c[0] - p[0], c[1] - p[1]), d2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
      const r = Math.min(i >= wideFrom ? 9 : rad, d1 * 0.48, d2 * 0.48);
      const a = lerp(c, p, d1 ? r / d1 : 0), z = lerp(c, n, d2 ? r / d2 : 0);
      const prev = out[out.length - 1], steps = Math.max(2, Math.ceil(Math.hypot(a[0] - prev[0], a[1] - prev[1]) / 1.5));
      for (let j = 1; j <= steps; j++) out.push(lerp(prev, a, j / steps));
      const nn = i >= wideFrom ? 18 : 8;
      for (let j = 1; j <= nn; j++) { const t = j / nn, m = 1 - t; out.push([m * m * a[0] + 2 * m * t * c[0] + t * t * z[0], m * m * a[1] + 2 * m * t * c[1] + t * t * z[1]]); if (j === nn / 2) at[i] = out.length - 1; }
    }
    const prev = out[out.length - 1], last = pts[pts.length - 1], steps = Math.max(2, Math.ceil(Math.hypot(last[0] - prev[0], last[1] - prev[1]) / 1.5));
    for (let j = 1; j <= steps; j++) out.push(lerp(prev, last, j / steps));
    at[pts.length - 1] = out.length - 1;
    return {out, at};
  }
  const clampV = v => Math.max(2, Math.min(Wd - 2, v));
  function build(p) {
    const los = 10 + (100 - p.start);                       // offense drives toward u = 120
    const end = p.td ? 114 : Math.min(los + p.yds, 109.5);   // scores finish 4 yards deep in the end zone
    const h = hash(p), alt = (h & 1) ? 1 : -1;
    const O = [22.3, 24.5, 26.65, 28.8, 31].map(v => [los - 0.7, v]);
    const X = [[los + 1.2, 21.5], [los + 1.2, 24.5], [los + 1.2, 28.8], [los + 1.2, 31.8],
               [los + 5, 18], [los + 5, 26.65], [los + 5, 35], [los + 9, 8], [los + 9, 45.3], [los + 14, 20], [los + 14, 33]];
    let keys, catchKey = -1, qb, carrier, route = "";
    if (p.type === "run") {
      qb = [los - 1.5, 26.65];
      carrier = [los - 7, 26.65];
      const toward = p.loc === "left" ? -1 : p.loc === "right" ? 1 : alt * 0.3;
      const gapV = p.loc === "middle" ? 26.65 + alt * 1.5 : 26.65 + toward * (p.gap === "end" ? 9 : p.gap === "tackle" ? 5 : 2.5);
      const yds = end - los;
      // mesh with the QB, press the gap, plant and cut upfield, then a second cut / bend in the open field
      // real: the gap and side. Drawn: through that gap, then straight up that side of the field
      // (no invented cutbacks).
      keys = [carrier, [los - 3.5, 26.65 + toward * 1.2], [los - 0.8, gapV], [los + 2.5, gapV + toward * 0.4]];
      if (yds > 8) {
        const lane = clampV(p.loc === "middle" ? gapV : 26.65 + toward * Math.min(16, 5 + yds * 0.12));
        keys.push([los + Math.min(10, yds * 0.3), (gapV + lane) / 2]);
        keys.push([los + yds * 0.7, lane]);
      }
      keys.push([end, keys[keys.length - 1][1]]);
      route = "run";
    } else {
      qb = [los - 7, 26.65];                                 // shotgun drop
      const side = p.loc === "left" ? -1 : p.loc === "right" ? 1 : alt;
      const outside = p.loc !== "middle";
      const startV = outside ? 26.65 + side * 19.5 : 26.65 + side * 8;      // wideout vs slot
      carrier = [los - 0.7, startV];
      const air = Math.max(2, Math.min(p.air || p.yds * 0.5, p.yds));
      const catchU = los + air;
      const inside = 26.65 + side * 6, wideV = 26.65 + side * 21;
      let catchV;
      if (air <= 5) {                                         // quick game
        if (outside) { route = "hitch"; keys = [carrier, [catchU + 1.5, startV], [catchU, startV - side * 0.8]]; catchV = startV - side * 0.8; }
        else { route = "slant"; keys = [carrier, [los + 2, startV], [catchU, startV - side * 5]]; catchV = startV - side * 5; }
      } else if (air <= 14) {                                 // intermediate
        if (outside && (h % 3)) { route = "out"; keys = [carrier, [catchU - 1, startV], [catchU, startV + side * 1.2], [catchU, clampV(wideV + side * 3)]]; catchV = clampV(wideV + side * 3); }
        else if (outside) { route = "curl"; keys = [carrier, [catchU + 2.5, startV], [catchU + 1.5, startV - side * 1.5], [catchU, startV - side * 2.5]]; catchV = startV - side * 2.5; }
        else { route = "dig"; keys = [carrier, [catchU - 1, startV], [catchU, startV - side * 2], [catchU, inside - side * 10]]; catchV = inside - side * 10; }
      } else if (air <= 24) {                                 // deep intermediate
        if (outside) { route = "corner"; const br = los + Math.min(12, air * 0.55); keys = [carrier, [br, startV - side * 1.5], [br + 2, startV - side * 1], [catchU, clampV(startV + side * 6)]]; catchV = clampV(startV + side * 6); }
        else { route = "post"; const br = los + Math.min(12, air * 0.55); keys = [carrier, [br, startV], [br + 2, startV - side * 1], [catchU, startV - side * 8]]; catchV = startV - side * 8; }
      } else {                                                // shot plays
        if (outside) { route = "go"; keys = [carrier, [los + 4, startV + side * 0.6], [los + 12, startV + side * 1.2], [catchU, startV + side * 0.4]]; catchV = startV + side * 0.4; }
        else { route = "seam-post"; keys = [carrier, [los + 10, startV], [los + 15, startV - side * 1.5], [catchU, startV - side * 6]]; catchV = startV - side * 6; }
      }
      catchKey = keys.length - 1;
      // run after the catch: turn upfield, then weave toward the real end spot
      const yac = end - catchU;
      if (yac > 1.5) {                                        // turn upfield and run it out on that side
        const lane = clampV(catchV + (26.65 - catchV) * 0.2);
        if (yac > 6) keys.push([catchU + Math.min(5, yac * 0.3), lane]);
        keys.push([end, lane]);
      }
    }
    // dense smooth path; remember where the catch happens on it
    const sm = smooth(keys, p.type === "run" ? 3.5 : 1.8, p.type === "run" ? 4 : catchKey + 1), path = sm.out;
    const catchIdx = catchKey >= 0 ? sm.at[catchKey] : -1;
    const ball = catchKey >= 0 ? [qb, keys[catchKey]] : null;
    return {p, los, end, O, X, qb, carrier, path, ball, catchIdx, route};
  }
  function seg(path) { let d = [0]; for (let i = 1; i < path.length; i++) d.push(d[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])); return d; }
  function along(path, cum, f) {
    const target = cum[cum.length - 1] * f;
    for (let i = 1; i < path.length; i++) if (cum[i] >= target) {
      const k = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k, i];
    }
    return [...path[path.length - 1], path.length - 1];
  }
  // players accelerate off the line, then settle into a run; f is the share of the path covered
  const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : 0.55 * t + 0.45 * (t * t * (3 - 2 * t));

  const DRAW = 4800, HOLD = 2600, FADE = 900, CYCLE = DRAW + HOLD + FADE;
  function frame(now) {
    raf = 0;
    if (document.hidden || document.documentElement.dataset.look === "classic") return;
    if (now - last < 33) { raf = requestAnimationFrame(frame); return; }   // ~30 fps is plenty
    last = now;
    if (!t0) t0 = now;
    let el = now - t0;
    if (el > CYCLE) { if (!held) idx = (idx + 1) % plays.length; t0 = now; el = 0; caption(); }
    paint(plays[idx], ease(Math.min(1, el / DRAW)), el > DRAW + HOLD ? 1 - (el - DRAW - HOLD) / FADE : 1);
    raf = requestAnimationFrame(frame);
  }
  function paint(play, f, alpha) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    if (!play) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = scale(), r = Math.max(4, Math.min(11, s * 0.75));
    ctx.globalAlpha = 0.85 * Math.max(0, alpha);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // line of scrimmage and the real end spot
    ctx.strokeStyle = "rgba(96,165,250,.8)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    let [a, b] = [P(play.los, 1), P(play.los, Wd - 1)]; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    ctx.setLineDash([]);
    if (f >= 1) {
      ctx.strokeStyle = play.p.td ? "rgba(245,197,66,.9)" : "rgba(52,208,88,.85)";
      [a, b] = [P(play.end, 1), P(play.end, Wd - 1)]; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
    // chalk: O's and X's
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2;
    for (const o of [...play.O, play.qb, play.carrier]) { const [x, y] = P(...o); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
    for (const xx of play.X) { const [x, y] = P(...xx); ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
    // the route / run, drawn as it happens
    const cum = play.cum || (play.cum = seg(play.path));
    const [hu, hv, k] = along(play.path, cum, f);
    // where the ball is: passes leave the QB so they land as the receiver reaches the catch spot;
    // on runs the ball stays with the runner
    let ballAt = [hu, hv];
    if (play.ball) {
      const [q, c] = play.ball;
      const fc = cum[play.catchIdx] / cum[cum.length - 1];          // receiver reaches the catch spot
      const air = Math.hypot(c[0] - q[0], c[1] - q[1]);
      // flight time in path-fraction terms: ~0.9s for a short throw, ~2.2s for a bomb, never before the snap
      const flight = Math.min(fc - 0.03, Math.max(0.12, Math.min(0.42, (0.35 + air / 30) / (DRAW / 1000))));
      const launch = fc - flight;
      const arc = (t) => { const u = q[0] + (c[0] - q[0]) * t, v = q[1] + (c[1] - q[1]) * t;
        // a little loft, drawn as a sideways bow so it reads as a thrown ball from above
        const bow = Math.sin(Math.PI * t) * Math.min(3, air * 0.06); const n = Math.hypot(c[0] - q[0], c[1] - q[1]) || 1;
        return [u - (c[1] - q[1]) / n * bow, v + (c[0] - q[0]) / n * bow]; };
      let bu = q[0], bv = q[1];
      if (f >= fc) { bu = hu; bv = hv; }
      else if (f >= launch) { [bu, bv] = arc((f - launch) / flight); }
      if (f >= launch) {
        const tEnd = f >= fc ? 1 : (f - launch) / flight;
        ctx.setLineDash([3, 7]); ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(...P(...q));
        for (let i = 1; i <= 16; i++) ctx.lineTo(...P(...arc(tEnd * i / 16)));
        ctx.stroke(); ctx.setLineDash([]);
      }
      ballAt = [bu, bv];
    }
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(...P(...play.path[0]));
    for (let i = 1; i < k; i++) ctx.lineTo(...P(...play.path[i]));
    ctx.lineTo(...P(hu, hv)); ctx.stroke();
    // arrowhead at the current spot
    const prev = play.path[Math.max(0, k - 3)];
    const [px, py] = P(...prev), [hx, hy] = P(hu, hv), ang = Math.atan2(hy - py, hx - px), ah = r * 1.6;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - ah * Math.cos(ang - 0.45), hy - ah * Math.sin(ang - 0.45));
    ctx.moveTo(hx, hy); ctx.lineTo(hx - ah * Math.cos(ang + 0.45), hy - ah * Math.sin(ang + 0.45)); ctx.stroke();
    ctx.fillStyle = "#a78bfa"; ctx.beginPath(); ctx.arc(hx, hy, r * 0.75, 0, 7); ctx.fill();
    // the football
    const [bx, by] = P(...ballAt), br = Math.max(4, r * 0.85);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(vert ? -Math.PI / 2 : 0);
    ctx.fillStyle = "#b5651d"; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, br * 1.25, br * 0.75, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-br * 0.45, 0); ctx.lineTo(br * 0.45, 0); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  function caption() {
    const p = plays[idx]?.p; if (!p) { cap.hidden = true; return; }
    cap.hidden = false;
    cap.innerHTML = "▶ " + escH(p.caption) + ' <span class="i">i</span>';
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight; vert = H > W;
    const hd = document.querySelector(".top"), tb = document.querySelector(".tabs");
    const tabsBottom = tb && getComputedStyle(tb).position === "fixed";
    top = (hd ? hd.getBoundingClientRect().height : 0) + (tb && !tabsBottom ? tb.getBoundingClientRect().height : 0);
    bot = tb && tabsBottom ? tb.getBoundingClientRect().height : 0;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    drawField();
    paint(plays[idx], reduce ? 1 : 0, 1);
  }
  function start() {
    if (document.documentElement.dataset.look === "classic") return;
    if (reduce || !plays.length) { paint(plays[idx], 1, 1); return; }
    if (!raf) { t0 = 0; raf = requestAnimationFrame(frame); }
  }
  window.addEventListener("resize", () => { clearTimeout(size.t); size.t = setTimeout(size, 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
  size();
  fetch("data/plays.json?t=" + (Date.now() / 3600000 | 0)).then(r => r.json()).then(d => {
    plays = (d.plays || []).map(build);
    idx = Math.floor(Math.random() * plays.length); caption(); size(); start();   // start somewhere new each visit
    window.__fieldShow = (i, f) => { idx = i % plays.length; caption(); paint(plays[idx], f, 1); };   // for screenshots/tests
  }).catch(() => { cap.hidden = true; });
})();
