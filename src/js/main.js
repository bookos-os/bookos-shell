// Orquestador del frontend de BookOS Shell.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createTerminal } from "./term.js";
import { setLang, applyI18n, t } from "./i18n/index.js";
import * as Profiles from "./profiles.js";
import * as Widgets from "./widgets.js";

const win = getCurrentWindow();
// bookos-palette.js se carga como script clásico y Tauri no expone
// window.__TAURI__ en esta configuración. Le damos el invoke oficial del
// módulo para que la paleta pueda sincronizarse sin abrir esa superficie global.
window.bookosPalette?.setInvoker(invoke);

// La ventana transparente dibuja sus propias esquinas: redondeadas en modo
// ventana y rectas al maximizar, como pide el sistema visual de BookOS.
let lastWindowMaximized = null;
async function syncWindowShape() {
  try {
    const maximized = await win.isMaximized();
    if (maximized === lastWindowMaximized) return;
    lastWindowMaximized = maximized;
    document.documentElement.classList.toggle("window-maximized", maximized);
  } catch {}
}
if (win.onResized) win.onResized(() => syncWindowShape()).catch(() => {});
syncWindowShape();

// =====================================================================
//  Robustez de entrada (touchpad / menú contextual / errores)
// =====================================================================

// 1) Quita el menú contextual feo del WebView (Insertar Unicode, Inspeccionar…).
//    En la terminal el clic derecho lo gestionamos nosotros (pegar).
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // Clic derecho dentro de una terminal => pegar (comportamiento de terminal).
  if (e.target.closest(".pane")) actions.paste();
});

// 2) Desactiva el zoom por pellizco del touchpad (gesto = ctrl+wheel) y el
//    zoom del navegador con ctrl++/-, para que no se descuadre la UI.
//    Capturamos en fase de captura (true) para adelantarnos al WebView.
document.addEventListener('touchmove', function(event) {
  if (event.scale !== 1) {
    event.preventDefault();
  }
}, { passive: false });

document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      // Ctrl+rueda sobre la terminal = zoom de texto (como Konsole/GNOME Terminal).
      if (e.target.closest(".pane") && e.deltaY !== 0) zoom(e.deltaY < 0 ? 1 : -1);
    }
  },
  { passive: false, capture: true }
);
// Gestos nativos de WebKit (pinch): bloquearlos evita el zoom de página.
for (const g of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(g, (e) => e.preventDefault(), { passive: false, capture: true });
}
// Por si el WebView aplica un zoom propio, lo reseteamos de forma continua.
function resetZoom() {
  document.body.style.zoom = "1";
}
new ResizeObserver(resetZoom).observe(document.documentElement);

// 3) Debugging: registra errores no capturados y promesas rechazadas en consola
//    con un prefijo claro, para localizar fallos al desarrollar.
window.addEventListener("error", (e) => {
  console.error("[bookos-shell] error:", e.message, e.filename, e.lineno);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[bookos-shell] promesa rechazada:", e.reason);
});

// ----- Estado global -----
const state = {
  theme: "light", // "light" | "dark"
  themeMode: localStorage.getItem("bookos.themeMode") || "auto",
  tabs: [], // { id, title, viewEl, terms: [handle], split: "none"|"horizontal"|"vertical", focused }
  activeTab: null,
  fontSize: 14,
  caseInsensitiveCommands: localStorage.getItem("bookos.caseInsensitiveCommands") !== "false",
  dynamicPalette: localStorage.getItem("bookos.dynamicPalette") !== "false",
  statsHidden: localStorage.getItem("bookos.statsHidden") === "true",
};

// Mapa id-de-pty -> handle de terminal, para enrutar datos del backend.
const termsById = new Map();
// Última ruta conocida de cada PTY. Se usa para que el selector de `cd` abra
// la carpeta en la que está trabajando cada panel.
const cwdByPty = new Map();
const homeByPty = new Map();

// =====================================================================
//  Tema
// =====================================================================
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("light-mode", theme === "light");
  document.documentElement.classList.toggle("dark-mode", theme === "dark");
  // Persistimos el tema REAL resuelto: el script inline de index.html lo lee
  // en el siguiente arranque para abrir ya con el tema correcto (anti-flash).
  try { localStorage.setItem("bookos.theme", theme); } catch {}
  // Reaplica el tema a todas las terminales abiertas.
  for (const handle of termsById.values()) handle.applyTheme(theme);

  // Perfil automático asociado a este modo (si existe).
  const prof = Profiles.profileForTheme(theme);
  if (prof) {
    for (const handle of termsById.values()) handle.applyProfile(prof);
  }
}

function resolveAutoTheme(systemTheme) {
  if (state.themeMode === "auto") applyTheme(systemTheme);
}

window.addEventListener("bookos-palette-changed", () => {
  // xterm.js no lee variables CSS por sí solo: repintamos sus roles base cada
  // vez que Settings entrega una paleta o cuando el usuario la desactiva.
  for (const handle of termsById.values()) handle.applyTheme(state.theme);
});

// =====================================================================
//  Pestañas y divisiones
// =====================================================================
const panesEl = document.getElementById("panes");
const tabsEl = document.getElementById("tabs");

function createTab(profile = null) {
  createTab._seq = createTab._seq || 0;
  const view = document.createElement("div");
  view.className = "tabview";
  panesEl.appendChild(view);

  const tab = {
    id: `tab-${Date.now()}-${++createTab._seq}`,
    title: "Terminal",
    viewEl: view,
    terms: [],
    split: "none",
    focusedIndex: 0,
  };
  state.tabs.push(tab);

  // Primer panel.
  addPaneToTab(tab, profile);
  selectTab(tab.id);
  renderTabs();
  return tab;
}

