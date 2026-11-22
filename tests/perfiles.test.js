import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as Profiles from "../src/js/profiles.js";
import { resolveTerminalTheme, presetColors } from "../src/js/terminal-theme.js";

beforeEach(() => {
  const datos = new Map();
  globalThis.localStorage = {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => datos.set(clave, String(valor)),
    removeItem: (clave) => datos.delete(clave),
  };
});

test("los perfiles antiguos conservan fuente y shell al añadir colores por modo", () => {
  Profiles.upsertProfile({ id: "trabajo", name: "Trabajo", font: "Hack", shell: "/bin/bash", fontSize: 16, activateOn: "none" });
  const [perfil] = Profiles.loadProfiles();
  perfil.colors = { light: presetColors("paper", "light"), dark: presetColors("ocean", "dark") };
  Profiles.upsertProfile(perfil);
  const [guardado] = Profiles.loadProfiles();
  assert.equal(guardado.shell, "/bin/bash");
  assert.equal(guardado.fontSize, 16);
  assert.equal(resolveTerminalTheme("light", guardado).background, "#faf4e8");
  assert.equal(resolveTerminalTheme("dark", guardado).background, "#101c30");
});

test("el perfil asociado al modo tiene prioridad sobre el predeterminado", () => {
  Profiles.upsertProfile({ id: "base", activateOn: "none" });
  Profiles.upsertProfile({ id: "noche", activateOn: "dark" });
  Profiles.setDefaultProfile("base");
  assert.equal(Profiles.profileForTheme("light").id, "base");
  assert.equal(Profiles.profileForTheme("dark").id, "noche");
});

test("asignar un perfil a un modo sustituye la asociación anterior", () => {
  Profiles.upsertProfile({ id: "anterior", activateOn: "dark" });
  Profiles.upsertProfile({ id: "nuevo", activateOn: "dark" });
  assert.equal(Profiles.profileForTheme("dark").id, "nuevo");
  assert.equal(Profiles.loadProfiles().find((perfil) => perfil.id === "anterior").activateOn, "none");
});

test("borrar el perfil predeterminado elimina también su preferencia", () => {
  Profiles.upsertProfile({ id: "base", activateOn: "none" });
  Profiles.setDefaultProfile("base");
  Profiles.deleteProfile("base");
  assert.equal(Profiles.defaultProfileId(), null);
  assert.equal(Profiles.profileForTheme("light"), null);
});

test("los colores propios y ANSI prevalecen sobre la paleta dinámica", () => {
  const perfil = { colors: { dark: { background: "#112233", foreground: "#ddeeff", cursor: "#abcdef", selectionBackground: "#336699", blue: "#9988ff", brightRed: "#ff8877" } } };
  const estilos = { getPropertyValue: () => "#ff0000" };
  const paleta = resolveTerminalTheme("dark", perfil, estilos);
  assert.equal(paleta.background, "#112233");
  assert.equal(paleta.foreground, "#ddeeff");
  assert.equal(paleta.cursor, "#abcdef");
  assert.equal(paleta.cursorAccent, "#112233");
  assert.equal(paleta.selectionBackground, "#33669966");
  assert.equal(paleta.blue, "#9988ff");
  assert.equal(paleta.brightRed, "#ff8877");
});

test("sin colores propios se mantienen los colores del escritorio", () => {
  const valores = { "--bg-term": "#101010", "--fg": "#ededed", "--accent": "#7788ff" };
  const paleta = resolveTerminalTheme("dark", { font: "Hack" }, { getPropertyValue: (clave) => valores[clave] || "" });
  assert.equal(paleta.background, "#101010");
  assert.equal(paleta.foreground, "#ededed");
  assert.equal(paleta.selectionBackground, "#7788ff40");
});

test("cada preajuste devuelve una paleta independiente para cada modo", () => {
  const claro = presetColors("classic", "light");
  const oscuro = presetColors("classic", "dark");
  claro.background = "#123456";
  assert.equal(oscuro.background, "#000000");
  assert.equal(presetColors("classic", "light").background, "#ffffff");
});

test("un almacén dañado o de un tipo incorrecto no impide abrir el gestor", () => {
  for (const valor of ["{", "{}", "null", "42"]) {
    localStorage.setItem("bookos.profiles", valor);
    assert.deepEqual(Profiles.loadProfiles(), []);
  }
});
