// Draws the shareable 1200x675 odds card (X / Discord preview size).
// Fixed dark palette so the image reads the same wherever it's posted.

const C = {
  bg: "#0b0e0c", panel: "#141a16", border: "#26302a", text: "#e9efe9", muted: "#9aa69c",
  pass: "#3ddc84", dll: "#f0a04b", maxdd: "#ff6b5e", open: "#59625b",
};
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const pct = (x) => `${Math.round(x * 100)}%`;
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");

/** The Pass Odds mark, drawn at (x, y) with size s. Same geometry as logo.svg. */
export function drawLogo(ctx, x, y, s) {
  const k = s / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = C.pass;
  ctx.beginPath(); ctx.roundRect(2, 2, 60, 60, 16); ctx.fill();
  ctx.strokeStyle = "#06210f";
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.55; ctx.lineWidth = 3; ctx.setLineDash([1, 6]);
  ctx.beginPath(); ctx.moveTo(13, 24); ctx.lineTo(51, 24); ctx.stroke();
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = 5.5;
  ctx.beginPath(); ctx.moveTo(13, 47); ctx.lineTo(23, 38); ctx.lineTo(30, 43); ctx.lineTo(45, 17); ctx.stroke();
  ctx.fillStyle = "#06210f";
  ctx.beginPath(); ctx.arc(46, 16, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawCard(canvas, result, { siteUrl = "", isBest = false, sizeMatters = false } = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const o = result.options;
  const p = result.probability;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // soft glow behind the number
  const g = ctx.createRadialGradient(250, 330, 20, 250, 330, 380);
  g.addColorStop(0, "rgba(61,220,132,0.18)");
  g.addColorStop(1, "rgba(61,220,132,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // brand
  drawLogo(ctx, 60, 50, 50);
  ctx.textBaseline = "middle";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText("Pass", 124, 76);
  const pw = ctx.measureText("Pass").width;
  ctx.fillStyle = C.pass;
  ctx.fillText("Odds", 124 + pw + 2, 76);

  // the account, as a pill
  const acct = sizeMatters ? `${o.plan.name} · $${o.startBalance / 1000}K` : o.plan.name;
  const label = isBest ? `Best fit for my strategy:  ${acct}` : acct;
  ctx.font = `700 22px ${FONT}`;
  const lw = ctx.measureText(label).width + 40;
  roundRect(ctx, W - 60 - lw, 52, lw, 48, 24, isBest ? "rgba(61,220,132,0.14)" : C.panel);
  if (isBest) { ctx.strokeStyle = "rgba(61,220,132,0.6)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(W - 60 - lw, 52, lw, 48, 24); ctx.stroke(); }
  ctx.fillStyle = isBest ? C.pass : C.text;
  ctx.textAlign = "right";
  ctx.fillText(label, W - 80, 77);
  ctx.textAlign = "left";

  // big number
  ctx.fillStyle = C.pass;
  ctx.font = `800 190px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(pct(p.pass), 60, 340);
  ctx.fillStyle = C.text;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(o.days >= 365 ? "chance to pass" : `chance to pass in ${o.days} days`, 66, 395);

  // right column: outcome breakdown
  const x0 = 640, w = 496;
  ctx.fillStyle = C.muted;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`OUT OF ${result.runs.toLocaleString("en-US")} SIMULATED CHALLENGES`, x0, 176);
  const parts = [
    ["Passed", p.pass, C.pass],
    ["Hit the daily loss limit", p.dll, C.dll],
    ["Hit max drawdown", p.maxdd, C.maxdd],
    [o.days >= 365 ? "Still going after a year" : `Still going after ${o.days} days`, p.open, C.open],
  ];
  // bar
  let x = x0;
  const barY = 198, barH = 22;
  roundRect(ctx, x0, barY, w, barH, 11, C.panel);
  ctx.save();
  roundClip(ctx, x0, barY, w, barH, 11);
  for (const [, v, col] of parts) {
    ctx.fillStyle = col;
    ctx.fillRect(x, barY, w * v, barH);
    x += w * v;
  }
  ctx.restore();
  let y = 270;
  for (const [label, v, col] of parts) {
    ctx.fillStyle = col;
    roundRect(ctx, x0, y - 16, 16, 16, 4, col);
    ctx.fillStyle = C.text;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(label, x0 + 30, y);
    ctx.textAlign = "right";
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(pct(v), x0 + w, y);
    ctx.textAlign = "left";
    y += 44;
  }

  // stats strip
  const stripY = 470;
  roundRect(ctx, 60, stripY, W - 120, 104, 16, C.panel);
  const cells = [
    ["Win rate", pct(o.winRate)],
    ["Avg win / loss", `${trim(o.avgWinR)}R / ${trim(o.avgLossR)}R`],
    ["Risk per trade", `${trim(o.riskPct * 100)}%`],
    ["Trades a day", String(o.tradesPerDay)],
    ["Typical days to pass", result.passDays.median == null ? "–" : String(result.passDays.median)],
  ];
  const cw = (W - 120) / cells.length;
  cells.forEach(([k, v], i) => {
    const cx = 60 + cw * i + 24;
    ctx.fillStyle = C.muted;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(k, cx, stripY + 40);
    ctx.fillStyle = C.text;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(v, cx, stripY + 80);
  });

  // footer
  ctx.fillStyle = C.muted;
  ctx.font = `500 18px ${FONT}`;
  ctx.fillText("Simulated, not real results. Discipline decides who passes. Unofficial, not affiliated with MyFundedPerps.", 60, siteUrl ? 612 : 630);
  if (siteUrl) {
    ctx.fillStyle = C.pass;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(`Find yours: ${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`, 60, 644);
  }
}

function trim(n) {
  return String(Math.round(n * 100) / 100);
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundClip(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
}