function addPaneToTab(tab, profile = null) {
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.innerHTML = `
    <div class="pane-toolbar">
      <span class="tty-badge"><i></i> TTY</span>
      <button class="pane-command-button" data-action="open-palette" data-i18n-title="palette.openTitle" title="${escapeHtml(t("palette.openTitle"))}">
        <span data-i18n="palette.open">${escapeHtml(t("palette.open"))}</span><kbd>Ctrl K</kbd>
      </button>
    </div>`;
  tab.viewEl.appendChild(pane);

  let handle;
  handle = createTerminal(pane, {
    theme: state.theme,
    profile,
    caseInsensitiveCommands: state.caseInsensitiveCommands,
    onCommandLine: (line, submit) => {
      if (!isAssistableCdLine(line)) return false;
      assistCdCommand(handle, line, submit);
      return true;
    },
    onTitle: (title) => {
      tab.title = title || tab.title;
      renderTabs();
    },
  });
  handle.setFontSize(state.fontSize);
  handle.paneEl = pane;
  tab.terms.push(handle);
  termsById.set(handle.id, handle);

  pane.addEventListener("mousedown", () => {
    tab.focusedIndex = tab.terms.indexOf(handle);
    markFocusedPane(tab);
    handle.term.focus();
  });

  markFocusedPane(tab);
  return handle;
}

function markFocusedPane(tab) {
  tab.terms.forEach((h, i) =>
    h.paneEl.classList.toggle("focused", i === tab.focusedIndex && tab.terms.length > 1)
  );
}

function splitActive(direction) {
  const tab = activeTab();
  if (!tab || tab.terms.length >= 2) return; // dejamos máximo 2 paneles por simplicidad
  tab.split = direction;
  tab.viewEl.classList.toggle("split-vertical", direction === "vertical");
  addPaneToTab(tab);
  refitTab(tab);
}

function refitTab(tab) {
  requestAnimationFrame(() => tab.terms.forEach((h) => h.refit()));
}

function selectTab(id) {
  state.activeTab = id;
  state.tabs.forEach((tb) => tb.viewEl.classList.toggle("active", tb.id === id));
  renderTabs();
  const tab = activeTab();
  if (tab) {
    refitTab(tab);
    tab.terms[tab.focusedIndex]?.term.focus();
  }
}

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTab);
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = state.tabs[idx];
  if (directoryPending && tab.terms.includes(directoryPending.handle)) closeDirectoryPicker();
  tab.terms.forEach((h) => {
    termsById.delete(h.id);
    cwdByPty.delete(h.id);
    homeByPty.delete(h.id);
    h.dispose();
  });
  tab.viewEl.remove();
  state.tabs.splice(idx, 1);
  if (state.tabs.length === 0) {
    createTab();
  } else {
    selectTab(state.tabs[Math.max(0, idx - 1)].id);
  }
}

