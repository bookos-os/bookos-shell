// Gestión de terminales xterm.js + WebGL, conectadas al PTY de Rust.
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";

// Paletas de terminal alineadas con BookOS (claro/oscuro).
const TERM_THEMES = {
  light: {
    background: "#ffffff",
    foreground: "#1c1c1e",
    cursor: "#007aff",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0,122,255,0.25)",
    black: "#000000", red: "#ff3b30", green: "#34c759", yellow: "#ff9500",
    blue: "#007aff", magenta: "#af52de", cyan: "#5ac8fa", white: "#8e8e93",
    brightBlack: "#3a3a3c", brightRed: "#ff453a", brightGreen: "#30d158",
    brightYellow: "#ffcc00", brightBlue: "#0a84ff", brightMagenta: "#bf5af2",
    brightCyan: "#64d2ff", brightWhite: "#1c1c1e",
  },
  dark: {
    background: "#000000",
    foreground: "#f2f2f7",
    cursor: "#0a84ff",
    cursorAccent: "#000000",
    selectionBackground: "rgba(10,132,255,0.35)",
    black: "#1c1c1e", red: "#ff453a", green: "#30d158", yellow: "#ffd60a",
    blue: "#0a84ff", magenta: "#bf5af2", cyan: "#64d2ff", white: "#aeaeb2",
    brightBlack: "#48484a", brightRed: "#ff6961", brightGreen: "#32d74b",
    brightYellow: "#ffd60a", brightBlue: "#409cff", brightMagenta: "#da8fff",
    brightCyan: "#70d7ff", brightWhite: "#ffffff",
  },
};

let counter = 0;

/** Crea una terminal dentro de `container`. Devuelve un handle con su id. */
export function createTerminal(container, { theme, profile, onTitle } = {}) {
  const id = `pty-${Date.now()}-${counter++}`;
  const term = new Terminal({
    fontFamily: `${profile?.font || "Hack"}, "SF Mono", monospace`,
    fontSize: profile?.fontSize || 14,
    cursorBlink: true,
    // Los fondos de las paletas son opacos: con transparencia activada el
    // WebView (WebKitGTK) paga composición alfa en cada frame para nada.
    allowTransparency: false,
    scrollback: 10000,
    theme: TERM_THEMES[theme] || TERM_THEMES.dark,
  });

  // Deja pasar los atajos de la app (Ctrl+T/W/N, divisiones, zoom, copiar/
  // pegar). Devolviendo false, xterm NO procesa la tecla y nuestro listener
  // global de la ventana la recibe.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.shiftKey && ["t", "n", "w"].includes(k)) return false;
    if (e.ctrlKey && e.shiftKey && ["d", "e", "c", "v"].includes(k)) return false;
    if (e.ctrlKey && ["+", "=", "-", "0"].includes(e.key)) return false;
    return true;
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container);
  fit.fit();

  // WebGL: delega el render de glifos a la GPU (scroll a 60 fps). Lo cargamos
  // DESPUÉS del primer pintado para que la terminal aparezca al instante (la
  // creación del contexto WebGL es lo más lento del arranque).
  requestAnimationFrame(() => {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose()); // si el contexto cae, no crashea
      term.loadAddon(webgl);
    } catch (e) {
      console.warn("[bookos-shell] WebGL no disponible, render por canvas:", e);
    }
  });

  // Lanza el PTY en Rust con el tamaño actual.
  invoke("pty_spawn", {
    id,
    cols: term.cols,
    rows: term.rows,
    shell: profile?.shell || null,
    cwd: null,
  }).catch((e) => {
    term.write(`\x1b[31m[bookos-shell] no se pudo iniciar la shell: ${e}\x1b[0m\r\n`);
  });

  // Teclas -> PTY.
  term.onData((data) => invoke("pty_write", { id, data }));

  // Título dinámico (secuencias OSC del shell).
  term.onTitleChange((title) => onTitle?.(title));

  // Reajuste al redimensionar, con DEBOUNCE: durante la animación del panel
  // el ancho cambia en cada frame; si reajustáramos en cada uno, zsh/p10k
  // redibujaría el prompt decenas de veces y se vería partido. Esperamos a que
  // el tamaño se estabilice (~120ms sin cambios) y entonces ajustamos UNA vez.
  let resizeTimer = null;
  let lastCols = term.cols;
  let lastRows = term.rows;
  const doResize = () => {
    try {
      fit.fit();
      // Solo notificamos al PTY si las dimensiones en caracteres cambiaron.
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        invoke("pty_resize", { id, cols: term.cols, rows: term.rows });
        // Fuerza un repintado completo del buffer visible tras el reflow.
        term.refresh(0, term.rows - 1);
      }
    } catch {}
  };
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(doResize, 120);
  });
  ro.observe(container);

  return {
    id,
    term,
    fit,
    container,
    dispose() {
      ro.disconnect();
      invoke("pty_kill", { id });
      term.dispose();
    },
    applyTheme(t) {
      term.options.theme = TERM_THEMES[t] || TERM_THEMES.dark;
    },
    applyProfile(p) {
      if (p.font) term.options.fontFamily = `${p.font}, "SF Mono", monospace`;
      if (p.fontSize) term.options.fontSize = p.fontSize;
      this.refit();
    },
    setFontSize(px) {
      term.options.fontSize = px;
      this.refit();
    },
    refit() {
      // Reutiliza la lógica con dedupe: no reenvía SIGWINCH si el tamaño en
      // caracteres no cambió (evita redibujados innecesarios del prompt).
      doResize();
    },
    write(data) {
      term.write(data);
    },
  };
}
