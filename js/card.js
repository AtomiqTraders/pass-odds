// Draws the shareable 1200x675 card (X / Discord preview size) as a printed
// form-guide slip: paper, ink, rules. Fixed palette so it reads the same anywhere.

const C = {
  paper: "#0e0f0c", paper2: "#191a16", ink: "#f3f4ee", ink2: "#cfd1c8", muted: "#9a9d92", rule: "#2b2d27",
  pass: "#c6f432", dll: "#f5b54a", maxdd: "#ff7a5c", open: "#4a4c45", lime: "#c6f432", limeInk: "#0e0f0c",
};
const SERIF = '"Instrument Serif", Georgia, "Times New Roman", serif';
const SANS = '"Instrument Sans", "Helvetica Neue", Arial, sans-serif';

const pct = (x) => `${Math.round(x * 100)}%`;

/** The Pass Odds mark: an ink square with "P/O" set like a bookmaker's price. */
export function drawLogo(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = C.lime;
  ctx.beginPath(); ctx.roundRect(x, y, s, s, s * 0.25); ctx.fill();
  ctx.fillStyle = C.limeInk;
  ctx.font = `italic ${Math.round(s * 0.47)}px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("P/O", x + s / 2, y + s * 0.67);
  ctx.restore();
}

function rule(ctx, x1, x2, y, w = 1, color = C.ink) {
  ctx.fillStyle = color;
  ctx.fillRect(x1, y, x2 - x1, w);
}

export function drawCard(canvas, result, { siteUrl = "", isBest = false, sizeMatters = false } = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, L = 60, R = W - 60;
  const o = result.options;
  const p = result.probability;
  ctx.textAlign = "left";

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  // masthead: heavy rule, brand, edition line, thin rule
  
  drawLogo(ctx, L, 60, 42);
  ctx.fillStyle = C.ink;
  ctx.textBaseline = "middle";
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText("Pass Odds", L + 56, 82);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText("FIND THE CHALLENGE BUILT FOR YOU", R, 82);
  ctx.textAlign = "left";
  rule(ctx, L, R, 116, 1, C.rule);

  // the pick
  const acct = sizeMatters ? `${o.plan.name}, $${o.startBalance / 1000}K` : o.plan.name;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.muted;
  ctx.font = `600 15px ${SANS}`;
  ctx.fillStyle = isBest ? C.lime : C.muted;
  ctx.fillText(isBest ? "MY BEST FIT" : "THE ACCOUNT I CHECKED", L, 160);
  ctx.fillStyle = C.ink;
  ctx.font = `${isBest ? "" : "italic "}400 72px ${SERIF}`;
  ctx.fillText(acct, L, 228);

  // the odds
  const tone = p.pass >= 0.6 ? C.lime : p.pass >= 0.35 ? C.dll : C.maxdd;
  ctx.fillStyle = tone;
  ctx.font = `400 190px ${SERIF}`;
  ctx.fillText(pct(p.pass), L - 6, 420);
  ctx.fillStyle = C.ink2;
  ctx.font = `400 24px ${SANS}`;
  ctx.fillText(o.days >= 365 ? "chance to pass" : `chance to pass in ${o.days} days`, L, 460);

  // breakdown with leader dots
  const x0 = 640, x1 = R;
  ctx.fillStyle = C.muted;
  ctx.font = `600 14px ${SANS}`;
  ctx.fillText(`OUT OF ${result.runs.toLocaleString("en-US")} SIMULATED CHALLENGES`, x0, 286);
  const parts = [
    ["Passed", p.pass, C.pass],
    ["Hit the daily loss limit", p.dll, C.dll],
    ["Hit max drawdown", p.maxdd, C.maxdd],
    [o.days >= 365 ? "Still going after a year" : `Still going at day ${o.days}`, p.open, C.open],
  ];
  let bx = x0;
  ctx.fillStyle = C.paper2;
  ctx.fillRect(x0, 300, x1 - x0, 10);
  for (const [, v, col] of parts) {
    ctx.fillStyle = col;
    ctx.fillRect(bx, 300, (x1 - x0) * v, 10);
    bx += (x1 - x0) * v;
  }
  let y = 352;
  for (const [label, v, col] of parts) {
    ctx.fillStyle = col;
    ctx.fillRect(x0, y - 13, 11, 11);
    ctx.fillStyle = C.ink;
    ctx.font = `400 21px ${SANS}`;
    ctx.fillText(label, x0 + 22, y);
    const lw = ctx.measureText(label).width;
    ctx.font = `600 21px ${SANS}`;
    const val = pct(v);
    const vw = ctx.measureText(val).width;
    ctx.textAlign = "right";
    ctx.fillText(val, x1, y);
    ctx.textAlign = "left";
    ctx.fillStyle = C.rule;
    for (let d = x0 + 30 + lw; d < x1 - vw - 10; d += 6) ctx.fillRect(d, y - 3, 2, 2);
    y += 36;
  }

  // the form: stats row between rules
  rule(ctx, L, R, 500, 1, C.rule);
  const cells = [
    ["WIN RATE", pct(o.winRate)],
    ["AVG WIN / LOSS", `${trim(o.avgWinR)}R / ${trim(o.avgLossR)}R`],
    ["RISK A TRADE", `${trim(o.riskPct * 100)}%`],
    ["TRADES A DAY", String(o.tradesPerDay)],
    ["TYPICAL DAYS", result.passDays.median == null ? "–" : String(result.passDays.median)],
  ];
  const cw = (R - L) / cells.length;
  cells.forEach(([k, v], i) => {
    const cx = L + cw * i;
    ctx.fillStyle = C.muted;
    ctx.font = `600 13px ${SANS}`;
    ctx.fillText(k, cx, 530);
    ctx.fillStyle = C.ink;
    ctx.font = `400 36px ${SERIF}`;
    ctx.fillText(v, cx, 568);
  });
  rule(ctx, L, R, 590, 1, C.rule);

  // footer
  ctx.fillStyle = C.muted;
  ctx.font = `400 15px ${SANS}`;
  ctx.fillText("Simulated, not real results. Discipline decides who passes. Unofficial; not affiliated with MyFundedPerps.", L, 620);
  if (siteUrl) {
    ctx.fillStyle = C.lime;
    ctx.font = `600 17px ${SANS}`;
    ctx.fillText(siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), L, 648);
  }
  
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}