function renderTabs() {
  tabsEl.innerHTML = "";
  // Con una sola pestaña no mostramos la "cinta" de pestañas (como notepad).
  tabsEl.classList.toggle("single-tab", state.tabs.length <= 1);

  for (const tab of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === state.activeTab ? " active" : "");
    el.innerHTML =
      `<span class="tab-name">${escapeHtml(tab.title)}</span>` +
      `<button class="tab-close" title="Cerrar pestaña"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg></button>`;
    el.onclick = () => selectTab(tab.id);
    el.querySelector(".tab-close").onclick = (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    };
    tabsEl.appendChild(el);
  }

  // Botón "+" pegado a las pestañas (solo visible con 2+ pestañas; con 1 ya
  // está el + de la barra de iconos a la derecha).
  if (state.tabs.length > 1) {
    const add = document.createElement("button");
    add.className = "tab-add";
    add.title = "Nueva pestaña";
    add.textContent = "+";
    add.onclick = () => createTab();
    tabsEl.appendChild(add);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// =====================================================================
//  Zoom de texto
// =====================================================================
function zoom(delta) {
  state.fontSize = Math.min(40, Math.max(8, state.fontSize + delta));
  for (const h of termsById.values()) h.setFontSize(state.fontSize);
}
function zoomReset() {
  state.fontSize = 14;
  for (const h of termsById.values()) h.setFontSize(14);
}

// =====================================================================
//  Acciones del menú
// =====================================================================
function focusedHandle() {
  const tab = activeTab();
  return tab?.terms[tab.focusedIndex];
}

function syncStatsToggle() {
  const button = document.getElementById("statsToggle");
  if (!button) return;
  const key = state.statsHidden ? "action.showStats" : "action.hideStats";
  button.classList.toggle("active", !state.statsHidden);
  button.setAttribute("aria-pressed", String(!state.statsHidden));
  button.setAttribute("data-i18n-title", key);
  button.title = t(key);
}

const actions = {
  "new-tab": () => createTab(),
  "new-window": () => invoke("new_window"),
  "split-h": () => splitActive("horizontal"),
  "split-v": () => splitActive("vertical"),
  "close-tab": () => closeTab(state.activeTab),
  copy: async () => {
    const h = focusedHandle();
    const sel = h?.term.getSelection();
    if (sel) {
      try { await writeText(sel); }
      catch (e) { console.error("[bookos-shell] copiar falló:", e); }
    }
  },
  paste: async () => {
    let text = "";
    try { text = await readText(); }
    catch (e) { console.error("[bookos-shell] pegar falló:", e); return; }
    const h = focusedHandle();
    if (h && text) invoke("pty_write", { id: h.id, data: text });
  },
  clear: () => focusedHandle()?.term.clear(),
  "zoom-in": () => zoom(1),
  "zoom-out": () => zoom(-1),
  "zoom-reset": zoomReset,
  "open-palette": () => openCommandPalette(),
  "close-palette": () => closeCommandPalette(),
  "next-pane": () => focusPane(1),
  "toggle-stats": () => {
    const panel = document.getElementById("syspanel");
    state.statsHidden = !state.statsHidden;
    localStorage.setItem("bookos.statsHidden", String(state.statsHidden));
    panel.classList.toggle("hidden", state.statsHidden);
    syncStatsToggle();
    // Datos frescos nada más abrir (el sondeo se pausa con el panel oculto).
    if (!panel.classList.contains("hidden")) refreshStats(true);
    // Refit CONTINUO durante la animación del panel: el ancho del .pane cambia
    // frame a frame, así reajustamos en cada frame para que xterm re-wrappe el
    // prompt sin dejarlo partido. Paramos al terminar (~360ms).
    const tab = activeTab();
    if (!tab) return;
    const start = performance.now();
    const tick = (now) => {
      tab.terms.forEach((h) => h.refit());
      if (now - start < 360) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  "manage-profiles": () => openProfileModal(),
  "close-modal": () => closeProfileModal(),
  "reset-form": () => resetProfileForm(),
  "add-widget": () => openWidgetPicker(),
  "close-picker": () => (document.getElementById("widgetPicker").hidden = true),
  "close-config": () => (document.getElementById("widgetConfig").hidden = true),
};

// =====================================================================
//  Paleta de comandos: acciones y comandos frecuentes navegables
// =====================================================================
const palette = document.getElementById("commandPalette");
const paletteInput = document.getElementById("paletteInput");
const paletteList = document.getElementById("paletteList");
let paletteMatches = [];
let paletteIndex = 0;

const paletteItems = [
  { id: "new-tab", kind: "action", icon: "+", labelKey: "action.newTab", shortcut: "Ctrl T" },
  { id: "next-pane", kind: "action", icon: "↔", labelKey: "palette.nextPane", shortcut: "Ctrl Alt ←/→" },
  { id: "split-h", kind: "action", icon: "═", labelKey: "action.splitH", shortcut: "Ctrl Shift D" },
  { id: "split-v", kind: "action", icon: "║", labelKey: "action.splitV", shortcut: "Ctrl Shift E" },
  { id: "toggle-stats", kind: "action", icon: "▦", labelKey: "action.toggleStats", shortcut: "" },
  { id: "clear", kind: "action", icon: "⌫", labelKey: "action.clear", shortcut: "" },
  { id: "zoom-in", kind: "action", icon: "A+", labelKey: "action.zoomIn", shortcut: "Ctrl +" },
  { id: "zoom-out", kind: "action", icon: "A−", labelKey: "action.zoomOut", shortcut: "Ctrl −" },
  { id: "pwd", kind: "command", icon: "⌂", labelKey: "palette.pwd", command: "pwd" },
  { id: "list", kind: "command", icon: "▤", labelKey: "palette.list", command: "ls -la" },
  { id: "disk", kind: "command", icon: "◒", labelKey: "palette.disk", command: "df -h" },
  { id: "memory", kind: "command", icon: "▥", labelKey: "palette.memory", command: "free -h" },
  { id: "processes", kind: "command", icon: "≋", labelKey: "palette.processes", command: "ps -ef | head -20" },
];

function foldText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function runPaletteItem(item) {
  if (item.kind === "action") {
    actions[item.id]?.();
  } else {
    const h = focusedHandle();
    if (h) invoke("pty_write", { id: h.id, data: `${item.command}\r` });
  }
  closeCommandPalette();
}

function renderCommandPalette() {
  const query = foldText(paletteInput.value.trim());
  paletteMatches = paletteItems.filter((item) => {
    const text = foldText(`${t(item.labelKey)} ${item.command || ""} ${item.shortcut || ""}`);
    return !query || text.includes(query);
  });
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteMatches.length - 1));
  paletteList.innerHTML = "";
  if (!paletteMatches.length) {
    paletteList.innerHTML = `<div class="palette-empty">${escapeHtml(t("palette.empty"))}</div>`;
    return;
  }
  paletteMatches.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `palette-item${index === paletteIndex ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === paletteIndex ? "true" : "false");
    button.innerHTML = `<span class="palette-icon">${escapeHtml(item.icon)}</span>
      <span class="palette-label"><strong>${escapeHtml(t(item.labelKey))}</strong>
      ${item.command ? `<small>${escapeHtml(item.command)}</small>` : ""}</span>
      ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ""}`;
    button.onclick = () => runPaletteItem(item);
    paletteList.appendChild(button);
  });
}

function openCommandPalette() {
  closeAllMenus();
  palette.hidden = false;
  paletteIndex = 0;
  paletteInput.value = "";
  renderCommandPalette();
  requestAnimationFrame(() => paletteInput.focus());
}

function closeCommandPalette() {
  palette.hidden = true;
  focusedHandle()?.term.focus();
}

// =====================================================================
//  Selector TUI de directorios para `cd`
// =====================================================================
// Se dibuja en el buffer alternativo de xterm, igual que fzf/nano/htop. Así
// no hay una tarjeta HTML flotando dentro de la terminal: el selector ocupa
// temporalmente la pantalla de la propia consola y vuelve al buffer anterior
// al elegir o cancelar.
let directoryPending = null;
let directoryQuery = "";
let directoryIndex = 0;

function normalizePosixPath(path) {
  const absolute = path.startsWith("/");
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else {
      parts.push(part);
    }
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

function dirname(path) {
  const normalized = normalizePosixPath(path);
  if (normalized === "/") return "/";
  const slash = normalized.lastIndexOf("/");
  return slash <= 0 ? "/" : normalized.slice(0, slash);
}

function basename(path) {
  const normalized = normalizePosixPath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function stripCdQuotes(value) {
  const text = value.trim();
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    return text.slice(1, -1);
  }
  return text;
}

function shellQuote(path) {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length];
}

async function knownCwd(handle) {
  if (cwdByPty.has(handle.id)) return cwdByPty.get(handle.id);
  try {
    const cwd = await invoke("initial_cwd");
    cwdByPty.set(handle.id, cwd);
    return cwd;
  } catch {
    const home = await homeDirectory(handle);
    cwdByPty.set(handle.id, home);
    return home;
  }
}

async function homeDirectory(handle) {
  if (homeByPty.has(handle.id)) return homeByPty.get(handle.id);
  try {
    const home = await invoke("home_dir");
    homeByPty.set(handle.id, home);
    return home;
  } catch {
    return "/";
  }
}

function isAssistableCdLine(line) {
  const match = line.match(/^\s*cd(?:\s+(.+?))?\s*$/i);
  return Boolean(match && !/[;&|<>]/.test(match[1] || ""));
}

function terminalSafeText(value) {
  return String(value).replace(/[\x00-\x1f\x7f]/g, "?");
}

function directoryMatchesForQuery() {
  const query = foldText(directoryQuery.trim());
  return (directoryPending?.entries || []).filter((entry) => {
    return !query || foldText(`${entry.name} ${entry.path}`).includes(query);
  });
}

function renderInlineDirectoryPicker() {
  if (!directoryPending) return;
  const { handle, entries, cwd, suggestion } = directoryPending;
  const matches = directoryMatchesForQuery();
  directoryIndex = Math.min(directoryIndex, Math.max(0, matches.length - 1));
  const width = Math.max(1, handle.term.cols);
  const maxName = Math.max(10, ...matches.map((entry) => terminalSafeText(entry.name).length));
  const columns = Math.max(1, Math.min(6, Math.floor((width + 2) / Math.min(maxName + 3, 28))));
  const rows = Math.max(1, Math.ceil(matches.length / columns));
  const esc = "\x1b[";
  const title = suggestion
    ? `${t("directory.suggest")} ${terminalSafeText(suggestion.name)}?`
    : t("directory.title");
  const lines = [
    `${esc}1;32m${terminalSafeText(title)}${esc}0m  ${esc}2m${terminalSafeText(cwd)}${esc}0m`,
    `${esc}2m${terminalSafeText(t("directory.filter"))}: ${terminalSafeText(directoryQuery) || "—"}${esc}0m`,
    "",
  ];

  if (!matches.length) {
    lines.push(`${esc}2m${terminalSafeText(t("directory.empty"))}${esc}0m`);
  } else {
    for (let row = 0; row < rows; row++) {
      let line = "";
      for (let column = 0; column < columns; column++) {
        const index = column * rows + row;
        const entry = matches[index];
        if (!entry) continue;
        const name = terminalSafeText(entry.name);
        const selected = index === directoryIndex;
        const padded = name.padEnd(Math.min(maxName, 26) + 2, " ");
        line += selected
          ? `${esc}7;1;34m ${padded}${esc}0m`
          : `${esc}1;34m${padded}${esc}0m`;
      }
      lines.push(line);
    }
  }
  lines.push(
    "",
    `${esc}2m← ↑ ↓ → ${t("directory.move")}   Enter ${t("directory.enter")}   Esc ${t("directory.cancel")}${esc}0m`,
  );
  handle.term.write(`${esc}2J${esc}H${lines.join("\r\n")}`);
}

function openDirectoryPicker(handle, entries, submit, suggestion = null, cwd = "") {
  directoryPending = { handle, entries, submit, cwd, suggestion };
  directoryQuery = "";
  directoryIndex = 0;
  handle.setInputMode(handleDirectoryInput);
  // El buffer alternativo es la misma técnica que usan los navegadores TUI:
  // el contenido anterior se restaura automáticamente al salir.
  handle.term.write("\x1b[?1049h\x1b[2J\x1b[H");
  renderInlineDirectoryPicker();
}

function closeDirectoryPicker(submit = null) {
  if (!directoryPending) return;
  const pending = directoryPending;
  pending.handle.setInputMode(null);
  pending.handle.term.write("\x1b[?1049l");
  directoryPending = null;
  directoryQuery = "";
  if (submit) submit();
  pending.handle.term.focus();
}

function chooseDirectory(entry) {
  if (!directoryPending) return;
  const { handle, submit } = directoryPending;
  cwdByPty.set(handle.id, entry.path);
  closeDirectoryPicker(() => submit(`cd ${shellQuote(entry.path)}\r`));
}

function moveDirectorySelection(deltaColumn, deltaRow) {
  if (!directoryPending) return;
  const matches = directoryMatchesForQuery();
  if (!matches.length) return;
  const width = Math.max(1, directoryPending.handle.term.cols);
  const maxName = Math.max(10, ...matches.map((entry) => terminalSafeText(entry.name).length));
  const columns = Math.max(1, Math.min(6, Math.floor((width + 2) / Math.min(maxName + 3, 28))));
  const rows = Math.max(1, Math.ceil(matches.length / columns));
  const column = Math.floor(directoryIndex / rows);
  const row = directoryIndex % rows;
  const nextColumn = Math.max(0, Math.min(columns - 1, column + deltaColumn));
  const nextRow = Math.max(0, Math.min(rows - 1, row + deltaRow));
  const next = nextColumn * rows + nextRow;
  if (next < matches.length) directoryIndex = next;
  renderInlineDirectoryPicker();
}

function handleDirectoryInput(data) {
  if (!directoryPending) return;
  if (data === "\x1b[A") moveDirectorySelection(0, -1);
  else if (data === "\x1b[B") moveDirectorySelection(0, 1);
  else if (data === "\x1b[C") moveDirectorySelection(1, 0);
  else if (data === "\x1b[D") moveDirectorySelection(-1, 0);
  else if (data === "\r") {
    const matches = directoryMatchesForQuery();
    if (matches[directoryIndex]) chooseDirectory(matches[directoryIndex]);
  } else if (data === "\x1b" || data === "\x03") {
    closeDirectoryPicker();
  } else if (data === "\x7f" || data === "\b") {
    directoryQuery = directoryQuery.slice(0, -1);
    directoryIndex = 0;
    renderInlineDirectoryPicker();
  } else if (data === "\x15") {
    directoryQuery = "";
    directoryIndex = 0;
    renderInlineDirectoryPicker();
  } else if (data && !/[\x00-\x1f\x7f]/.test(data)) {
    directoryQuery += data;
    directoryIndex = 0;
    renderInlineDirectoryPicker();
  }
}

async function assistCdCommand(handle, line, submit) {
  const match = line.match(/^\s*cd(?:\s+(.+?))?\s*$/i);
  if (!match || /[;&|<>]/.test(match[1] || "")) return false;

  const cwd = await knownCwd(handle);
  let entries;
  try {
    entries = await invoke("list_directories", { path: cwd });
  } catch (error) {
    console.warn("[bookos-shell] no se pudieron listar los directorios:", error);
    cwdByPty.delete(handle.id);
    submit(`${line}\r`);
    return true;
  }

  if (!match[1]) {
    const parent = dirname(cwd);
    const options = parent === cwd ? entries : [{ name: "..", path: parent }, ...entries];
    openDirectoryPicker(handle, options, submit, null, cwd);
    return true;
  }

  const rawTarget = stripCdQuotes(match[1]);
  if (!rawTarget || rawTarget === "-" || rawTarget.startsWith("-")) {
    submit(`${line}\r`);
    return true;
  }
  const home = await homeDirectory(handle);
  const target = rawTarget === "~"
    ? home
    : rawTarget.startsWith("~/")
    ? normalizePosixPath(`${home}/${rawTarget.slice(2)}`)
    : normalizePosixPath(rawTarget.startsWith("/") ? rawTarget : `${cwd}/${rawTarget}`);
  if (target === "/") {
    cwdByPty.set(handle.id, "/");
    submit(`${line}\r`);
    return true;
  }
  const parent = dirname(target);
  const targetName = basename(target);
  const candidates = parent === cwd ? entries : await invoke("list_directories", { path: parent }).catch(() => []);
  const exact = candidates.find((entry) => normalizePosixPath(entry.path) === target);
  if (exact) {
    cwdByPty.set(handle.id, exact.path);
    submit(`${line}\r`);
    return true;
  }

  const foldedName = foldText(targetName);
  let suggestion = candidates.find((entry) => foldText(entry.name) === foldedName);
  if (!suggestion) {
    const limit = Math.max(2, Math.floor(foldedName.length / 3));
    suggestion = candidates
      .map((entry) => ({ entry, distance: editDistance(foldedName, foldText(entry.name)) }))
      .filter(({ distance }) => distance <= limit)
      .sort((a, b) => a.distance - b.distance)[0]?.entry;
  }
  if (suggestion) {
    openDirectoryPicker(handle, [suggestion], submit, suggestion, cwd);
    return true;
  }
  submit(`${line}\r`);
  return true;
}

function focusPane(delta) {
  const tab = activeTab();
  if (!tab || tab.terms.length < 2) return;
  tab.focusedIndex = (tab.focusedIndex + delta + tab.terms.length) % tab.terms.length;
  markFocusedPane(tab);
  tab.terms[tab.focusedIndex]?.term.focus();
}

function selectRelativeTab(delta) {
  if (state.tabs.length < 2) return;
  const current = state.tabs.findIndex((tab) => tab.id === state.activeTab);
  const next = (current + delta + state.tabs.length) % state.tabs.length;
  selectTab(state.tabs[next].id);
}

paletteInput.addEventListener("input", () => {
  paletteIndex = 0;
  renderCommandPalette();
});
palette.addEventListener("click", (e) => {
  if (e.target === palette) closeCommandPalette();
});

window.addEventListener("keydown", (e) => {
  if (!palette.hidden) {
    // La paleta es modal: Ctrl+T/W y el resto de atajos de la terminal no
    // deben ejecutarse mientras el usuario está buscando.
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteIndex = Math.min(paletteIndex + 1, paletteMatches.length - 1);
      renderCommandPalette();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex = Math.max(paletteIndex - 1, 0);
      renderCommandPalette();
    } else if (e.key === "Enter" && paletteMatches[paletteIndex]) {
      e.preventDefault();
      runPaletteItem(paletteMatches[paletteIndex]);
    }
    return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommandPalette();
  } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    openCommandPalette();
  } else if (e.ctrlKey && e.key === "PageDown") {
    e.preventDefault();
    selectRelativeTab(1);
  } else if (e.ctrlKey && e.key === "PageUp") {
    e.preventDefault();
    selectRelativeTab(-1);
  } else if (e.ctrlKey && e.key === "Tab") {
    // Igual que en otros editores: Ctrl+Tab vuelve a la pestaña siguiente;
    // con Shift recorre las pestañas en sentido contrario.
    e.preventDefault();
    selectRelativeTab(e.shiftKey ? -1 : 1);
  } else if (e.ctrlKey && e.altKey && ["ArrowLeft", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    focusPane(-1);
  } else if (e.ctrlKey && e.altKey && ["ArrowRight", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    focusPane(1);
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (btn) {
    const fn = actions[btn.dataset.action];
    if (fn) {
      fn();
      closeAllMenus();
    }
  }
  // Botones de ventana.
  const winBtn = e.target.closest("[data-win]");
  if (winBtn) {
    if (winBtn.dataset.win === "close") win.close();
    if (winBtn.dataset.win === "min") win.minimize();
    if (winBtn.dataset.win === "max") win.toggleMaximize();
  }
});

// =====================================================================
//  Menús desplegables
// =====================================================================
function closeAllMenus() {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
}
function openMenu(menu) {
  closeAllMenus();
  menu.classList.add("open");
}

const menuTriggers = [...document.querySelectorAll(".menu-trigger")];
function moveBetweenMenus(delta) {
  const current = menuTriggers.findIndex((trigger) => trigger.closest(".menu")?.classList.contains("open"));
  if (current < 0) return;
  const next = (current + delta + menuTriggers.length) % menuTriggers.length;
  const trigger = menuTriggers[next];
  openMenu(trigger.closest(".menu"));
  trigger.focus();
}

menuTriggers.forEach((trigger) => {
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = trigger.closest(".menu");
    const wasOpen = menu.classList.contains("open");
    if (wasOpen) closeAllMenus();
    else openMenu(menu);
  });
  // Con un menú abierto, pasar a otro título ya lo cambia automáticamente,
  // como en los menús clásicos de KDE, GNOME y Windows.
  trigger.addEventListener("mouseenter", () => {
    if (document.querySelector(".menu.open") && !trigger.closest(".menu").classList.contains("open")) {
      openMenu(trigger.closest(".menu"));
    }
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveBetweenMenus(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveBetweenMenus(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      openMenu(trigger.closest(".menu"));
      trigger.closest(".menu").querySelector(".menu-popup button")?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAllMenus();
      trigger.focus();
    }
  });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) closeAllMenus();
});

// =====================================================================
//  Atajos de teclado
// =====================================================================
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey;
  if (ctrl && e.key.toLowerCase() === "t") { e.preventDefault(); actions["new-tab"](); }
  else if (ctrl && e.key.toLowerCase() === "n") { e.preventDefault(); actions["new-window"](); }
  else if (ctrl && e.key.toLowerCase() === "w") { e.preventDefault(); actions["close-tab"](); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); actions["split-h"](); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); actions["split-v"](); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); actions.copy(); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); actions.paste(); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); actions["toggle-stats"](); }
  else if (ctrl && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoom(1); }
  else if (ctrl && e.key === "-") { e.preventDefault(); zoom(-1); }
  else if (ctrl && e.key === "0") { e.preventDefault(); zoomReset(); }
});

// =====================================================================
//  Selectores de idioma y tema
// =====================================================================
const customSelects = new Map();

function closeCustomSelects(except = null) {
  for (const control of customSelects.values()) {
    if (control !== except) closeCustomSelect(control);
  }
}

function closeCustomSelect(control) {
  control.wrapper.classList.remove("open");
  control.trigger.setAttribute("aria-expanded", "false");
}

function openCustomSelect(control) {
  closeCustomSelects(control);
  control.wrapper.classList.add("open");
  control.trigger.setAttribute("aria-expanded", "true");
  control.options.querySelector(`[data-value="${CSS.escape(control.select.value)}"]`)?.focus();
}

function renderCustomSelect(control) {
  const { select, trigger, options } = control;
  const selected = select.options[select.selectedIndex];
  trigger.querySelector(".select-label").textContent = selected?.textContent?.trim() || "";
  options.innerHTML = "";
  [...select.options].forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "select-option";
    item.dataset.value = option.value;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", option.value === select.value ? "true" : "false");
    item.textContent = option.textContent.trim();
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCustomSelect(control);
      trigger.focus();
    });
    options.appendChild(item);
  });
}

function enhanceSelect(select) {
  if (select.dataset.themedSelect) return;
  const wrapper = document.createElement("div");
  wrapper.className = "themed-select";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.dataset.themedSelect = "true";
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = wrapper.parentElement?.querySelector(":scope > span");
  if (label) {
    label.id ||= `${select.id}Label`;
    trigger.setAttribute("aria-labelledby", label.id);
  } else {
    trigger.setAttribute("aria-label", select.id);
  }
  trigger.innerHTML = '<span class="select-label"></span><svg class="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  const options = document.createElement("div");
  options.className = "select-options";
  options.id = `${select.id}Options`;
  options.setAttribute("role", "listbox");
  trigger.setAttribute("aria-controls", options.id);
  wrapper.append(trigger, options);

  const control = { select, wrapper, trigger, options };
  customSelects.set(select.id, control);
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrapper.classList.contains("open")) closeCustomSelect(control);
    else openCustomSelect(control);
  });
  trigger.addEventListener("keydown", (e) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      if (!wrapper.classList.contains("open")) openCustomSelect(control);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCustomSelect(control);
    }
  });
  options.addEventListener("keydown", (e) => {
    const items = [...options.querySelectorAll(".select-option")];
    const current = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCustomSelect(control);
      trigger.focus();
    } else if (e.key === "Tab") {
      closeCustomSelect(control);
    }
  });
  select.addEventListener("change", () => renderCustomSelect(control));
  renderCustomSelect(control);
}

function refreshCustomSelects() {
  for (const control of customSelects.values()) renderCustomSelect(control);
}

document.querySelectorAll("select").forEach(enhanceSelect);

const langSel = document.getElementById("langSelect");
langSel.value = localStorage.getItem("bookos.lang") || "es";
refreshCustomSelects();
langSel.addEventListener("change", () => {
  setLang(langSel.value);
  refreshCustomSelects();
  renderProfileList();
  renderWidgets(); // re-traduce títulos de widgets
});

const themeSel = document.getElementById("themeSelect");
themeSel.value = state.themeMode;
refreshCustomSelects();
themeSel.addEventListener("change", () => {
  state.themeMode = themeSel.value;
  localStorage.setItem("bookos.themeMode", state.themeMode);
  if (state.themeMode === "auto") {
    // Volverá a aplicar el del sistema en el próximo evento; forzamos lectura.
    invoke("get_stats"); // no-op para asegurar bucle; el tema viene por evento
  } else {
    applyTheme(state.themeMode);
  }
});

const caseInsensitiveToggle = document.getElementById("caseInsensitiveToggle");
caseInsensitiveToggle.checked = state.caseInsensitiveCommands;
caseInsensitiveToggle.addEventListener("change", () => {
  state.caseInsensitiveCommands = caseInsensitiveToggle.checked;
  localStorage.setItem("bookos.caseInsensitiveCommands", String(state.caseInsensitiveCommands));
  for (const handle of termsById.values()) handle.setCaseInsensitive(state.caseInsensitiveCommands);
});

const dynamicPaletteToggle = document.getElementById("dynamicPaletteToggle");
dynamicPaletteToggle.checked = state.dynamicPalette;
dynamicPaletteToggle.addEventListener("change", () => {
  state.dynamicPalette = dynamicPaletteToggle.checked;
  localStorage.setItem("bookos.dynamicPalette", String(state.dynamicPalette));
  window.bookosPalette?.setEnabled(state.dynamicPalette);
});

// =====================================================================
//  Perfiles (modal)
// =====================================================================
const modal = document.getElementById("profileModal");
let editingId = null;

async function openProfileModal() {
  await populateFontSelect();
  renderProfileList();
  resetProfileForm();
  modal.hidden = false;
}
function closeProfileModal() {
  modal.hidden = true;
}

async function populateFontSelect() {
  const sel = document.getElementById("pFont");
  if (sel.dataset.loaded) return;
  const fonts = await invoke("list_fonts");
  sel.innerHTML = fonts.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
  sel.dataset.loaded = "1";
  refreshCustomSelects();
}

function renderProfileList() {
  const list = document.getElementById("profileList");
  const profiles = Profiles.loadProfiles();
  list.innerHTML = "";
  // Estado vacío: sin esto la columna izquierda del modal quedaba en blanco
  // y parecía que faltaba media interfaz.
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = t("profile.empty");
    list.appendChild(empty);
    return;
  }
  for (const p of profiles) {
    const item = document.createElement("div");
    item.className = "profile-item";
    const when = p.activateOn === "none" ? "" : ` · ${t("profile.activate" + cap(p.activateOn))}`;
    item.innerHTML = `<span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.font)} ${p.fontSize}px${when}</small></span><span class="del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg></span>`;
    item.querySelector("span:first-child").onclick = () => loadProfileIntoForm(p);
    item.querySelector(".del").onclick = (e) => {
      e.stopPropagation();
      Profiles.deleteProfile(p.id);
      renderProfileList();
      renderProfilesMenu();
    };
    list.appendChild(item);
  }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function loadProfileIntoForm(p) {
  editingId = p.id;
  document.getElementById("pName").value = p.name;
  document.getElementById("pFont").value = p.font;
  document.getElementById("pFontSize").value = p.fontSize;
  document.getElementById("pShell").value = p.shell || "";
  document.getElementById("pActivateOn").value = p.activateOn;
  refreshCustomSelects();
}
function resetProfileForm() {
  editingId = null;
  document.getElementById("profileForm").reset();
  document.getElementById("pFontSize").value = 14;
  refreshCustomSelects();
}

