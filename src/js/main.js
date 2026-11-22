// Orquestador del frontend de BookOS Shell.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createTerminal } from "./term.js";
import { setLang, applyI18n, t } from "./i18n/index.js";
import * as Profiles from "./profiles.js";
import { resolveTerminalTheme, presetColors, PALETTE_PRESETS, COLOR_FIELDS, ANSI_COLORS } from "./terminal-theme.js";
import * as Widgets from "./widgets.js";

// Trazados de Heroicons 2.1.5 outline (BookOS-HIG/heroicons), salvo `grip`,
// que es Lucide grip-vertical porque Heroicons no tiene asa de arrastre.
// Copiados y no cargados: el WebView no puede leer BookOS-HIG en ejecución.
const ICON_PATHS = {
  plus: '<path d="M12 4.5v15m7.5-7.5h-15"/>',
  close: '<path d="M6 18 18 6M6 6l12 12"/>',
  cog: '<path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>',
  grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  swap: '<path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/>',
  columns: '<path d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z"/>',
  // view-columns girado: Heroicons no trae la división en filas.
  rows: '<g transform="rotate(90 12 12)"><path d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z"/></g>',
  grid: '<path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/>',
  user: '<path d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>',
  backspace: '<path d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z"/>',
  zoomIn: '<path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6"/>',
  zoomOut: '<path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6"/>',
  home: '<path d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>',
  folder: '<path d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"/>',
  disk: '<path d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"/>',
  chip: '<path d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"/>',
  list: '<path d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/>',
};

function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

const win = getCurrentWindow();
const titlebar = document.querySelector(".titlebar");
const titlebarStart = titlebar.querySelector(".tb-start");
const titlebarTools = titlebar.querySelector(".tb-tools");
// Reservamos el mismo ancho a ambos lados para que los menús y controles
// puedan cambiar de tamaño sin desplazar el centro ni tapar el título.
const titlebarResizeObserver = new ResizeObserver(() => {
  const sideWidth = Math.max(titlebarStart.getBoundingClientRect().width, titlebarTools.getBoundingClientRect().width);
  titlebar.style.setProperty("--titlebar-sides", `${2 * sideWidth}px`);
});
titlebarResizeObserver.observe(titlebarStart);
titlebarResizeObserver.observe(titlebarTools);
// bookos-palette.js se carga como script clásico y Tauri no expone
// window.__TAURI__ en esta configuración. Le damos el invoke oficial del
// módulo para que la paleta pueda sincronizarse sin abrir esa superficie global.
window.bookosPalette?.setInvoker(invoke);

