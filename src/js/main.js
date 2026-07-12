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
};

// Mapa id-de-pty -> handle de terminal, para enrutar datos del backend.
const termsById = new Map();

// =====================================================================
//  Tema
// =====================================================================
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
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
  tab.viewEl.appendChild(pane);

  const handle = createTerminal(pane, {
    theme: state.theme,
    profile,
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
  tab.terms.forEach((h) => {
    termsById.delete(h.id);
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
      `<button class="tab-close" title="Cerrar pestaña">✕</button>`;
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
  "toggle-stats": () => {
    const panel = document.getElementById("syspanel");
    panel.classList.toggle("hidden");
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
document.querySelectorAll(".menu-trigger").forEach((trigger) => {
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = trigger.closest(".menu");
    const wasOpen = menu.classList.contains("open");
    closeAllMenus();
    if (!wasOpen) menu.classList.add("open");
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
  else if (ctrl && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoom(1); }
  else if (ctrl && e.key === "-") { e.preventDefault(); zoom(-1); }
  else if (ctrl && e.key === "0") { e.preventDefault(); zoomReset(); }
});

// =====================================================================
//  Selectores de idioma y tema
// =====================================================================
const langSel = document.getElementById("langSelect");
langSel.value = localStorage.getItem("bookos.lang") || "es";
langSel.addEventListener("change", () => {
  setLang(langSel.value);
  renderProfileList();
  renderWidgets(); // re-traduce títulos de widgets
});

const themeSel = document.getElementById("themeSelect");
themeSel.value = state.themeMode;
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
    item.innerHTML = `<span>${escapeHtml(p.name)}<br><small>${escapeHtml(p.font)} ${p.fontSize}px${when}</small></span><span class="del">✕</span>`;
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
}
function resetProfileForm() {
  editingId = null;
  document.getElementById("profileForm").reset();
  document.getElementById("pFontSize").value = 14;
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
          <button class="widget-tool del" title="${escapeHtml(t("widget.remove"))}">✕</button>
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
      termsById.delete(h.id);
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
