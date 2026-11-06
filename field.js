/* The field behind the app, with real big plays drawn chalkboard style.
   Start spot, yards, result and players are real (nflverse play-by-play). There's no player-tracking
   data, so the route shape is illustrative. No Claude, no libraries: one canvas, the field cached offscreen. */
(function () {
  "use strict";
  const NOTE = "Real plays from nflverse play-by-play: start spot, yards gained, result and players are real. The route shape is illustrative (no tracking data).";
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = document.createElement("canvas"); cv.id = "field"; cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  const cap = document.createElement("div"); cap.id = "playcap"; cap.title = NOTE; cap.setAttribute("aria-live", "off");
  document.body.appendChild(cap);
  const ctx = cv.getContext("2d");
  const bg = document.createElement("canvas"), bctx = bg.getContext("2d");
  let W = 0, H = 0, dpr = 1, vert = false, plays = [], idx = 0, t0 = 0, raf = 0, last = 0;

  // field units: u = 0..120 along the length (0 = left/bottom end line), v = 0..53.3 across
  const L = 120, Wd = 53.3;
  const P = (u, v) => vert ? [v / Wd * W, (L - u) / L * H] : [u / L * W, v / Wd * H];
  const scale = () => vert ? H / L : W / L;      // px per yard along the field

  function drawField() {
    bg.width = W * dpr; bg.height = H * dpr;
    const g = bctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // STAT HUB painted in each end zone
    const efs = Math.max(16, Math.min(vert ? W * 0.13 : H * 0.11, s * 6.2));
    g.font = `italic 900 ${efs}px "Arial Black",Impact,system-ui,sans-serif`;
    for (const [u, rot] of [[5, vert ? Math.PI : -Math.PI / 2], [115, vert ? 0 : Math.PI / 2]]) {
      const [x, y] = P(u, Wd / 2);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = "rgba(255,255,255,.08)"; g.fillText("STAT HUB", 3, 3);
      g.strokeStyle = "rgba(167,139,250,.55)"; g.lineWidth = 2; g.strokeText("STAT HUB", 0, 0);
      g.fillStyle = "rgba(255,255,255,.30)"; g.fillText("STAT HUB", 0, 0);
      g.restore();
    }
    // night-game dimming so content on top stays readable
    g.setTransform(1, 0, 0, 1, 0, 0);
    const grad = g.createRadialGradient(bg.width / 2, bg.height / 2, 0, bg.width / 2, bg.height / 2, Math.max(bg.width, bg.height) * 0.75);
    grad.addColorStop(0, "rgba(5,10,22,.38)"); grad.addColorStop(1, "rgba(5,10,22,.62)");
    g.fillStyle = grad; g.fillRect(0, 0, bg.width, bg.height);
  }

  /* ---- one play: formation + path, all in field units ---- */
  const LANE = {left: 13, middle: 26.65, right: 40.3};
  function build(p) {
    const los = 10 + (100 - p.start);                       // offense drives toward u = 120
    const end = Math.min(los + p.yds, p.td ? 114 : 109.5);
    const side = LANE[p.loc] ?? 26.65;
    const O = [22.3, 24.5, 26.65, 28.8, 31].map(v => [los - 0.7, v]);
    const X = [[los + 1.2, 21.5], [los + 1.2, 24.5], [los + 1.2, 28.8], [los + 1.2, 31.8],
               [los + 5, 18], [los + 5, 26.65], [los + 5, 35], [los + 9, 8], [los + 9, 45.3], [los + 14, 20], [los + 14, 33]];
    let path, ball = null, qb, carrier;
    if (p.type === "run") {
      qb = [los - 3, 26.65];
      carrier = [los - 6.5, 26.65];
      const gapV = p.loc === "middle" ? 26.65 : p.loc === "left" ? (p.gap === "end" ? 18 : 22.5) : (p.gap === "end" ? 35.3 : 30.8);
      const endV = p.loc === "middle" ? 26.65 : (p.loc === "left" ? 12 : 41.3);
      path = [carrier, [los - 2, (gapV + 26.65) / 2], [los + 0.5, gapV], [los + Math.min(8, p.yds * 0.3), (gapV * 2 + endV) / 3], [end, endV]];
    } else {
      qb = [los - 6, 26.65];
      const wide = p.loc === "middle" ? 21 : p.loc === "left" ? 7 : 46.3;
      carrier = [los - 0.7, wide];
      const air = Math.max(2, Math.min(p.air || p.yds * 0.5, p.yds));
      const catchV = p.loc === "middle" ? 25 : p.loc === "left" ? 11 : 42.3;
      const catchU = los + air;
      path = [carrier, [los + air * 0.55, wide], [catchU, catchV], [end, (catchV + 26.65) / 2]];
      ball = [qb, [catchU, catchV]];
    }
    return {p, los, end, O, X, qb, carrier, path, ball};
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

  const DRAW = 4800, HOLD = 2600, FADE = 900, CYCLE = DRAW + HOLD + FADE;
  function frame(now) {
    raf = 0;
    if (document.hidden || document.documentElement.dataset.look === "classic") return;
    if (now - last < 33) { raf = requestAnimationFrame(frame); return; }   // ~30 fps is plenty
    last = now;
    if (!t0) t0 = now;
    let el = now - t0;
    if (el > CYCLE) { idx = (idx + 1) % plays.length; t0 = now; el = 0; caption(); }
    paint(plays[idx], Math.min(1, el / DRAW), el > DRAW + HOLD ? 1 - (el - DRAW - HOLD) / FADE : 1);
    raf = requestAnimationFrame(frame);
  }
  function paint(play, f, alpha) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    if (!play) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = scale(), r = Math.max(4, Math.min(11, s * 0.75));
    ctx.globalAlpha = 0.62 * Math.max(0, alpha);
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
    // the throw
    if (play.ball) {
      ctx.setLineDash([3, 7]); ctx.strokeStyle = "rgba(255,255,255,.75)";
      const bf = Math.min(1, f / 0.55), [q, c] = play.ball;
      const [x1, y1] = P(...q), [x2, y2] = P(q[0] + (c[0] - q[0]) * bf, q[1] + (c[1] - q[1]) * bf);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    }
    // the route / run, drawn as it happens
    const cum = play.cum || (play.cum = seg(play.path));
    const [hu, hv, k] = along(play.path, cum, f);
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(...P(...play.path[0]));
    for (let i = 1; i < k; i++) ctx.lineTo(...P(...play.path[i]));
    ctx.lineTo(...P(hu, hv)); ctx.stroke();
    // arrowhead at the current spot
    const prev = k > 0 ? play.path[k - 1] : play.path[0];
    const [px, py] = P(...prev), [hx, hy] = P(hu, hv), ang = Math.atan2(hy - py, hx - px), ah = r * 1.6;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - ah * Math.cos(ang - 0.45), hy - ah * Math.sin(ang - 0.45));
    ctx.moveTo(hx, hy); ctx.lineTo(hx - ah * Math.cos(ang + 0.45), hy - ah * Math.sin(ang + 0.45)); ctx.stroke();
    ctx.fillStyle = "#a78bfa"; ctx.beginPath(); ctx.arc(hx, hy, r * 0.75, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function caption() {
    const p = plays[idx]?.p; if (!p) { cap.hidden = true; return; }
    cap.hidden = false;
    cap.textContent = "▶ " + p.caption + " ⓘ";
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight; vert = H > W;
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
    idx = 0; caption(); size(); start();
  }).catch(() => { cap.hidden = true; });
})();