document.getElementById("profileForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const profile = {
    id: editingId || Profiles.newProfileId(),
    name: document.getElementById("pName").value.trim() || "Perfil",
    font: document.getElementById("pFont").value,
    fontSize: parseInt(document.getElementById("pFontSize").value, 10) || 14,
    shell: document.getElementById("pShell").value.trim() || null,
    activateOn: document.getElementById("pActivateOn").value,
  };
  Profiles.upsertProfile(profile);
  renderProfileList();
  renderProfilesMenu();
  resetProfileForm();
});

// Inyecta los perfiles como entradas en el menú "Perfiles".
function renderProfilesMenu() {
  const menu = document.getElementById("profilesMenu");
  // Limpia las entradas dinámicas (todo antes del <hr>).
  [...menu.querySelectorAll("button[data-profile]")].forEach((b) => b.remove());
  const hr = menu.querySelector("hr");
  for (const p of Profiles.loadProfiles()) {
    const b = document.createElement("button");
    b.dataset.profile = p.id;
    b.innerHTML = `<span>${escapeHtml(p.name)}</span>`;
    b.onclick = () => {
      createTab(p);
      closeAllMenus();
    };
    menu.insertBefore(b, hr);
  }
}

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeProfileModal();
});

// =====================================================================
//  Panel de sistema: WIDGETS
// =====================================================================
const widgetsEl = document.getElementById("widgets");
let layout = Widgets.loadLayout();
let lastStats = null; // últimas stats, para re-render inmediato al editar

