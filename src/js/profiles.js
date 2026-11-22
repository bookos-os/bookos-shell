// Gestión de perfiles: persistencia en localStorage, CRUD y selección
// automática según el modo claro/oscuro.

const KEY = "bookos.profiles";
const DEFAULT_KEY = "bookos.defaultProfile";

export function loadProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(profiles) ? profiles : [];
  } catch {
    return [];
  }
}

export function saveProfiles(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertProfile(profile) {
  const list = loadProfiles();
  // Una asociación por modo evita que el primer perfil guardado oculte los siguientes.
  if (profile.activateOn && profile.activateOn !== "none") {
    for (const p of list) {
      if (p.id !== profile.id && p.activateOn === profile.activateOn) p.activateOn = "none";
    }
  }
  const i = list.findIndex((p) => p.id === profile.id);
  if (i >= 0) list[i] = profile;
  else list.push(profile);
  saveProfiles(list);
  return list;
}

export function deleteProfile(id) {
  if (localStorage.getItem(DEFAULT_KEY) === id) setDefaultProfile(null);
  const list = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(list);
  return list;
}

// La asociación por modo tiene prioridad sobre el perfil predeterminado.
export function profileForTheme(theme) {
  const profiles = loadProfiles();
  return profiles.find((p) => p.activateOn === theme) || profiles.find((p) => p.id === defaultProfileId()) || null;
}

export function defaultProfileId() {
  return localStorage.getItem(DEFAULT_KEY);
}

export function setDefaultProfile(id) {
  if (id) localStorage.setItem(DEFAULT_KEY, id);
  else localStorage.removeItem(DEFAULT_KEY);
}

export function newProfileId() {
  return `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
