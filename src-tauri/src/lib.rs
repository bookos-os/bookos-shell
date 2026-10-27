//! BookOS Shell — backend Tauri.
//!
//! Expone comandos al frontend para: manejar PTYs (crear/escribir/redimensionar/
//! cerrar), leer estadísticas del sistema, listar fuentes, y abrir nuevas
//! ventanas de terminal. Además arranca el listener de tema D-Bus.

mod pty;
mod stats;
mod theme;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

/// Contador para títulos/ids de ventanas nuevas.
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

// ---------- Comandos PTY ----------

// Los comandos van como `async`: en Tauri 2 los comandos síncronos se
// ejecutan en el HILO PRINCIPAL, así que un pty_write por tecla o el refresco
// de stats (disco/red) cada 2 s bloqueaban la UI. Async = pool aparte.

#[tauri::command]
async fn pty_spawn(
    app: AppHandle,
    window: tauri::WebviewWindow,
    mgr: State<'_, pty::PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    mgr.spawn(app, window.label().to_string(), id, cols, rows, shell, cwd)
}

#[tauri::command]
async fn pty_write(
    mgr: State<'_, pty::PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    mgr.write(&id, &data)
}

#[tauri::command]
async fn pty_resize(
    mgr: State<'_, pty::PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    mgr.resize(&id, cols, rows)
}

#[tauri::command]
async fn pty_at_prompt(mgr: State<'_, pty::PtyManager>, id: String) -> Result<bool, String> {
    mgr.at_prompt(&id)
}

#[tauri::command]
async fn pty_cwd(mgr: State<'_, pty::PtyManager>, id: String) -> Result<String, String> {
    mgr.cwd(&id)
}

#[tauri::command]
async fn pty_kill(mgr: State<'_, pty::PtyManager>, id: String) -> Result<(), String> {
    mgr.kill(&id);
    Ok(())
}

// ---------- Comandos del sistema ----------

#[tauri::command]
async fn get_stats() -> stats::Stats {
    stats::collect()
}

#[tauri::command]
async fn list_fonts() -> Vec<String> {
    stats::list_fonts()
}

#[derive(Clone, Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
}

/// Devuelve los directorios de una ruta para el selector visual de `cd`.
/// La ordenación se hace aquí para que sea estable aunque el sistema de
/// archivos devuelva las entradas en un orden diferente.
#[tauri::command]
async fn list_directories(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let mut dirs = std::fs::read_dir(&path)
        .map_err(|e| format!("no se puede leer {path}: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if !entry.metadata().ok()?.is_dir() {
                return None;
            }
            Some(DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
            })
        })
        .collect::<Vec<_>>();
    dirs.sort_by_cached_key(|entry| entry.name.to_lowercase());
    Ok(dirs)
}

#[tauri::command]
async fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

/// Carpeta en la que debe arrancar la primera terminal de cada ventana, por
/// etiqueta. La deja `new_window` y la recoge la ventana nueva al arrancar.
#[derive(Default)]
struct PendingCwd(Mutex<HashMap<String, String>>);

/// Directorio inicial de la primera terminal de esta ventana: la carpeta de la
/// terminal desde la que se abrió, o HOME (nunca la carpeta desde la que se
/// lanzó BookOS Shell).
#[tauri::command]
async fn initial_cwd(window: tauri::WebviewWindow, pending: State<'_, PendingCwd>) -> Result<String, String> {
    Ok(pending
        .0
        .lock()
        .unwrap()
        .remove(window.label())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| "/".to_string()))
}

/// Tema actual del escritorio ("light" | "dark"), leído al arrancar.
///
/// `async` porque la fuente de verdad pasó a ser el portal, y el proxy de zbus
/// que ya usa el vigilante de cambios solo existe en su forma asíncrona: esta
/// build trae zbus sin `blocking-api`.
#[tauri::command]
async fn get_theme() -> String {
    theme::current_theme().await
}

/// Abre una ruta o URL con la app por defecto del sistema (acción de widget:
/// p.ej. el widget de Disco abre el explorador en "/").
#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------- Ventanas ----------

/// Abre una nueva ventana de terminal independiente (como en Notepad).
#[tauri::command]
async fn new_window(
    app: AppHandle,
    pending: State<'_, PendingCwd>,
    cwd: Option<String>,
) -> Result<(), String> {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::SeqCst);
    let label = format!("term-{n}");
    if let Some(cwd) = cwd {
        pending.0.lock().unwrap().insert(label.clone(), cwd);
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("BookOS Shell")
        .inner_size(1280.0, 800.0)
        .min_inner_size(560.0, 360.0)
        .decorations(false)
        .transparent(true)
        .center()
        .visible(false) // se muestra desde JS al tener el tema aplicado (anti-flash)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Quita el zoom de página que WebKitGTK hace con el pellizco del touchpad.
///
/// No hay ajuste para eso ni en WebKit ni en Tauri, y la página no se entera:
/// el pellizco lo consume un `GtkGestureZoom` de la propia vista y llega como
/// `setMagnification`, no como `wheel` ni `touch*`, así que ningún
/// `preventDefault` lo frena. Tampoco devolver `zoom_level` a 1.0, que es lo
/// que se hacía aquí antes: la magnificación es otra escala y no lo toca. Se
/// apaga ese gesto y ningún otro: con fase `None` GTK deja de pasarle eventos
/// (gtkeventcontroller.c, 3.24). Va en `on_page_load` para cubrir también las
/// ventanas de `new_window`, que el bucle de `setup` no veía.
fn desactivar_zoom_por_pellizco<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    _: &tauri::webview::PageLoadPayload<'_>,
) {
    #[cfg(target_os = "linux")]
    let _ = webview.with_webview(|webview| {
        use gtk::glib::translate::from_glib_none;
        use gtk::prelude::*;

        // WebKitGTK guarda ahí el gesto (WebKitWebViewBase.cpp, 2.52.5). No es
        // API pública: si la clave cambia, no se encuentra y el zoom vuelve.
        // Lo guardado es un puntero C a un GObject, no un tipo de Rust.
        let Some(gesto) = (unsafe { webview.inner().data::<gtk::ffi::GtkGesture>("wk-view-zoom-gesture") }) else {
            return;
        };
        let gesto: gtk::Gesture = unsafe { from_glib_none(gesto.as_ptr()) };
        gesto.set_propagation_phase(gtk::PropagationPhase::None);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_page_load(desactivar_zoom_por_pellizco)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::PtyManager::new())
        .manage(PendingCwd::default())
        .setup(|app| {
            // Arranca el listener de tema del escritorio.
            theme::spawn_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bookos_palette_css,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_at_prompt,
            pty_cwd,
            get_stats,
            list_fonts,
            list_directories,
            home_dir,
            initial_cwd,
            get_theme,
            open_path,
            new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar BookOS Shell");
}

// ── Color dinámico ───────────────────────────────────────────────────────
// La paleta la genera BookOS Settings desde el fondo de pantalla y la deja en
// ~/.config/bookos/palette.css. Aquí solo se lee: quien tiñe es la hoja, que
// el cliente bookos-palette.js inyecta al final de <head>.
#[tauri::command]
fn bookos_palette_css() -> String {
    std::env::var("HOME").ok()
        .map(|h| std::path::Path::new(&h).join(".config/bookos/palette.css"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default()
}