/** Construye (o reconstruye) las tarjetas de widget según el layout. */
function renderWidgets() {
  widgetsEl.innerHTML = "";
  layout.forEach((item, index) => {
    const def = Widgets.CATALOG[item.type];
    if (!def) return;
    const card = document.createElement("div");
    card.className = `widget ${item.size}`;
    card.dataset.index = index;
    if (def.action) card.classList.add("actionable");
    // Estos widgets tienen texto largo: ocupan las 2 columnas.
    if (def.wide || item.type === "network" || item.type === "gpu") {
      card.classList.add("wide");
    }

    const hasOpts = Object.keys(def.options || {}).length > 0;
    card.innerHTML = `
      <div class="widget-top">
        <span class="widget-title">${escapeHtml(t(def.titleKey))}</span>
        <span class="widget-tools">
          <button class="widget-tool drag" title="Mover" draggable="true">⠿</button>
          ${hasOpts ? `<button class="widget-tool cfg" title="${escapeHtml(t("widget.configure"))}">⚙</button>` : ""}
          <button class="widget-tool del" title="${escapeHtml(t("widget.remove"))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg></button>
        </span>
      </div>
      <div class="widget-body">
        <span class="widget-value">—</span>
        <span class="widget-sub"></span>
      </div>
      <div class="widget-bar"><i></i></div>`;

    // Herramientas.
    card.querySelector(".del").onclick = (e) => {
      e.stopPropagation();
      layout.splice(index, 1);
      Widgets.saveLayout(layout);
      renderWidgets();
      updateWidgets();
    };
    card.querySelector(".cfg")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openWidgetConfig(index);
    });

    // Acción al hacer clic (si el widget la define).
    if (def.action) {
      card.addEventListener("click", () => {
        if (lastStats) def.action(lastStats);
      });
    }

    // Reordenar por arrastre.
    setupDrag(card, index);

    widgetsEl.appendChild(card);
  });
  updateWidgets();
}

