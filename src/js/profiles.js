// Gestión de perfiles: persistencia en localStorage, CRUD y selección
// automática según el modo claro/oscuro.

const KEY = "bookos.profiles";

export function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

export function saveProfiles(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertProfile(profile) {
  const list = loadProfiles();
  const i = list.findIndex((p) => p.id === profile.id);
  if (i >= 0) list[i] = profile;
  else list.push(profile);
  saveProfiles(list);
  return list;
}

export function deleteProfile(id) {
  const list = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(list);
  return list;
}

/** Devuelve el primer perfil configurado para activarse con este tema. */
export function profileForTheme(theme) {
  return loadProfiles().find((p) => p.activateOn === theme) || null;
}

export function newProfileId() {
  return `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
