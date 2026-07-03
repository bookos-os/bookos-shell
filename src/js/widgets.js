// Sistema de widgets del panel lateral.
//
// - CATALOG: catálogo de tipos de widget disponibles. Cada uno declara su
//   título (i18n), tamaños permitidos, opciones configurables, cómo se pinta
//   con los datos del sistema, y qué hace al pulsarlo (acción interactiva).
// - El LAYOUT del usuario (qué widgets, en qué orden, tamaño y opciones) se
//   guarda en localStorage. La UI vive en main.js.

import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n/index.js";

const LKEY = "bookos.widgets.layout";

function fmtBytes(b) {
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${u[i]}`;
}

function pct(used, total) {
  return total ? (used / total) * 100 : 0;
}

// Cada widget recibe (stats, opts) y devuelve un objeto de presentación:
//   { value, sub, percent?, color? }   -> el renderer construye la tarjeta.
export const CATALOG = {
  cpu: {
    titleKey: "sys.cpu",
    icon: "cpu",
    sizes: ["small", "medium"],
    options: {},
    render: (s) => ({
      value: `${s.cpu_usage.toFixed(0)}%`,
      sub: s.cpu_model,
      percent: s.cpu_usage,
    }),
  },
  memory: {
    titleKey: "sys.mem",
    icon: "mem",
    sizes: ["small", "medium"],
    options: {},
    render: (s) => ({
      value: `${fmtBytes(s.mem_used)}`,
      sub: `/ ${fmtBytes(s.mem_total)}`,
      percent: pct(s.mem_used, s.mem_total),
    }),
  },
  swap: {
    titleKey: "sys.swap",
    icon: "swap",
    sizes: ["small", "medium"],
    options: {},
    render: (s) => ({
      value: s.swap_total ? `${fmtBytes(s.swap_used)}` : "—",
      sub: s.swap_total ? `/ ${fmtBytes(s.swap_total)}` : "",
      percent: pct(s.swap_used, s.swap_total),
    }),
  },
  disk: {
    titleKey: "sys.disk",
    icon: "disk",
    sizes: ["small", "medium"],
    // Opción: qué muestra el subtítulo (sistema de archivos o libre).
    options: {
      showFs: { type: "bool", default: true, labelKey: "wopt.showFs" },
    },
    render: (s, o) => ({
      value: `${fmtBytes(s.disk_used)}`,
      sub:
        `/ ${fmtBytes(s.disk_total)}` +
        (o.showFs && s.disk_fs ? `  ·  ${s.disk_fs}` : ""),
      percent: pct(s.disk_used, s.disk_total),
    }),
    // Clic: abre el explorador en la raíz.
    action: () => invoke("open_path", { path: "/" }),
  },
  battery: {
    titleKey: "sys.battery",
    icon: "battery",
    sizes: ["small", "medium"],
    options: {
      showState: { type: "bool", default: true, labelKey: "wopt.showState" },
    },
    render: (s, o) => {
      if (s.battery_percent == null) return { value: "—", sub: "" };
      const stateKey = "bat." + (s.battery_state || "").toLowerCase();
      const label = t(stateKey) !== stateKey ? t(stateKey) : s.battery_state || "";
      return {
        value: `${s.battery_percent}%`,
        sub: o.showState ? label : "",
        percent: s.battery_percent,
        // Color por estado: cargando verde, bajo rojo.
        color:
          s.battery_state === "Charging"
            ? "ok"
            : s.battery_percent <= 15
            ? "crit"
            : null,
      };
    },
  },
  network: {
    titleKey: "sys.network",
    icon: "net",
    sizes: ["small", "medium"],
    options: {},
    render: (s) => ({
      value: s.iface || "—",
      sub: s.ip || "",
    }),
    // Clic: copia la IP al portapapeles.
    action: (s) => {
      if (s.ip) navigator.clipboard.writeText(s.ip.split("/")[0]);
    },
  },
  gpu: {
    titleKey: "sys.gpu",
    icon: "gpu",
    sizes: ["small", "medium"],
    options: {},
    render: (s) => ({ value: s.gpu_model || "—", sub: "" }),
  },
  clock: {
    titleKey: "sys.clock",
    icon: "clock",
    sizes: ["small", "medium"],
    options: {
      sec: { type: "bool", default: false, labelKey: "wopt.seconds" },
    },
    render: (_s, o) => {
      const now = new Date();
      const opts = { hour: "2-digit", minute: "2-digit" };
      if (o.sec) opts.second = "2-digit";
      return { value: now.toLocaleTimeString([], opts), sub: now.toLocaleDateString() };
    },
  },
};

// Layout por defecto la primera vez.
const DEFAULT_LAYOUT = [
  { type: "cpu", size: "medium", opts: {} },
  { type: "memory", size: "medium", opts: {} },
  { type: "disk", size: "medium", opts: { showFs: true } },
  { type: "battery", size: "medium", opts: { showState: true } },
  { type: "network", size: "medium", opts: {} },
];

export function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LKEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return structuredClone(DEFAULT_LAYOUT);
}

export function saveLayout(layout) {
  localStorage.setItem(LKEY, JSON.stringify(layout));
}

/** Rellena las opciones que falten con sus valores por defecto del catálogo. */
export function withDefaults(type, opts = {}) {
  const def = CATALOG[type]?.options || {};
  const out = { ...opts };
  for (const [k, spec] of Object.entries(def)) {
    if (out[k] === undefined) out[k] = spec.default;
  }
  return out;
}
