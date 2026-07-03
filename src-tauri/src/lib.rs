//! BookOS Shell — backend Tauri.
//!
//! Expone comandos al frontend para: manejar PTYs (crear/escribir/redimensionar/
//! cerrar), leer estadísticas del sistema, listar fuentes, y abrir nuevas
//! ventanas de terminal. Además arranca el listener de tema D-Bus.

mod pty;
mod stats;
mod theme;

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, State, WebviewUrl, WebviewWindowBuilder};

/// Contador para títulos/ids de ventanas nuevas.
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

// ---------- Comandos PTY ----------

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    mgr: State<pty::PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    mgr.spawn(app, id, cols, rows, shell, cwd)
}

#[tauri::command]
fn pty_write(mgr: State<pty::PtyManager>, id: String, data: String) -> Result<(), String> {
    mgr.write(&id, &data)
}

#[tauri::command]
fn pty_resize(
    mgr: State<pty::PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    mgr.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_kill(mgr: State<pty::PtyManager>, id: String) {
    mgr.kill(&id);
}

// ---------- Comandos del sistema ----------

#[tauri::command]
fn get_stats() -> stats::Stats {
    stats::collect()
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    stats::list_fonts()
}

/// Tema actual del escritorio ("light" | "dark"), leído al arrancar.
#[tauri::command]
fn get_theme() -> String {
    theme::current_theme()
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
async fn new_window(app: AppHandle) -> Result<(), String> {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::SeqCst);
    let label = format!("term-{n}");
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

/// En Linux (WebKitGTK) fija el zoom del WebView a 1.0 y lo bloquea ante
/// cualquier intento de cambio (pinch del touchpad, atajos nativos).
#[cfg(target_os = "linux")]
fn disable_webview_zoom(app: &tauri::App) {
    use tauri::Manager;
    use webkit2gtk::{WebViewExt, SettingsExt};

    for (_label, window) in app.webview_windows() {
        let _ = window.with_webview(|webview| {
            let wv = webview.inner(); // webkit2gtk::WebView
            wv.set_zoom_level(1.0);
            if let Some(settings) = WebViewExt::settings(&wv) {
                // Evita que el zoom afecte solo al texto y bloquea gestos.
                settings.set_zoom_text_only(false);
            }
            // Si algo cambia el zoom, lo devolvemos a 1.0 al instante.
            wv.connect_zoom_level_notify(|w| {
                if (w.zoom_level() - 1.0).abs() > f64::EPSILON {
                    w.set_zoom_level(1.0);
                }
            });
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::PtyManager::new())
        .setup(|app| {
            // Arranca el listener de tema del escritorio.
            theme::spawn_listener(app.handle().clone());
            // Desactiva el pinch-zoom del touchpad en WebKitGTK (Linux): el
            // gesto lo procesa el WebView a nivel nativo, no llega a JS. Aquí
            // bloqueamos cualquier cambio de zoom reseteándolo a 1.0.
            #[cfg(target_os = "linux")]
            disable_webview_zoom(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            get_stats,
            list_fonts,
            get_theme,
            open_path,
            new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar BookOS Shell");
}
