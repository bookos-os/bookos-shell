// Paletas de terminal alineadas con BookOS (claro/oscuro).
export const TERM_THEMES = {
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

export const COLOR_FIELDS = [
  ["background", "profile.background"], ["foreground", "profile.foreground"],
  ["cursor", "profile.cursorColor"], ["selectionBackground", "profile.selection"],
];
export const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

export const PALETTE_PRESETS = {
  classic: { light: {}, dark: {} },
  ocean: { light: { background: "#f0f7ff", foreground: "#19344d", cursor: "#006cce" }, dark: { background: "#101c30", foreground: "#d5e5ff", cursor: "#79b8ff" } },
  paper: { light: { background: "#faf4e8", foreground: "#493e32", cursor: "#996225" }, dark: { background: "#28231e", foreground: "#e9ddc9", cursor: "#e4b975" } },
  forest: { light: { background: "#f1f7f1", foreground: "#253e30", cursor: "#237348" }, dark: { background: "#15251d", foreground: "#d5e9d8", cursor: "#8bd5a1" } },
};

export function presetColors(name, theme) {
  const palette = { ...TERM_THEMES[theme], ...PALETTE_PRESETS[name][theme] };
  palette.selectionBackground = theme === "light" ? "#8bb9ef" : "#47668d";
  return palette;
}

export function resolveTerminalTheme(theme, profile, styles) {
  const fallback = TERM_THEMES[theme] || TERM_THEMES.dark;
  const read = (name, value) => styles?.getPropertyValue(name).trim() || value;
  const colors = profile?.colors?.[theme];
  const background = colors?.background || read("--bg-term", fallback.background);
  const accent = read("--accent", fallback.cursor);
  return {
    ...fallback,
    ...colors,
    background,
    foreground: colors?.foreground || read("--fg", fallback.foreground),
    cursor: colors?.cursor || accent,
    cursorAccent: background,
    // --selection es un color-mix() con paleta dinámica y el analizador de xterm
    // solo garantiza #hex y rgb(); el acento siempre llega como #rrggbb. 40 = 25 %.
    selectionBackground: colors?.selectionBackground ? `${colors.selectionBackground.slice(0, 7)}66` : `${accent}40`,
    blue: colors?.blue || accent,
  };
}