/** Refresca los valores de cada widget con las stats actuales. */
function updateWidgets() {
  if (!lastStats) return;
  [...widgetsEl.children].forEach((card) => {
    const item = layout[+card.dataset.index];
    if (!item) return;
    const def = Widgets.CATALOG[item.type];
    const opts = Widgets.withDefaults(item.type, item.opts);
    const out = def.render(lastStats, opts);

    card.querySelector(".widget-value").textContent = out.value ?? "—";
    const sub = card.querySelector(".widget-sub");
    sub.textContent = out.sub || "";
    if (item.type === "cpu") card.querySelector(".widget-value").title = lastStats.cpu_model;

    // Barra de progreso (si el widget aporta porcentaje).
    const bar = card.querySelector(".widget-bar > i");
    if (out.percent != null) {
      card.querySelector(".widget-bar").style.display = "";
      bar.style.width = `${Math.min(100, Math.max(0, out.percent))}%`;
      card.classList.toggle("warn", out.color == null && out.percent >= 75 && out.percent < 90);
      card.classList.toggle("crit", out.color === "crit" || (out.color == null && out.percent >= 90));
      card.classList.toggle("ok", out.color === "ok");
    } else {
      card.querySelector(".widget-bar").style.display = "none";
    }
  });
}

function statsPanelVisible() {
  return !document.getElementById("syspanel").classList.contains("hidden");
}

