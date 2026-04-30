'use strict';

const DATA_URL = 'data/pork_cutout_daily.json';

const CUTS = [
  { key: 'pork_carcass', label: 'Carcass',  color: '#b91c1c' },
  { key: 'pork_loin',    label: 'Loin',     color: '#d97706' },
  { key: 'pork_butt',    label: 'Butt',     color: '#16a34a' },
  { key: 'pork_picnic',  label: 'Picnic',   color: '#0891b2' },
  { key: 'pork_rib',     label: 'Rib',      color: '#7c3aed' },
  { key: 'pork_ham',     label: 'Ham',      color: '#db2777' },
  { key: 'pork_belly',   label: 'Belly',    color: '#ea580c' },
];

const $ = id => document.getElementById(id);

let allRows = [];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(v) {
  return v != null ? Number(v).toFixed(2) : '-';
}

// ── load data ──────────────────────────────────────────────
async function loadData() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  allRows = json.rows || [];
}

// ── filter ─────────────────────────────────────────────────
function filterRows(start, end) {
  return allRows.filter(r => r.date >= start && r.date <= end);
}

// ── metrics ────────────────────────────────────────────────
function updateMetrics(rows) {
  const last = rows[rows.length - 1];
  $('latestCarcass').textContent = last ? fmt(last.pork_carcass) : '-';
  $('latestLoin').textContent    = last ? fmt(last.pork_loin)    : '-';
  $('latestBelly').textContent   = last ? fmt(last.pork_belly)   : '-';
  $('totalDays').textContent     = rows.length;
}

// ── chart ──────────────────────────────────────────────────
function drawChart(rows, activeCut) {
  const canvas = $('priceChart');
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.clientWidth - 40 || 900;
  canvas.width = W;
  canvas.height = 380;
  const w = canvas.width, h = canvas.height;
  const PAD = { t: 20, r: 20, b: 48, l: 64 };
  const cw = w - PAD.l - PAD.r;
  const ch = h - PAD.t - PAD.b;

  ctx.clearRect(0, 0, w, h);

  const visibleCuts = activeCut === 'all' ? CUTS : CUTS.filter(c => c.key === activeCut);

  // compute y-range across all visible cuts
  let yMin = Infinity, yMax = -Infinity;
  for (const cut of visibleCuts) {
    for (const r of rows) {
      const v = r[cut.key];
      if (v != null) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); }
    }
  }
  if (!isFinite(yMin)) return;
  const pad = (yMax - yMin) * 0.08 || 5;
  yMin -= pad; yMax += pad;

  const xScale = rows.length > 1 ? cw / (rows.length - 1) : cw;
  const yScale = ch / (yMax - yMin);
  const xp = i  => PAD.l + i * xScale;
  const yp = v  => PAD.t + ch - (v - yMin) * yScale;

  // grid
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const yv = yMin + (yMax - yMin) * (i / ticks);
    const yc = yp(yv);
    ctx.beginPath(); ctx.moveTo(PAD.l, yc); ctx.lineTo(PAD.l + cw, yc); ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px IBM Plex Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(yv.toFixed(1), PAD.l - 6, yc + 4);
  }

  // x-axis labels
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(rows.length / 10));
  for (let i = 0; i < rows.length; i += step) {
    ctx.fillText(rows[i].date.slice(0, 7), xp(i), h - PAD.b + 16);
  }

  // series lines
  for (const cut of visibleCuts) {
    ctx.beginPath();
    ctx.strokeStyle = cut.color;
    ctx.lineWidth = activeCut === 'all' ? 1.5 : 2.2;
    ctx.lineJoin = 'round';
    let started = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][cut.key];
      if (v == null) { started = false; continue; }
      if (!started) { ctx.moveTo(xp(i), yp(v)); started = true; }
      else ctx.lineTo(xp(i), yp(v));
    }
    ctx.stroke();
  }

  // legend
  const legend = $('chartLegend');
  legend.innerHTML = visibleCuts.map(c =>
    `<span class="legend-item"><span class="legend-dot" style="background:${c.color}"></span>${c.label}</span>`
  ).join('');
}

// ── table ──────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = $('tableBody');
  tbody.innerHTML = [...rows].reverse().map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${fmt(r.pork_carcass)}</td>
      <td>${fmt(r.pork_loin)}</td>
      <td>${fmt(r.pork_butt)}</td>
      <td>${fmt(r.pork_picnic)}</td>
      <td>${fmt(r.pork_rib)}</td>
      <td>${fmt(r.pork_ham)}</td>
      <td>${fmt(r.pork_belly)}</td>
    </tr>`).join('');
}

// ── export ─────────────────────────────────────────────────
function exportExcel(rows) {
  const data = rows.map(r => ({
    Date: r.date,
    Carcass: r.pork_carcass,
    Loin: r.pork_loin,
    Butt: r.pork_butt,
    Picnic: r.pork_picnic,
    Rib: r.pork_rib,
    Ham: r.pork_ham,
    Belly: r.pork_belly,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pork Cutout');
  XLSX.writeFile(wb, `pork_cutout_${$('startDate').value}_${$('endDate').value}.xlsx`);
}

// ── apply filter ───────────────────────────────────────────
function applyFilter() {
  const start = $('startDate').value;
  const end   = $('endDate').value;
  const cut   = $('cutFilter').value;
  const rows  = filterRows(start, end);
  $('status').textContent = rows.length ? `${rows.length} trading days loaded.` : 'No data for this range.';
  $('exportBtn').disabled = rows.length === 0;
  updateMetrics(rows);
  drawChart(rows, cut);
  renderTable(rows);
}

// ── init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $('endDate').value = todayIso();
  $('status').textContent = 'Loading data…';
  try {
    await loadData();
    $('status').textContent = 'Ready.';
    applyFilter();
  } catch (e) {
    $('status').textContent = `Error: ${e.message}`;
  }

  $('loadBtn').addEventListener('click', applyFilter);
  $('exportBtn').addEventListener('click', () => {
    const rows = filterRows($('startDate').value, $('endDate').value);
    exportExcel(rows);
  });
  $('cutFilter').addEventListener('change', applyFilter);
  window.addEventListener('resize', applyFilter);
});
