// Draws the shareable 1200x675 odds card (X / Discord preview size).
// Fixed dark palette so the image reads the same wherever it's posted.

const C = {
  bg: "#0b0e0c", panel: "#141a16", border: "#26302a", text: "#e9efe9", muted: "#9aa69c",
  pass: "#3ddc84", dll: "#f0a04b", maxdd: "#ff6b5e", open: "#59625b",
};
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const pct = (x) => `${Math.round(x * 100)}%`;
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");

export function drawCard(canvas, result, { siteUrl = "" } = {}) {
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
  ctx.fillStyle = C.pass;
  ctx.beginPath(); ctx.arc(76, 74, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.text;
  ctx.font = `700 26px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Pass Odds", 96, 75);
  ctx.fillStyle = C.muted;
  ctx.font = `500 22px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${o.plan.name} · ${money(o.startBalance)} challenge`, W - 64, 75);
  ctx.textAlign = "left";

  // big number
  ctx.fillStyle = C.pass;
  ctx.font = `800 190px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(pct(p.pass), 60, 340);
  ctx.fillStyle = C.text;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(`chance to pass in ${o.days} days`, 66, 395);

  // right column: outcome breakdown
  const x0 = 640, w = 496;
  ctx.fillStyle = C.muted;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`OUT OF ${result.runs.toLocaleString("en-US")} SIMULATED CHALLENGES`, x0, 176);
  const parts = [
    ["Passed", p.pass, C.pass],
    ["Hit the daily loss limit", p.dll, C.dll],
    ["Hit max drawdown", p.maxdd, C.maxdd],
    [`Still going after ${o.days} days`, p.open, C.open],
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
  ctx.fillText("A simulation, not a promise. Unofficial tool, not affiliated with MyFundedPerps.", 60, 630);
  if (siteUrl) {
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.fillText(siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), W - 60, 630);
    ctx.textAlign = "left";
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