async function refreshStats(force = false) {
  // Perf: no consultamos al backend cada 2 s si el panel está oculto.
  if (!force && !statsPanelVisible()) return;
  try {
    lastStats = await invoke("get_stats");
    updateWidgets();
  } catch (e) {
    console.error("stats:", e);
  }
}

// ---- Arrastrar para reordenar ----
let dragFrom = null;
function setupDrag(card, index) {
  const handle = card.querySelector(".drag");
  handle.addEventListener("dragstart", (e) => {
    dragFrom = index;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  handle.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    widgetsEl.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
  });
  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    card.classList.add("drop-target");
  });
  card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    const to = +card.dataset.index;
    if (dragFrom == null || dragFrom === to) return;
    const [moved] = layout.splice(dragFrom, 1);
    layout.splice(to, 0, moved);
    Widgets.saveLayout(layout);
    renderWidgets();
  });
}

// ---- Selector de widgets (añadir) ----
const widgetPicker = document.getElementById("widgetPicker");
function openWidgetPicker() {
  const grid = document.getElementById("pickerGrid");
  grid.innerHTML = "";
  for (const [type, def] of Object.entries(Widgets.CATALOG)) {
    const el = document.createElement("div");
    el.className = "picker-item";
    el.textContent = t(def.titleKey);
    el.onclick = () => {
      layout.push({ type, size: def.sizes[def.sizes.length - 1], opts: {} });
      Widgets.saveLayout(layout);
      renderWidgets();
      widgetPicker.hidden = true;
    };
    grid.appendChild(el);
  }
  widgetPicker.hidden = false;
}
widgetPicker.addEventListener("click", (e) => {
  if (e.target === widgetPicker) widgetPicker.hidden = true;
});