// La ventana transparente dibuja sus propias esquinas: redondeadas en modo
// ventana y rectas al maximizar, como pide el sistema visual de BookOS.
let lastWindowMaximized = null;
async function syncWindowShape() {
  try {
    // Pantalla completa no cuenta como maximizada en Tauri y dejaba las
    // esquinas y el borde de 1 px pegados al filo de la pantalla.
    const maximized = (await win.isMaximized()) || (await win.isFullscreen());
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
  restoreSession: localStorage.getItem("bookos.restoreSession") === "true",
  // Oculto salvo que el usuario lo haya abierto: la ventana arranca solo con
  // la terminal.
  statsHidden: localStorage.getItem("bookos.statsHidden") !== "false",
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

  // Los perfiles elegidos a mano conservan sus dos paletas al cambiar de modo.
  const prof = Profiles.profileForTheme(theme);
  for (const handle of termsById.values()) {
    if (handle.followThemeProfile) handle.applyProfile(prof);
  }
}

function resolveAutoTheme(systemTheme) {
  if (state.themeMode === "auto") applyTheme(systemTheme);
}

window.addEventListener("bookos-palette-changed", () => {
  // xterm.js no lee variables CSS por sí solo: repintamos sus roles base cada
  // vez que Settings entrega una paleta o cuando el usuario la desactiva.
  for (const handle of termsById.values()) handle.applyTheme(state.theme);
  if (!modal.hidden) updateProfilePreview();
});

// =====================================================================
//  Pestañas y divisiones
// =====================================================================
const panesEl = document.getElementById("panes");
const tabsEl = document.getElementById("tabs");
const tabResizeObserver = new ResizeObserver(revealActiveTab);

function revealActiveTab() {
  if (document.getElementById("tabsbar").hidden) return;
  tabsEl.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function createTab(profile = null, cwd = null) {
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
  const activeIndex = state.tabs.findIndex((item) => item.id === state.activeTab);
  state.tabs.splice(activeIndex + 1, 0, tab);

  // Primer panel.
  addPaneToTab(tab, profile, cwd);
  selectTab(tab.id);
  return tab;
}

function addPaneToTab(tab, profile = null, cwd = null) {
  const followThemeProfile = profile === null;
  profile ??= Profiles.profileForTheme(state.theme);
  const pane = document.createElement("div");
  pane.className = "pane";
  tab.viewEl.appendChild(pane);

  let handle;
  handle = createTerminal(pane, {
    theme: state.theme,
    profile,
    caseInsensitiveCommands: state.caseInsensitiveCommands,
    cwd,
    onCommandLine: (line, submit) => {
      if (!isAssistableCdLine(line)) return false;
      assistCdCommand(handle, line, submit);
      return true;
    },
    onTitle: (title) => {
      if (!title || title === tab.title) return;
      tab.title = title;
      // codex anima un spinner en el título cada ~100 ms (medido). Rehacer
      // la cinta entera en cada fotograma hacía parpadear las pestañas: los
      // nodos nuevos pierden :hover hasta el siguiente movimiento del ratón.
      tab.nameEl.textContent = title;
      if (state.activeTab === tab.id) updateWindowCaption();
    },
  });
  if (!profile?.fontSize) handle.setFontSize(state.fontSize);
  handle.followThemeProfile = followThemeProfile;
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

async function splitActive(direction) {
  const cwd = await focusedCwd();
  // Comprobado después del await: dos Ctrl+Shift+D seguidos no deben colar
  // un tercer panel mientras se resuelve la carpeta.
  const tab = activeTab();
  if (!tab || tab.terms.length >= 2) return; // dejamos máximo 2 paneles por simplicidad
  tab.split = direction;
  tab.viewEl.classList.toggle("split-vertical", direction === "vertical");
  addPaneToTab(tab, null, cwd);
  refitTab(tab);
}

function refitTab(tab) {
  requestAnimationFrame(() => tab.terms.forEach((h) => h.refit()));
}

// Contador y no Date.now(): dos selecciones en el mismo milisegundo (cerrar
// una pestaña y activar la de al lado) empatarían y el orden sería arbitrario.
let tabUseCounter = 0;
// Ctrl+Tab funciona como Alt+Tab: una pulsación alterna entre las dos últimas
// pestañas usadas y, con Ctrl mantenido, cada Tab retrocede una más.
let tabCycle = null; // { order: [id], index } mientras Ctrl está pulsado

function selectTab(id) {
  state.activeTab = id;
  // Mientras Ctrl sigue pulsado en un recorrido Ctrl+Tab, las pestañas por las
  // que se pasa no cuentan como usadas; si contaran, el orden cambiaría a mitad
  // del recorrido y no se podría llegar más allá de la segunda.
  if (!tabCycle) {
    const tab = state.tabs.find((t) => t.id === id);
    if (tab) tab.usedAt = ++tabUseCounter;
  }
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
  endTabCycle();
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

function updateWindowCaption() {
  const title = activeTab()?.title || "Terminal";
  const caption = document.getElementById("windowTitle");
  caption.textContent = title;
}

function renderTabs() {
  tabsEl.innerHTML = "";
  const multiple = state.tabs.length > 1;
  document.getElementById("tabsbar").hidden = !multiple;
  document.querySelector(".titlebar").classList.toggle("has-tabs", multiple);
  updateWindowCaption();

  for (const tab of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === state.activeTab ? " active" : "");
    el.id = `${tab.id}-label`;
    el.tabIndex = tab.id === state.activeTab ? 0 : -1;
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(tab.id === state.activeTab));
    tab.viewEl.id = `${tab.id}-view`;
    tab.viewEl.setAttribute("role", "tabpanel");
    tab.viewEl.setAttribute("aria-labelledby", el.id);
    el.setAttribute("aria-controls", tab.viewEl.id);
    el.innerHTML =
      `<span class="tab-name">${escapeHtml(tab.title)}</span>` +
      `<button class="tab-close" title="${escapeHtml(t("action.closeTab"))}" aria-label="${escapeHtml(t("action.closeTab"))}">${icon("close", 14)}</button>`;
    tab.nameEl = el.querySelector(".tab-name");
    el.onclick = () => {
      if (!el.classList.contains("dragging")) selectTab(tab.id);
    };
    el.onpointerdown = (e) => startTabDrag(e, tab, el);
    el.onkeydown = (e) => {
      if (e.target !== el || e.ctrlKey || e.altKey || e.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const index = state.tabs.indexOf(tab);
      const next = e.key === "Home" ? 0 : e.key === "End" ? state.tabs.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + state.tabs.length) % state.tabs.length;
      selectTab(state.tabs[next].id);
      tabsEl.querySelector("[aria-selected='true']").focus();
    };
    el.querySelector(".tab-close").onclick = (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    };
    tabsEl.appendChild(el);
  }

  // El hueco libre tras las pestañas sigue moviendo la ventana. Tauri solo
  // arrastra si el clic cae justo en el elemento marcado (drag.js, atributo
  // sin valor), así que este relleno no alcanza a las pestañas.
  const drag = document.createElement("div");
  drag.className = "tb-drag";
  drag.setAttribute("data-tauri-drag-region", "");
  tabsEl.appendChild(drag);
  tabResizeObserver.disconnect();
  tabResizeObserver.observe(tabsEl);
  tabResizeObserver.observe(tabsEl.querySelector("[aria-selected='true']"));
  revealActiveTab();
}

const TAB_MOVE_EASING = { duration: 120, easing: "cubic-bezier(.4,0,.2,1)" };

// Con eventos de puntero y no con HTML5 drag & drop: Tauri intercepta el
// arrastre nativo (ver onDragDropEvent) y el `drop` no llegaría al DOM.
// Como en los navegadores, la pestaña sigue al ratón y las vecinas se apartan
// en cuanto se cruza su mitad; state.tabs y el DOM se reordenan a la vez.
function startTabDrag(e, tab, el) {
  if (e.button !== 0 || e.target.closest(".tab-close")) return;
  // Capturamos desde la pulsación: si el puntero sale antes del umbral de
  // arrastre, también debemos recibir la liberación y retirar los listeners.
  el.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startLeft = el.offsetLeft;
  let dragging = false;
  let shift = 0;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    if (!dragging) {
      // Umbral para que un clic con temblor de mano no se convierta en arrastre.
      if (Math.abs(dx) < 4) return;
      dragging = true;
      el.classList.add("dragging");
    }
    const tabEls = [...tabsEl.querySelectorAll(".tab")];
    const first = tabEls[0];
    const last = tabEls[tabEls.length - 1];
    const left = Math.min(
      Math.max(startLeft + dx, first.offsetLeft),
      last.offsetLeft + last.offsetWidth - el.offsetWidth,
    );
    for (;;) {
      const prev = el.previousElementSibling;
      const next = el.nextElementSibling;
      if (prev?.classList.contains("tab") && left < prev.offsetLeft + prev.offsetWidth / 2) {
        moveTabEl(prev, () => tabsEl.insertBefore(el, prev));
        moveTabInState(tab, -1);
      } else if (next?.classList.contains("tab") && left + el.offsetWidth > next.offsetLeft + next.offsetWidth / 2) {
        moveTabEl(next, () => tabsEl.insertBefore(next, el));
        moveTabInState(tab, 1);
      } else break;
    }
    shift = left - el.offsetLeft;
    el.style.transform = `translateX(${shift}px)`;
  };

  const onUp = (ev) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (ev.type === "pointercancel") {
      el.classList.remove("dragging");
      el.style.removeProperty("transform");
      return;
    }
    if (!dragging) return;
    // El `click` que sigue al pointerup aún ve la clase y no selecciona; la
    // selección va después para que renderTabs no tire el nodo a mitad de evento.
    setTimeout(() => {
      selectTab(tab.id);
      const placed = tabsEl.querySelectorAll(".tab")[state.tabs.indexOf(tab)];
      placed.animate([{ transform: `translateX(${shift}px)` }, { transform: "none" }], TAB_MOVE_EASING);
    });
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

// FLIP: se mide antes y después del cambio en el DOM y se anima la diferencia.
function moveTabEl(el, mutate) {
  const before = el.offsetLeft;
  mutate();
  el.animate([{ transform: `translateX(${before - el.offsetLeft}px)` }, { transform: "none" }], TAB_MOVE_EASING);
}

function moveTabInState(tab, delta) {
  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  state.tabs.splice(idx + delta, 0, tab);
}

function moveActiveTab(delta) {
  const tab = activeTab();
  const idx = state.tabs.indexOf(tab);
  if (!tab || idx + delta < 0 || idx + delta >= state.tabs.length) return;
  moveTabInState(tab, delta);
  renderTabs();
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

// Carpeta en la que está ahora la terminal con foco: las pestañas, ventanas y
// divisiones nuevas arrancan ahí en vez de en HOME.
async function focusedCwd() {
  const h = focusedHandle();
  if (!h) return null;
  try {
    return await invoke("pty_cwd", { id: h.id });
  } catch {
    return null;
  }
}

function syncStatsToggle() {
  const button = document.getElementById("statsToggle");
  if (!button) return;
  const key = state.statsHidden ? "action.showStats" : "action.hideStats";
  button.classList.toggle("active", !state.statsHidden);
  button.setAttribute("aria-pressed", String(!state.statsHidden));
  button.setAttribute("data-i18n-title", key);
  button.title = t(key);
  button.setAttribute("aria-label", t(key));
}

const actions = {
  "new-tab": async () => createTab(null, await focusedCwd()),
  "new-window": async () => invoke("new_window", { cwd: await focusedCwd() }),
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
  paste: () => focusedHandle()?.paste(readText),
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
  "toggle-menus": () => {
    const shown = document.querySelector(".titlebar").classList.toggle("menus-shown");
    document.getElementById("menusToggle").setAttribute("aria-expanded", String(shown));
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
  { id: "new-tab", kind: "action", icon: "plus", labelKey: "action.newTab", shortcut: "Ctrl T" },
  { id: "next-pane", kind: "action", icon: "swap", labelKey: "palette.nextPane", shortcut: "Ctrl Alt ←/→" },
  { id: "split-h", kind: "action", icon: "columns", labelKey: "action.splitH", shortcut: "Ctrl Shift D" },
  { id: "split-v", kind: "action", icon: "rows", labelKey: "action.splitV", shortcut: "Ctrl Shift E" },
  { id: "toggle-stats", kind: "action", icon: "grid", labelKey: "action.toggleStats", shortcut: "" },
  { id: "manage-profiles", kind: "action", icon: "user", labelKey: "action.manageProfiles", shortcut: "" },
  { id: "clear", kind: "action", icon: "backspace", labelKey: "action.clear", shortcut: "Ctrl L" },
  { id: "zoom-in", kind: "action", icon: "zoomIn", labelKey: "action.zoomIn", shortcut: "Ctrl +" },
  { id: "zoom-out", kind: "action", icon: "zoomOut", labelKey: "action.zoomOut", shortcut: "Ctrl −" },
  { id: "pwd", kind: "command", icon: "home", labelKey: "palette.pwd", command: "pwd" },
  { id: "list", kind: "command", icon: "folder", labelKey: "palette.list", command: "ls -la" },
  { id: "disk", kind: "command", icon: "disk", labelKey: "palette.disk", command: "df -h" },
  { id: "memory", kind: "command", icon: "chip", labelKey: "palette.memory", command: "free -h" },
  { id: "processes", kind: "command", icon: "list", labelKey: "palette.processes", command: "ps -ef | head -20" },
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
    button.innerHTML = `<span class="palette-icon">${icon(item.icon)}</span>
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
// al terminar el recorrido. El shell recibe solo la ruta final, al salir.
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
  // La del kernel manda: sigue los `cd` que no pasan por el selector.
  try {
    return await invoke("pty_cwd", { id: handle.id });
  } catch {}
  if (cwdByPty.has(handle.id)) return cwdByPty.get(handle.id);
  const home = await homeDirectory(handle);
  cwdByPty.set(handle.id, home);
  return home;
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
  const { handle, cwd, suggestion, loading, error } = directoryPending;
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
  if (loading) lines.push("", terminalSafeText(t("directory.loading")));
  if (error) lines.push("", `${esc}31m${terminalSafeText(t("directory.error"))} ${terminalSafeText(error)}${esc}0m`);
  lines.push(
    "",
    `${esc}2m← ↑ ↓ → ${t("directory.move")}   Enter ${t("directory.enter")}   Esc / Ctrl+C ${t("directory.finish")}${esc}0m`,
  );
  handle.term.write(`${esc}2J${esc}H${lines.join("\r\n")}`);
}

function openDirectoryPicker(handle, entries, submit, suggestion = null, cwd = "") {
  directoryPending = { handle, entries, submit, cwd, initialCwd: cwd, suggestion, loading: false, error: "" };
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

async function chooseDirectory(entry) {
  const pending = directoryPending;
  if (!pending || pending.loading) return;
  pending.loading = true;
  pending.error = "";
  renderInlineDirectoryPicker();
  try {
    const entries = await invoke("list_directories", { path: entry.path });
    // Esc puede cerrar el selector mientras responde el sistema de archivos.
    if (directoryPending !== pending) return;
    const parent = dirname(entry.path);
    pending.cwd = entry.path;
    pending.entries = parent === entry.path ? entries : [{ name: "..", path: parent }, ...entries];
    pending.suggestion = null;
    directoryQuery = "";
    directoryIndex = 0;
  } catch (error) {
    if (directoryPending !== pending) return;
    pending.error = String(error);
  }
  pending.loading = false;
  renderInlineDirectoryPicker();
}

function finishDirectoryPicker() {
  if (!directoryPending) return;
  const { handle, submit, cwd, initialCwd } = directoryPending;
  if (cwd === initialCwd) {
    closeDirectoryPicker();
    return;
  }
  cwdByPty.set(handle.id, cwd);
  closeDirectoryPicker(() => submit(`cd ${shellQuote(cwd)}\r`));
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
  if (data === "\x1b" || data === "\x03") {
    finishDirectoryPicker();
    return;
  }
  if (directoryPending.loading) return;
  if (data === "\x1b[A") moveDirectorySelection(0, -1);
  else if (data === "\x1b[B") moveDirectorySelection(0, 1);
  else if (data === "\x1b[C") moveDirectorySelection(1, 0);
  else if (data === "\x1b[D") moveDirectorySelection(-1, 0);
  else if (data === "\r") {
    const matches = directoryMatchesForQuery();
    if (matches[directoryIndex]) chooseDirectory(matches[directoryIndex]);
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

function cycleRecentTab(delta) {
  if (state.tabs.length < 2) return;
  if (!tabCycle) {
    const order = [...state.tabs].sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)).map((t) => t.id);
    tabCycle = { order, index: 0 };
  }
  const { order } = tabCycle;
  tabCycle.index = (tabCycle.index + delta + order.length) % order.length;
  selectTab(order[tabCycle.index]);
}

function endTabCycle() {
  if (!tabCycle) return;
  tabCycle = null;
  const tab = activeTab();
  if (tab) tab.usedAt = ++tabUseCounter;
}

window.addEventListener("keyup", (e) => {
  if (e.key === "Control") endTabCycle();
});
// Si se suelta Ctrl con la ventana sin foco no llega el keyup.
window.addEventListener("blur", endTabCycle);

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

// WebKitGTK marca :focus-visible tras un clic o un atajo y el anillo se
// quedaba pintado por fuera del botón. Solo se enseña si se navega con Tab
// o flechas; en captura para que stopImmediatePropagation no lo salte.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Tab" || e.key.startsWith("Arrow")) document.documentElement.classList.add("kbd-nav");
  },
  true,
);
window.addEventListener("pointerdown", () => document.documentElement.classList.remove("kbd-nav"), true);

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
  } else if (e.ctrlKey && e.shiftKey && e.key === "PageDown") {
    e.preventDefault();
    moveActiveTab(1);
  } else if (e.ctrlKey && e.shiftKey && e.key === "PageUp") {
    e.preventDefault();
    moveActiveTab(-1);
  } else if (e.ctrlKey && e.key === "PageDown") {
    e.preventDefault();
    selectRelativeTab(1);
  } else if (e.ctrlKey && e.key === "PageUp") {
    e.preventDefault();
    selectRelativeTab(-1);
  } else if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    cycleRecentTab(e.shiftKey ? -1 : 1);
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
      if (btn.dataset.action !== "toggle-menus") closeMenusPanel();
    }
  }
  // Botones de ventana.
  const winBtn = e.target.closest("[data-win]");
  if (winBtn) {
    if (winBtn.dataset.win === "close") saveSession().finally(() => win.close());
    if (winBtn.dataset.win === "min") win.minimize();
    if (winBtn.dataset.win === "max") win.toggleMaximize();
  }
});

// =====================================================================
//  Menús desplegables
// =====================================================================
function closeAllMenus() {
  document.querySelectorAll(".menu.open").forEach((menu) => {
    menu.classList.remove("open");
    menu.querySelector(".menu-trigger").setAttribute("aria-expanded", "false");
  });
}
function closeMenusPanel() {
  document.querySelector(".titlebar").classList.remove("menus-shown");
  document.getElementById("menusToggle").setAttribute("aria-expanded", "false");
}
function positionMenu(menu) {
  const popup = menu.querySelector(".menu-popup");
  if (matchMedia("(max-width: 740px)").matches) {
    // El texto ampliado puede hacer que los títulos ocupen más de una fila.
    const top = document.getElementById("menubar").getBoundingClientRect().bottom + 4;
    popup.style.top = `${top}px`;
    popup.style.maxHeight = `${Math.max(48, innerHeight - top - 16)}px`;
  } else {
    popup.style.removeProperty("top");
    popup.style.removeProperty("max-height");
  }
}
function openMenu(menu) {
  closeAllMenus();
  menu.classList.add("open");
  menu.querySelector(".menu-trigger").setAttribute("aria-expanded", "true");
  positionMenu(menu);
}
window.addEventListener("resize", () => document.querySelectorAll(".menu.open").forEach(positionMenu));
document.getElementById("menusToggle").addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeAllMenus();
  closeMenusPanel();
});

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
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
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
// Esc desde dentro del menú (HIG §11). Un desplegable abierto ya lo consumió
// con preventDefault: esa pulsación cierra solo el desplegable.
document.querySelectorAll(".menu-popup").forEach((popup) => {
  popup.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    closeAllMenus();
    popup.closest(".menu").querySelector(".menu-trigger").focus();
  });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) closeAllMenus();
  if (!e.target.closest(".menubar, #menusToggle")) closeMenusPanel();
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
  renderProfilesMenu();
  if (!modal.hidden) renderProfileColors();
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

const restoreSessionToggle = document.getElementById("restoreSessionToggle");
restoreSessionToggle.checked = state.restoreSession;
restoreSessionToggle.addEventListener("change", () => {
  state.restoreSession = restoreSessionToggle.checked;
  localStorage.setItem("bookos.restoreSession", String(state.restoreSession));
  if (!state.restoreSession) localStorage.removeItem(SESSION_KEY);
});

// =====================================================================
//  Sesión: pestañas y carpetas de la última vez
// =====================================================================
// Solo la ventana principal guarda y restaura. Las de Ctrl+N son de paso:
// si también escribieran, la última en cerrarse pisaría la sesión buena.
const SESSION_KEY = "bookos.session";
const ownsSession = win.label === "main";

// El shell no avisa cuando hace `cd`, así que la carpeta se lee de /proc en
// cada guardado. Se guarda cada pocos segundos y no solo al cerrar porque la
// sesión del escritorio puede matar la ventana sin pasar por el botón.
async function saveSession() {
  if (!state.restoreSession || !ownsSession) return;
  const tabs = await Promise.all(state.tabs.map(async (tab) => ({
    split: tab.split,
    cwds: await Promise.all(tab.terms.map((h) =>
      invoke("pty_cwd", { id: h.id }).catch(() => cwdByPty.get(h.id) ?? null))),
  })));
  const active = state.tabs.findIndex((t) => t.id === state.activeTab);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, active }));
}

function restoreSession() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return false; }
  if (!saved?.tabs?.length) return false;
  const created = saved.tabs.map(({ split, cwds }) => {
    const tab = createTab(null, cwds[0]);
    if (cwds.length > 1) {
      tab.split = split;
      tab.viewEl.classList.toggle("split-vertical", split === "vertical");
      addPaneToTab(tab, null, cwds[1]);
    }
    return tab;
  });
  selectTab((created[saved.active] ?? created[created.length - 1]).id);
  return true;
}

// =====================================================================
//  Perfiles (modal)
// =====================================================================
const modal = document.getElementById("profileModal");
const profileForm = document.getElementById("profileForm");
document.getElementById("profilePreviewControls").innerHTML = [...document.querySelectorAll(".controls button")].map((button) => `<span>${button.querySelector("svg").outerHTML}</span>`).join("");
let editingId = null;
let profileMode = "light";
let draftColors = {};
let profileReturnFocus = null;

function setProfileListVisible(visible) {
  modal.querySelector(".profiles-modal").classList.toggle("show-profile-list", visible);
  document.getElementById("profilesNav").setAttribute("aria-expanded", String(visible));
}
document.getElementById("profilesNav").onclick = () => {
  const visible = document.getElementById("profilesNav").getAttribute("aria-expanded") !== "true";
  setProfileListVisible(visible);
};


async function openProfileModal() {
  profileReturnFocus = document.activeElement;
  await populateFontSelect();
  const profile = Profiles.loadProfiles().find((p) => p.id === focusedHandle()?.profileId);
  if (profile) loadProfileIntoForm(profile);
  else resetProfileForm();
  modal.hidden = false;
  document.getElementById("pName").focus();
}
function closeProfileModal() {
  closeCustomSelects();
  modal.hidden = true;
  if (profileReturnFocus?.isConnected && profileReturnFocus.getClientRects().length) profileReturnFocus.focus();
  else focusedHandle()?.term.focus();
}

async function populateFontSelect() {
  const sel = document.getElementById("pFont");
  if (sel.dataset.loaded) return;
  const fonts = await invoke("list_fonts");
  sel.replaceChildren(...[...new Set(["Hack", ...fonts])].map((font) => new Option(font, font)));
  sel.dataset.loaded = "1";
  refreshCustomSelects();
}

function renderProfileList() {
  const list = document.getElementById("profileList");
  const profiles = Profiles.loadProfiles();
  list.innerHTML = "";
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
    item.classList.toggle("selected", p.id === editingId);
    const when = p.id === Profiles.defaultProfileId() ? ` · ${t("profile.defaultBadge")}` : p.activateOn && p.activateOn !== "none" ? ` · ${t("profile.activate" + cap(p.activateOn))}` : "";
    const del = escapeHtml(t("profile.delete"));
    item.innerHTML = `<button type="button" class="profile-open" aria-current="${p.id === editingId}"><span class="profile-swatches" aria-hidden="true"><i></i><i></i></span>${escapeHtml(p.name)}<small>${escapeHtml(p.font)} ${p.fontSize}px${escapeHtml(when)}</small></button><button type="button" class="del" title="${del}" aria-label="${del}">${icon("close")}</button>`;
    item.querySelectorAll(".profile-swatches i").forEach((swatch, i) => {
      const theme = i ? "dark" : "light";
      swatch.style.background = resolveTerminalTheme(theme, p).background;
    });
    item.querySelector(".profile-open").onclick = () => loadProfileIntoForm(p);
    item.querySelector(".del").onclick = () => {
      Profiles.deleteProfile(p.id);
      for (const handle of termsById.values()) {
        if (handle.profileId === p.id) handle.applyProfile(handle.followThemeProfile ? Profiles.profileForTheme(state.theme) : null);
      }
      if (editingId === p.id) resetProfileForm();
      else renderProfileList();
      renderProfilesMenu();
    };
    list.appendChild(item);
  }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function loadProfileIntoForm(p) {
  setProfileListVisible(false);
  editingId = p.id;
  document.getElementById("pName").value = p.name;
  const fonts = document.getElementById("pFont");
  if (![...fonts.options].some((option) => option.value === p.font)) fonts.add(new Option(p.font, p.font));
  fonts.value = p.font;
  document.getElementById("pFontSize").value = p.fontSize;
  document.getElementById("pShell").value = p.shell || "";
  document.getElementById("pActivateOn").value = p.activateOn || "none";
  document.getElementById("pCursorStyle").value = p.cursorStyle || "block";
  document.getElementById("pCursorBlink").checked = p.cursorBlink ?? true;
  document.getElementById("pLineHeight").value = p.lineHeight || 1.15;
  document.getElementById("pScrollback").value = p.scrollback ?? 10000;
  document.getElementById("pDefault").checked = Profiles.defaultProfileId() === p.id;
  document.getElementById("pCustomColors").checked = !!p.colors;
  draftColors = Object.fromEntries(["light", "dark"].map((theme) => [theme, { ...presetColors("classic", theme), ...p.colors?.[theme] }]));
  profileMode = state.theme;
  document.getElementById("profileStatus").textContent = "";
  refreshCustomSelects();
  renderProfileColors();
  renderProfileList();
}
function resetProfileForm() {
  setProfileListVisible(false);
  editingId = null;
  profileForm.reset();
  document.getElementById("pFont").value = "Hack";
  draftColors = { light: presetColors("classic", "light"), dark: presetColors("classic", "dark") };
  profileMode = state.theme;
  document.getElementById("profileStatus").textContent = "";
  refreshCustomSelects();
  renderProfileColors();
  renderProfileList();
}

function readProfileForm() {
  return {
    id: editingId || Profiles.newProfileId(),
    name: document.getElementById("pName").value.trim() || t("profile.untitled"),
    font: document.getElementById("pFont").value,
    fontSize: Number(document.getElementById("pFontSize").value) || 14,
    shell: document.getElementById("pShell").value.trim() || null,
    activateOn: document.getElementById("pActivateOn").value,
    cursorStyle: document.getElementById("pCursorStyle").value,
    cursorBlink: document.getElementById("pCursorBlink").checked,
    lineHeight: Number(document.getElementById("pLineHeight").value) || 1.15,
    scrollback: Number(document.getElementById("pScrollback").value),
    ...(document.getElementById("pCustomColors").checked ? { colors: draftColors } : {}),
  };
}

function renderProfileColors() {
  const colors = draftColors[profileMode];
  document.querySelectorAll("[data-profile-mode]").forEach((button) => {
    const selected = button.dataset.profileMode === profileMode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.getElementById("profilePresets").innerHTML = Object.keys(PALETTE_PRESETS).map((name) => `<button type="button" class="profile-preset" data-preset="${name}">${escapeHtml(t("profile.preset" + cap(name)))}</button>`).join("");
  document.querySelectorAll("[data-preset]").forEach((button) => {
    const preset = presetColors(button.dataset.preset, profileMode);
    button.style.setProperty("--preset-bg", preset.background);
    button.style.setProperty("--preset-fg", preset.foreground);
    button.onclick = () => {
      draftColors[profileMode] = preset;
      renderProfileColors();
    };
  });
  document.getElementById("profileColorFields").innerHTML = COLOR_FIELDS.map(([key, label]) => `<div class="profile-color"><input type="color" id="pColor-${key}" data-color="${key}" value="${colors[key]}" aria-label="${escapeHtml(t(label))}" /><label for="pHex-${key}">${escapeHtml(t(label))}</label><input class="profile-hex" id="pHex-${key}" data-hex="${key}" value="${colors[key]}" pattern="#[0-9a-fA-F]{6}" maxlength="7" aria-label="${escapeHtml(t(label))} HEX" spellcheck="false" /></div>`).join("");
  document.getElementById("profileAnsiFields").innerHTML = ANSI_COLORS.map((key, index) => `<label><input type="color" data-color="${key}" value="${colors[key]}" aria-label="ANSI ${index}" /><span>${index}</span></label>`).join("");
  document.getElementById("profileColors").disabled = !document.getElementById("pCustomColors").checked;
  updatePresetSelection();
  updateProfilePreview();
}

function updatePresetSelection() {
  const keys = [...COLOR_FIELDS.map(([key]) => key), ...ANSI_COLORS];
  document.querySelectorAll("[data-preset]").forEach((button) => {
    const preset = presetColors(button.dataset.preset, profileMode);
    button.setAttribute("aria-pressed", String(keys.every((key) => preset[key] === draftColors[profileMode][key])));
  });
}

function updateProfilePreview() {
  const profile = readProfileForm();
  const colors = resolveTerminalTheme(profileMode, profile, profileMode === state.theme ? getComputedStyle(document.documentElement) : null);
  const preview = document.getElementById("profilePreview");
  for (const [name, key] of Object.entries({ bg: "background", fg: "foreground", cursor: "cursor", selection: "selectionBackground", green: "green", blue: "blue", yellow: "yellow" })) {
    preview.style.setProperty(`--preview-${name}`, colors[key]);
  }
  const terminal = document.getElementById("profilePreviewTerminal");
  terminal.style.fontFamily = `"${profile.font}", monospace`;
  terminal.style.fontSize = `${Math.min(40, Math.max(8, profile.fontSize))}px`;
  terminal.style.lineHeight = String(profile.lineHeight);
  document.getElementById("profilePreviewTitle").textContent = `${profile.name} — ${profile.shell?.split("/").pop() || "shell"}`;
  const cursor = document.getElementById("profilePreviewCursor");
  cursor.className = `preview-cursor ${profile.cursorStyle}${profile.cursorBlink ? " blink" : ""}`;
}

profileForm.addEventListener("input", (e) => {
  const key = e.target.dataset.color || e.target.dataset.hex;
  if (key) {
    if (!/^#[0-9a-f]{6}$/i.test(e.target.value)) return;
    draftColors[profileMode][key] = e.target.value.toLowerCase();
    profileForm.querySelectorAll(`[data-color="${key}"], [data-hex="${key}"]`).forEach((input) => { input.value = e.target.value; });
    updatePresetSelection();
  }
  document.getElementById("profileStatus").textContent = "";
  updateProfilePreview();
});
profileForm.addEventListener("change", () => updateProfilePreview());
document.getElementById("pCustomColors").addEventListener("change", () => renderProfileColors());
document.querySelectorAll("[data-profile-mode]").forEach((button) => {
  button.onclick = () => {
    profileMode = button.dataset.profileMode;
    renderProfileColors();
  };
});

profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const profile = readProfileForm();
  Profiles.upsertProfile(profile);
  if (document.getElementById("pDefault").checked) Profiles.setDefaultProfile(profile.id);
  else if (Profiles.defaultProfileId() === profile.id) Profiles.setDefaultProfile(null);
  editingId = profile.id;
  for (const handle of termsById.values()) {
    if (handle.profileId === profile.id) handle.applyProfile(profile);
  }
  if (e.submitter?.id === "pApply") {
    const handle = focusedHandle();
    if (handle) {
      handle.followThemeProfile = false;
      handle.applyProfile(profile);
    }
    closeProfileModal();
  } else {
    document.getElementById("profileStatus").textContent = t("profile.saved");
  }
  renderProfileList();
  renderProfilesMenu();
});

function renderProfilesMenu() {
  const menu = document.getElementById("profilesMenu");
  [...menu.querySelectorAll("button[data-profile]")].forEach((b) => b.remove());
  const hr = menu.querySelector("hr");
  for (const p of Profiles.loadProfiles()) {
    const b = document.createElement("button");
    b.dataset.profile = p.id;
    b.textContent = p.name;
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
window.addEventListener("keydown", (e) => {
  if (modal.hidden) return;
  if (e.key === "Escape" && e.target.closest(".themed-select.open")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeProfileModal();
  } else if (e.key === "Tab") {
    const controls = [...modal.querySelectorAll("button, input, select, summary, [tabindex='0']")].filter((control) => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  }
  // Los atajos de la terminal no deben cerrar pestañas mientras se escribe un perfil.
  if (e.ctrlKey || e.key === "Escape" || e.defaultPrevented) e.stopImmediatePropagation();
}, true);

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
          <button class="widget-tool drag" title="${escapeHtml(t("widget.move"))}" aria-label="${escapeHtml(t("widget.move"))}" draggable="true">${icon("grip", 14)}</button>
          ${hasOpts ? `<button class="widget-tool cfg" title="${escapeHtml(t("widget.configure"))}" aria-label="${escapeHtml(t("widget.configure"))}">${icon("cog", 14)}</button>` : ""}
          <button class="widget-tool del" title="${escapeHtml(t("widget.remove"))}" aria-label="${escapeHtml(t("widget.remove"))}">${icon("close", 14)}</button>
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
      bar.style.transform = `scaleX(${Math.min(100, Math.max(0, out.percent)) / 100})`;
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
    const el = document.createElement("button");
    el.type = "button";
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
// =====================================================================
//  Soltar archivos sobre la terminal
// =====================================================================
// Tauri intercepta el arrastre nativo (dragDropEnabled, activo por defecto) y
// el DOM nunca recibe el `drop` con los archivos: las rutas llegan por este
// evento. Se escriben entrecomilladas en el panel donde se soltaron, como
// hacen Konsole y GNOME Terminal, sin Enter.
win.onDragDropEvent(({ payload }) => {
  if (payload.type !== "drop" || !payload.paths.length) return;
  // Aunque el tipo diga «física», en Linux wry pasa las coordenadas de GTK
  // sin escalar (webkitgtk/drag_drop.rs), que ya son píxeles CSS: dividir
  // por devicePixelRatio apuntaría a otro panel con escalado 2x.
  const { x, y } = payload.position;
  const pane = document.elementFromPoint(x, y)?.closest(".pane");
  const tab = activeTab();
  const handle = tab?.terms.find((h) => h.paneEl === pane) ?? focusedHandle();
  if (!handle) return;
  invoke("pty_write", { id: handle.id, data: `${payload.paths.map(shellQuote).join(" ")} ` });
  handle.term.focus();
}).catch((e) => console.error("[bookos-shell] sin arrastrar y soltar:", e));

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
  // Una ventana abierta con Ctrl+N empieza donde estaba la terminal de origen.
  const initialCwd = await invoke("initial_cwd").catch(() => null);
  if (!(state.restoreSession && ownsSession && restoreSession())) createTab(null, initialCwd);
  setInterval(saveSession, 5000);
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
