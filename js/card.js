// Draws the shareable 1200x675 card (X / Discord preview size) as a printed
// form-guide slip: paper, ink, rules. Fixed palette so it reads the same anywhere.

const C = {
  paper: "#f2eee3", paper2: "#e8e3d4", ink: "#191814", ink2: "#3b392f", muted: "#6d6858", rule: "#cdc6b2",
  pass: "#1d5e3a", dll: "#a8641a", maxdd: "#9c2b1d", open: "#9a9483",
};
const SERIF = '"Instrument Serif", Georgia, "Times New Roman", serif';
const SANS = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

const pct = (x) => `${Math.round(x * 100)}%`;

/** The Pass Odds mark: an ink square with "P/O" set like a bookmaker's price. */
export function drawLogo(ctx, x, y, s, { ink = C.ink, paper = C.paper } = {}) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = paper;
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
  rule(ctx, L, R, 44, 4);
  drawLogo(ctx, L, 60, 42);
  ctx.fillStyle = C.ink;
  ctx.textBaseline = "middle";
  ctx.font = `400 34px ${SERIF}`;
  ctx.fillText("Pass Odds", L + 56, 82);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText("A FORM GUIDE FOR MYFUNDEDPERPS CHALLENGES", R, 82);
  ctx.textAlign = "left";
  rule(ctx, L, R, 116, 1);

  // the pick
  const acct = sizeMatters ? `${o.plan.name}, $${o.startBalance / 1000}K` : o.plan.name;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.muted;
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText(isBest ? "OUR PICK FOR MY STRATEGY" : "THE ACCOUNT I CHECKED", L, 160);
  ctx.fillStyle = C.ink;
  ctx.font = `${isBest ? "" : "italic "}400 72px ${SERIF}`;
  ctx.fillText(acct, L, 228);

  // the odds
  const tone = p.pass >= 0.6 ? C.pass : p.pass >= 0.35 ? C.dll : C.maxdd;
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
    ctx.font = `500 21px ${MONO}`;
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
  rule(ctx, L, R, 500, 1);
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
    ctx.font = `500 28px ${MONO}`;
    ctx.fillText(v, cx, 568);
  });
  rule(ctx, L, R, 590, 1, C.rule);

  // footer
  ctx.fillStyle = C.muted;
  ctx.font = `400 15px ${SANS}`;
  ctx.fillText("Simulated, not real results. Discipline decides who passes. Unofficial; not affiliated with MyFundedPerps.", L, 620);
  if (siteUrl) {
    ctx.fillStyle = C.ink;
    ctx.font = `500 17px ${MONO}`;
    ctx.fillText(siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), L, 648);
  }
  rule(ctx, L, R, 663, 4);
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}
