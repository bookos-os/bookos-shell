// Diccionarios de traducción. Cada clave usa notación punteada que coincide
// con los atributos data-i18n del HTML. applyI18n() recorre el DOM y sustituye.

export const dict = {
  es: {
    "menu.file": "Archivo",
    "menu.edit": "Editar",
    "menu.view": "Ver",
    "menu.profiles": "Perfiles",
    "menu.settings": "Ajustes",

    "action.newTab": "Nueva pestaña",
    "action.newWindow": "Nueva ventana",
    "action.splitH": "Dividir horizontal",
    "action.splitV": "Dividir vertical",
    "action.closeTab": "Cerrar pestaña",
    "action.copy": "Copiar",
    "action.paste": "Pegar",
    "action.clear": "Limpiar",
    "action.zoomIn": "Ampliar texto",
    "action.zoomOut": "Reducir texto",
    "action.zoomReset": "Tamaño normal",
    "action.toggleStats": "Panel de sistema",
    "action.hideStats": "Ocultar panel de sistema",
    "action.showStats": "Mostrar panel de sistema",
    "action.manageProfiles": "Gestionar perfiles…",

    "settings.language": "Idioma",
    "settings.themeMode": "Tema",
    "settings.themeAuto": "Automático",
    "settings.themeLight": "Claro",
    "settings.themeDark": "Oscuro",
    "settings.caseInsensitive": "Permitir comandos con mayúsculas",
    "settings.dynamicPalette": "Usar colores dinámicos de BookOS Settings",

    "palette.title": "Paleta de comandos",
    "palette.open": "Comandos",
    "palette.openTitle": "Abrir paleta de comandos",
    "palette.placeholder": "Buscar una acción o comando…",
    "palette.navigate": "navegar",
    "palette.run": "ejecutar",
    "palette.caseNote": "búsqueda sin mayúsculas",
    "palette.empty": "No hay coincidencias",
    "palette.nextPane": "Cambiar de panel",
    "palette.switchTab": "Cambiar de pestaña",
    "palette.pwd": "Mostrar directorio actual",
    "palette.list": "Listar archivos detalladamente",
    "palette.disk": "Mostrar espacio de disco",
    "palette.memory": "Mostrar memoria disponible",
    "palette.processes": "Mostrar procesos activos",
    "directory.title": "Elegir directorio",
    "directory.suggest": "¿Querías decir",
    "directory.filter": "filtro",
    "directory.move": "mover",
    "directory.enter": "entrar",
    "directory.cancel": "cancelar",
    "directory.empty": "No hay carpetas que coincidan",

    "sys.title": "Sistema",
    "sys.cpu": "CPU",
    "sys.gpu": "GPU",
    "sys.mem": "Memoria",
    "sys.swap": "Swap",
    "sys.disk": "Disco",
    "sys.ip": "IP local",
    "sys.iface": "Interfaz",
    "sys.battery": "Batería",
    "sys.network": "Red",
    "sys.clock": "Reloj",

    "widget.add": "Añadir widget",
    "widget.hide": "Ocultar panel",
    "widget.pickTitle": "Añadir widget",
    "widget.configTitle": "Configurar widget",
    "widget.size": "Tamaño",
    "widget.sizeSmall": "Pequeño",
    "widget.sizeMedium": "Mediano",
    "widget.remove": "Quitar",
    "widget.configure": "Configurar",
    "wopt.showFs": "Mostrar sistema de archivos",
    "wopt.showState": "Mostrar estado",
    "wopt.seconds": "Mostrar segundos",

    "wm.minimize": "Minimizar",
    "wm.maximize": "Maximizar",
    "wm.close": "Cerrar",
    "side.title": "Atajos",

    "profile.title": "Perfiles",
    "profile.name": "Nombre",
    "profile.font": "Tipografía",
    "profile.fontSize": "Tamaño",
    "profile.shell": "Shell",
    "profile.activateOn": "Activar al cambiar a",
    "profile.activateNone": "Nunca (manual)",
    "profile.activateLight": "Modo claro",
    "profile.activateDark": "Modo oscuro",
    "profile.save": "Guardar",
    "profile.newProfile": "Nuevo",
    "profile.empty": "Aún no hay perfiles. Crea uno con el formulario de la derecha.",

    "bat.charging": "Cargando",
    "bat.discharging": "Descargando",
    "bat.full": "Cargada",
  },
  en: {
    "menu.file": "File",
    "menu.edit": "Edit",
    "menu.view": "View",
    "menu.profiles": "Profiles",
    "menu.settings": "Settings",

    "action.newTab": "New tab",
    "action.newWindow": "New window",
    "action.splitH": "Split horizontally",
    "action.splitV": "Split vertically",
    "action.closeTab": "Close tab",
    "action.copy": "Copy",
    "action.paste": "Paste",
    "action.clear": "Clear",
    "action.zoomIn": "Zoom in",
    "action.zoomOut": "Zoom out",
    "action.zoomReset": "Actual size",
    "action.toggleStats": "System panel",
    "action.hideStats": "Hide system panel",
    "action.showStats": "Show system panel",
    "action.manageProfiles": "Manage profiles…",

    "settings.language": "Language",
    "settings.themeMode": "Theme",
    "settings.themeAuto": "Automatic",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.caseInsensitive": "Allow uppercase commands",
    "settings.dynamicPalette": "Use dynamic BookOS Settings colors",

    "palette.title": "Command palette",
    "palette.open": "Commands",
    "palette.openTitle": "Open command palette",
    "palette.placeholder": "Search an action or command…",
    "palette.navigate": "navigate",
    "palette.run": "run",
    "palette.caseNote": "case insensitive search",
    "palette.empty": "No matches",
    "palette.nextPane": "Switch pane",
    "palette.switchTab": "Switch tab",
    "palette.pwd": "Show current directory",
    "palette.list": "List files in detail",
    "palette.disk": "Show disk space",
    "palette.memory": "Show available memory",
    "palette.processes": "Show active processes",
    "directory.title": "Choose directory",
    "directory.suggest": "Did you mean",
    "directory.filter": "filter",
    "directory.move": "move",
    "directory.enter": "enter",
    "directory.cancel": "cancel",
    "directory.empty": "No matching folders",

    "sys.title": "System",
    "sys.cpu": "CPU",
    "sys.gpu": "GPU",
    "sys.mem": "Memory",
    "sys.swap": "Swap",
    "sys.disk": "Disk",
    "sys.ip": "Local IP",
    "sys.iface": "Interface",
    "sys.battery": "Battery",
    "sys.network": "Network",
    "sys.clock": "Clock",

    "widget.add": "Add widget",
    "widget.hide": "Hide panel",
    "widget.pickTitle": "Add widget",
    "widget.configTitle": "Configure widget",
    "widget.size": "Size",
    "widget.sizeSmall": "Small",
    "widget.sizeMedium": "Medium",
    "widget.remove": "Remove",
    "widget.configure": "Configure",
    "wopt.showFs": "Show filesystem",
    "wopt.showState": "Show state",
    "wopt.seconds": "Show seconds",

    "wm.minimize": "Minimize",
    "wm.maximize": "Maximize",
    "wm.close": "Close",
    "side.title": "Shortcuts",

    "profile.title": "Profiles",
    "profile.name": "Name",
    "profile.font": "Font",
    "profile.fontSize": "Size",
    "profile.shell": "Shell",
    "profile.activateOn": "Activate when switching to",
    "profile.activateNone": "Never (manual)",
    "profile.activateLight": "Light mode",
    "profile.activateDark": "Dark mode",
    "profile.save": "Save",
    "profile.newProfile": "New",
    "profile.empty": "No profiles yet. Create one with the form on the right.",

    "bat.charging": "Charging",
    "bat.discharging": "Discharging",
    "bat.full": "Full",
  },
};

let current = "es";

export function setLang(lang) {
  current = dict[lang] ? lang : "es";
  document.documentElement.lang = current;
  applyI18n();
  localStorage.setItem("bookos.lang", current);
}

export function getLang() {
  return current;
}

/** Traduce una clave suelta (para textos generados por JS). */
export function t(key) {
  return dict[current][key] ?? key;
}

/** Recorre el DOM aplicando traducciones a todo elemento con data-i18n. */
export function applyI18n() {
  const table = dict[current];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (table[key]) el.textContent = table[key];
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (table[key]) el.title = table[key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (table[key]) el.placeholder = table[key];
  });
}
