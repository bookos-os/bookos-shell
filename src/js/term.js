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

function resolvedTermTheme(theme) {
  const fallback = TERM_THEMES[theme] || TERM_THEMES.dark;
  const styles = getComputedStyle(document.documentElement);
  const read = (name, value) => styles.getPropertyValue(name).trim() || value;
  const background = read("--bg-term", fallback.background);
  const accent = read("--accent", fallback.cursor);
  return {
    ...fallback,
    background,
    foreground: read("--fg", fallback.foreground),
    cursor: accent,
    cursorAccent: background,
    selectionBackground: read("--selection", fallback.selectionBackground),
    blue: accent,
  };
}

let counter = 0;

/** Crea una terminal dentro de `container`. Devuelve un handle con su id. */
export function createTerminal(container, {
  theme,
  profile,
  onTitle,
  onCommandLine,
  caseInsensitiveCommands = true,
} = {}) {
  const id = `pty-${Date.now()}-${counter++}`;
  const term = new Terminal({
    fontFamily: `${profile?.font || "Hack"}, "SF Mono", monospace`,
    fontSize: profile?.fontSize || 14,
    cursorBlink: true,
    // Los fondos de las paletas son opacos: con transparencia activada el
    // WebView (WebKitGTK) paga composición alfa en cada frame para nada.
    allowTransparency: false,
    scrollback: 10000,
    theme: resolvedTermTheme(theme),
  });

  // Deja pasar los atajos de la app (Ctrl+T/W/N, divisiones, zoom, copiar/
  // pegar). Devolviendo false, xterm NO procesa la tecla y nuestro listener
  // global de la ventana la recibe.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.shiftKey && ["t", "n", "w", "k"].includes(k)) return false;
    if (e.ctrlKey && e.shiftKey && ["d", "e", "c", "v", "p", "s"].includes(k)) return false;
    if (e.ctrlKey && ["+", "=", "-", "0"].includes(e.key)) return false;
    if (e.ctrlKey && e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return false;
    if (e.ctrlKey && ["PageUp", "PageDown"].includes(e.key)) return false;
    if (e.ctrlKey && e.key === "Tab") return false;
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

  // Seguimiento ligero de la línea actual. Permite que "LS" se ejecute como
  // "ls" sin tocar argumentos ni rutas: "CD /TMP" se convierte en
  // "cd /TMP". Si el usuario usa edición avanzada, historial o una secuencia
  // ANSI, dejamos que la shell procese la entrada tal cual.
  let inputLine = "";
  let inputTrackable = true;
  let tolerateCommandCase = caseInsensitiveCommands;
  let inputModeHandler = null;

  function commandAwareData(data) {
    if (!tolerateCommandCase || data !== "\r" || !inputTrackable) return data;
    const match = inputLine.match(/^(\s*)([A-Za-z_][A-Za-z0-9_+.-]*)(.*)$/s);
    if (!match) return data;
    const command = match[2];
    const normalized = command.toLocaleLowerCase();
    if (command === normalized) return data;
    // Ctrl+U limpia la línea de readline y la reescribimos con el comando
    // normalizado. Los argumentos quedan exactamente como los introdujo el
    // usuario, incluidos nombres de archivo con mayúsculas.
    return `\x15${match[1]}${normalized}${match[3]}\r`;
  }

  function writeToPty(data) {
    invoke("pty_write", { id, data }).catch((e) =>
      console.warn("[bookos-shell] no se pudo escribir en el PTY:", e)
    );
  }

  function trackInput(data) {
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        inputLine = "";
        inputTrackable = true;
      } else if (char === "\x03" || char === "\x15") {
        inputLine = "";
        inputTrackable = true;
      } else if (char === "\x7f" || char === "\b") {
        inputLine = inputLine.slice(0, -1);
      } else if (char === "\x1b") {
        inputTrackable = false;
      } else if (char < " ") {
        // Ctrl+A/E/W y otras órdenes de readline mueven el cursor; desde ese
        // punto ya no podemos reconstruir la línea con seguridad.
        inputTrackable = false;
      } else if (char >= " " && char !== "\x7f" && inputTrackable) {
        inputLine += char;
      }
    }
  }

  // Teclas -> PTY.
  term.onData((data) => {
    if (inputModeHandler) {
      inputModeHandler(data);
      return;
    }
    if (data === "\r" && inputTrackable && onCommandLine?.(inputLine, writeToPty)) {
      // El selector toma el control de una línea `cd`; quitamos el texto que
      // readline ya ha mostrado mientras esperamos la elección del usuario.
      trackInput(data);
      writeToPty("\x15");
      return;
    }
    const outgoing = commandAwareData(data);
    trackInput(data);
    writeToPty(outgoing);
  });

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
      term.options.theme = resolvedTermTheme(t);
    },
    applyProfile(p) {
      if (p.font) term.options.fontFamily = `${p.font}, "SF Mono", monospace`;
      if (p.fontSize) term.options.fontSize = p.fontSize;
      this.refit();
    },
    setCaseInsensitive(enabled) {
      tolerateCommandCase = enabled;
    },
    setInputMode(handler) {
      inputModeHandler = handler;
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