// ---- Configuración de un widget (tamaño + opciones) ----
const widgetConfig = document.getElementById("widgetConfig");
function openWidgetConfig(index) {
  const item = layout[index];
  const def = Widgets.CATALOG[item.type];
  const body = document.getElementById("widgetConfigBody");
  const opts = Widgets.withDefaults(item.type, item.opts);

  // Selector de tamaño (segmentado).
  let html = `<div class="wcfg-row"><span>${escapeHtml(t("widget.size"))}</span><span class="seg">`;
  for (const sz of def.sizes) {
    const label = t("widget.size" + cap(sz));
    html += `<button data-size="${sz}" class="${item.size === sz ? "active" : ""}">${escapeHtml(label)}</button>`;
  }
  html += `</span></div>`;

  // Opciones booleanas.
  for (const [key, spec] of Object.entries(def.options || {})) {
    if (spec.type === "bool") {
      html += `<label class="wcfg-row"><span>${escapeHtml(t(spec.labelKey))}</span>
        <input type="checkbox" data-opt="${key}" ${opts[key] ? "checked" : ""}></label>`;
    }
  }
  body.innerHTML = html;

  body.querySelectorAll("[data-size]").forEach((b) => {
    b.onclick = () => {
      item.size = b.dataset.size;
      Widgets.saveLayout(layout);
      renderWidgets();
      openWidgetConfig(index); // refresca el estado activo
    };
  });
  body.querySelectorAll("[data-opt]").forEach((c) => {
    c.onchange = () => {
      item.opts = { ...item.opts, [c.dataset.opt]: c.checked };
      Widgets.saveLayout(layout);
      updateWidgets();
    };
  });

  widgetConfig.hidden = false;
}
widgetConfig.addEventListener("click", (e) => {
  if (e.target === widgetConfig) widgetConfig.hidden = true;
});

// El reloj se actualiza cada segundo aunque las stats vayan más lentas.
// Solo con el panel visible — si está oculto no hay nada que pintar.
setInterval(() => {
  if (statsPanelVisible() && layout.some((w) => w.type === "clock")) updateWidgets();
}, 1000);

// =====================================================================
//  Eventos del backend
// =====================================================================
listen("pty://data", (e) => {
  const h = termsById.get(e.payload.id);
  if (h) h.write(e.payload.data);
});
listen("pty://exit", (e) => {
  // Cierra la pestaña/panel cuyo PTY terminó.
  for (const tab of state.tabs) {
    const idx = tab.terms.findIndex((h) => h.id === e.payload);
    if (idx >= 0) {
      const h = tab.terms[idx];
      if (directoryPending?.handle === h) closeDirectoryPicker();
      termsById.delete(h.id);
      cwdByPty.delete(h.id);
      homeByPty.delete(h.id);
      h.dispose();
      tab.terms.splice(idx, 1);
      h.paneEl.remove();
      if (tab.terms.length === 0) closeTab(tab.id);
      else {
        // Volvemos a panel único: limpia el estado de división para que un
        // futuro split funcione y el CSS no quede en modo vertical.
        if (tab.terms.length === 1) {
          tab.split = "none";
          tab.viewEl.classList.remove("split-vertical");
        }
        tab.focusedIndex = 0;
        markFocusedPane(tab);
        refitTab(tab);
      }
      break;
    }
  }
});
listen("theme://changed", (e) => {
  resolveAutoTheme(e.payload); // "light" | "dark"
});

// =====================================================================
//  Arranque
// =====================================================================
async function boot() {
  setLang(langSel.value);
  applyI18n();
  // Tema inicial: si es manual usa la preferencia; si es automático,
  // leemos el tema ACTUAL del escritorio (kdeglobals) en vez de asumir claro.
  if (state.themeMode !== "auto") {
    applyTheme(state.themeMode);
  } else {
    try {
      applyTheme(await invoke("get_theme"));
    } catch {
      applyTheme("light");
    }
  }
  document.getElementById("syspanel").classList.toggle("hidden", state.statsHidden);
  syncStatsToggle();

  renderProfilesMenu();
  renderWidgets();
  createTab();
  refreshStats();
  setInterval(refreshStats, 2000);

  // La ventana arranca oculta (visible:false) para no enseñar el tema
  // equivocado. Ya con el tema aplicado y el primer panel montado, la
  // mostramos en el siguiente frame: el usuario solo ve el tema correcto.
  revealWindow();
}

// Muestra la ventana una sola vez, tras pintar. Doble rAF = el navegador ya
// aplicó estilos y compuso el primer frame antes de hacerla visible.
let revealed = false;
async function revealWindow() {
  if (revealed) return;
  revealed = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await win.show();
    await win.setFocus();
  } catch (e) {
    console.error("[bookos-shell] no se pudo mostrar la ventana:", e);
  }
}

// Red de seguridad: si boot() fallara antes de revealWindow(), mostramos la
// ventana igualmente a los 1.5 s para no dejar la app invisible.
setTimeout(revealWindow, 1500);

boot();
