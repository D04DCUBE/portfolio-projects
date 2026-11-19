// A hand-written SVG line chart: log or linear axis, several series, hover and keyboard crosshair.
// The slow part (axes, lines) is drawn when data changes; the crosshair is a separate layer that moves cheaply.
import { downsample, niceTicks, logTicks, formatNum } from "./series.js";

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

export function createChart(host, { onAnnounce = () => {} } = {}) {
  const svg = el("svg", { class: "chart", role: "img", tabindex: "0" });
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true;
  host.append(svg, tip);

  let data = { series: [], markers: [], logY: false, label: "" };
  let width = 0, height = 300, hover = null, scale = null;
  const M = { l: 52, r: 14, t: 14, b: 30 };

  function draw() {
    svg.replaceChildren();
    scale = null;
    if (width < 80) return;
    height = width < 520 ? 260 : 330;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    const pw = width - M.l - M.r, ph = height - M.t - M.b;
    const maxStep = Math.max(2, ...data.series.map((s) => s.values.length));
    let lo = Infinity, hi = -Infinity;
    for (const s of data.series) for (const v of s.values) {
      if (v == null || !Number.isFinite(v) || (data.logY && v <= 0)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) { svg.append(el("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "axis" }, "Select a run to see its curve")); return; }
    if (hi === lo) { hi += 1; lo -= data.logY ? lo / 2 : 1; }
    const ty = data.logY ? Math.log10 : (v) => v;
    let yMin = ty(lo), yMax = ty(hi);
    const pad = (yMax - yMin) * 0.06; yMin -= pad; yMax += pad;
    const x = (step) => M.l + ((step - 1) / (maxStep - 1)) * pw;
    const y = (v) => M.t + (1 - (ty(v) - yMin) / (yMax - yMin)) * ph;
    scale = { x, y, maxStep, pw };

    const yTicks = data.logY ? logTicks(10 ** yMin, 10 ** yMax) : niceTicks(yMin, yMax, 5);
    const grid = el("g", { class: "grid" });
    for (const t of yTicks) {
      const py = y(t);
      grid.append(el("line", { x1: M.l, x2: width - M.r, y1: py, y2: py }), el("text", { x: M.l - 8, y: py + 4, "text-anchor": "end", class: "axis" }, formatNum(t)));
    }
    for (const t of niceTicks(1, maxStep, Math.max(2, Math.floor(pw / 90)))) grid.append(el("text", { x: x(t), y: height - 8, "text-anchor": "middle", class: "axis" }, formatNum(t)));
    svg.append(grid, el("text", { x: M.l - 8, y: height - 8, "text-anchor": "end", class: "axis" }, "step"));

    for (const m of data.markers) {
      const px = x(m.step);
      svg.append(el("line", { x1: px, x2: px, y1: M.t, y2: M.t + ph, class: "marker" }),
        el("text", { x: Math.min(px + 5, width - 60), y: M.t + 12, class: "marker-label" }, m.label));
    }
    for (const s of data.series) {
      for (const [vals, cls] of s.raw ? [[s.raw, "line raw"], [s.values, "line"]] : [[s.values, "line"]]) {
        const pts = vals.map((v, i) => ({ x: i + 1, y: v })).filter((p) => p.y != null && Number.isFinite(p.y) && (!data.logY || p.y > 0));
        const shown = downsample(pts, Math.max(60, Math.round(pw)));
        const path = el("path", { d: shown.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(""), class: cls, stroke: s.color });
        if (s.dash) path.setAttribute("stroke-dasharray", s.dash);
        svg.append(path);
      }
    }
    svg.append(el("g", { class: "hover" }));
    svg.setAttribute("aria-label", `${data.label} chart for ${data.series.map((s) => s.label).join(", ") || "no runs"}. Focus the chart and use the arrow keys to read values.`);
    drawHover();
  }

  function valueAt(s, step) { return s.values[step - 1]; }

  function drawHover() {
    const g = svg.querySelector(".hover");
    if (!g) return;
    g.replaceChildren();
    if (hover == null || !scale) { tip.hidden = true; return; }
    const px = scale.x(hover);
    g.append(el("line", { x1: px, x2: px, y1: M.t, y2: height - M.b, class: "cross" }));
    tip.replaceChildren();
    const head = document.createElement("strong"); head.textContent = `Step ${hover}`; tip.append(head);
    for (const s of data.series) {
      const v = valueAt(s, hover);
      const row = document.createElement("div");
      const sw = document.createElement("span"); sw.className = "sw"; sw.style.setProperty("--c", s.color); if (s.dash) sw.dataset.dash = "1";
      row.append(sw, document.createTextNode(`${s.label}: ${formatNum(v)}`));
      tip.append(row);
      if (v != null && Number.isFinite(v) && !(data.logY && v <= 0)) g.append(el("circle", { cx: px, cy: scale.y(v), r: 4, fill: s.color, class: "dot" }));
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(px + 12, width - tw - 4))}px`;
  }

  function stepFromEvent(e) {
    if (!scale) return null;
    const r = svg.getBoundingClientRect();
    const frac = (e.clientX - r.left - M.l) / scale.pw;
    return Math.min(scale.maxStep, Math.max(1, Math.round(1 + frac * (scale.maxStep - 1))));
  }
  svg.addEventListener("pointermove", (e) => { const s = stepFromEvent(e); if (s !== hover) { hover = s; drawHover(); } });
  svg.addEventListener("pointerleave", () => { hover = null; drawHover(); });
  svg.addEventListener("keydown", (e) => {
    if (!scale) return;
    const jump = e.shiftKey ? 10 : 1;
    let next = hover ?? scale.maxStep;
    if (e.key === "ArrowLeft") next -= jump; else if (e.key === "ArrowRight") next += jump;
    else if (e.key === "Home") next = 1; else if (e.key === "End") next = scale.maxStep;
    else if (e.key === "Escape") { hover = null; drawHover(); return; } else return;
    e.preventDefault();
    hover = Math.min(scale.maxStep, Math.max(1, next));
    drawHover();
    onAnnounce(`Step ${hover}. ` + data.series.map((s) => `${s.label} ${formatNum(valueAt(s, hover))}`).join(", "));
  });

  new ResizeObserver((entries) => { const w = Math.round(entries[0].contentRect.width); if (w !== width) { width = w; draw(); } }).observe(host);

  return { update(next) { data = next; draw(); } };
}
