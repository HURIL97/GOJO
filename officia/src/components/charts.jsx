import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { money, compact } from '../lib/format';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend);

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const SERIES = ['--s-heb', '--s-resto', '--s-bar', '--s-svc', '--s-5', '--s-6'];
export const seriesColor = (i) => cssVar(SERIES[i % SERIES.length]);

function base({ moneyAxis = true, stacked = false, horizontal = false, percent = false } = {}) {
  const grid = cssVar('--grid');
  const muted = cssVar('--muted');
  const fmt = (v) => (percent ? `${v} %` : moneyAxis ? compact(v) : v);
  const valueAxis = { stacked, beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: fmt, maxTicksLimit: 6 } };
  const catAxis = { stacked, grid: { display: false }, border: { color: grid }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--panel-3'), titleColor: cssVar('--text'), bodyColor: cssVar('--text-2'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: 12, cornerRadius: 10, boxPadding: 5, usePointStyle: true,
        callbacks: { label: (c) => ` ${c.dataset.label} : ${percent ? `${c.parsed[horizontal ? 'x' : 'y']} %` : moneyAxis ? money(c.parsed[horizontal ? 'x' : 'y']) : c.parsed[horizontal ? 'x' : 'y']}` },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

export function StackedBars({ labels, series, height = 280 }) {
  const data = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label, data: s.data, backgroundColor: s.color || seriesColor(i), borderRadius: 4, borderSkipped: false,
      borderColor: cssVar('--panel'), borderWidth: { top: 2 }, maxBarThickness: 26,
    })),
  };
  return <div style={{ height }}><Bar data={data} options={base({ stacked: true })} /></div>;
}

export function Bars({ labels, data, label, color, height = 240, horizontal, moneyAxis = true }) {
  const c = color || seriesColor(0);
  return (
    <div style={{ height }}>
      <Bar
        data={{ labels, datasets: [{ label, data, backgroundColor: c, borderRadius: 4, borderSkipped: false, maxBarThickness: horizontal ? 18 : 30 }] }}
        options={base({ horizontal, moneyAxis })}
      />
    </div>
  );
}

export function Lines({ labels, series, height = 260, percent, moneyAxis = true, area = true }) {
  const data = {
    labels,
    datasets: series.map((s, i) => {
      const col = s.color || seriesColor(i);
      return {
        label: s.label, data: s.data, borderColor: col, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.35,
        pointBackgroundColor: col, borderDash: s.dashed ? [6, 5] : undefined,
        fill: area && i === 0 ? { target: 'origin' } : false,
        backgroundColor: (ctx) => {
          const { chart } = ctx;
          if (!chart.chartArea) return 'transparent';
          const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
          g.addColorStop(0, `${col}55`);
          g.addColorStop(1, `${col}00`);
          return g;
        },
      };
    }),
  };
  const opts = base({ percent, moneyAxis });
  if (percent) opts.scales.y.max = 100;
  return <div style={{ height }}><Line data={data} options={opts} /></div>;
}

export function Donut({ labels, data, colors, height = 210, center, sub }) {
  const cols = colors || labels.map((_, i) => seriesColor(i));
  const total = data.reduce((s, v) => s + (Number(v) || 0), 0);
  return (
    <div style={{ height, position: 'relative' }}>
      <Doughnut
        data={{ labels, datasets: [{ data, backgroundColor: cols, borderColor: cssVar('--panel'), borderWidth: 2, hoverOffset: 6, borderRadius: 4 }] }}
        options={{
          responsive: true, maintainAspectRatio: false, cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: { ...base().plugins.tooltip, mode: 'nearest', callbacks: { label: (c) => ` ${c.label} : ${money(c.parsed)} (${total ? Math.round((c.parsed / total) * 100) : 0} %)` } },
          },
        }}
      />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{center ?? compact(total)}</div>
          <div className="muted small">{sub}</div>
        </div>
      </div>
    </div>
  );
}

// Mini-courbe décorative des tuiles KPI (sans axe, sans infobulle : la valeur est affichée à côté).
export function Spark({ data, color }) {
  const w = 160;
  const h = 46;
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 10)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const id = `sp${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function LegendRow({ items }) {
  return (
    <div className="legend">
      {items.map(([label, color, value]) => (
        <span key={label}><i style={{ background: color }} />{label}{value != null && <b style={{ color: 'var(--text)' }}>{value}</b>}</span>
      ))}
    </div>
  );
}
