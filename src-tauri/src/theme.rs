//! Escucha el tema del escritorio vía el portal D-Bus
//! `org.freedesktop.appearance` (`color-scheme`).
//!
//!   0 = sin preferencia · 1 = oscuro · 2 = claro
//!
//! Al arrancar leemos el valor actual; luego nos suscribimos a la señal
//! `SettingChanged` y emitimos `theme://changed` al frontend cada vez que el
//! usuario alterna claro/oscuro en KDE Plasma.

use futures_util::stream::StreamExt;
use tauri::{AppHandle, Emitter};
use zbus::{proxy, Connection};
use zvariant::OwnedValue;

#[proxy(
    interface = "org.freedesktop.portal.Settings",
    default_service = "org.freedesktop.portal.Desktop",
    default_path = "/org/freedesktop/portal/desktop"
)]
trait Settings {
    fn read_one(&self, namespace: &str, key: &str) -> zbus::Result<OwnedValue>;

    #[zbus(signal)]
    fn setting_changed(&self, namespace: String, key: String, value: OwnedValue)
        -> zbus::Result<()>;
}

/// Convierte el entero del portal en la cadena que usa nuestro CSS.
fn scheme_to_str(v: u32) -> &'static str {
    match v {
        1 => "dark",
        2 => "light",
        _ => "light", // sin preferencia -> claro, como BookOS por defecto
    }
}

/// Extrae el u32 del valor D-Bus, que llega anidado en variantes.
fn extract_u32(val: &OwnedValue) -> Option<u32> {
    if let Ok(v) = u32::try_from(val) {
        return Some(v);
    }
    // A veces llega como Value::Value(box) anidado.
    if let Ok(inner) = val.downcast_ref::<zvariant::Value>() {
        if let zvariant::Value::U32(n) = inner {
            return Some(n);
        }
    }
    None
}

/// Lee el tema actual del escritorio de forma síncrona, para usarlo al
/// arrancar sin depender de que el portal D-Bus emita el primer evento.
///
/// Estrategia: primero `kdeglobals` (KDE Plasma — tu caso), luego una
/// heurística sobre la variable de entorno; por defecto "light".
pub fn current_theme() -> String {
    if let Some(home) = std::env::var_os("HOME") {
        let path = std::path::Path::new(&home).join(".config/kdeglobals");
        if let Ok(content) = std::fs::read_to_string(&path) {
            for line in content.lines() {
                // LookAndFeelPackage=BookOS Dark  /  ColorScheme=BookOSDark
                if let Some(v) = line
                    .strip_prefix("LookAndFeelPackage=")
                    .or_else(|| line.strip_prefix("ColorScheme="))
                {
                    let v = v.to_lowercase();
                    if v.contains("dark") {
                        return "dark".into();
                    }
                    if v.contains("light") {
                        return "light".into();
                    }
                }
            }
        }
    }
    "light".into()
}

/// Lanza el listener en segundo plano. No bloquea: arranca su propia tarea async.
pub fn spawn_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(app).await {
            eprintln!("[theme] listener detenido: {e}");
        }
    });
}

async fn run(app: AppHandle) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let proxy = SettingsProxy::new(&conn).await?;

    // Estado inicial.
    if let Ok(val) = proxy
        .read_one("org.freedesktop.appearance", "color-scheme")
        .await
    {
        if let Some(n) = extract_u32(&val) {
            let _ = app.emit("theme://changed", scheme_to_str(n));
        }
    }

    // Suscripción a cambios en vivo.
    let mut changes = proxy.receive_setting_changed().await?;
    while let Some(signal) = changes.next().await {
        let args = match signal.args() {
            Ok(a) => a,
            Err(_) => continue,
        };
        if args.namespace == "org.freedesktop.appearance" && args.key == "color-scheme" {
            if let Some(n) = extract_u32(&args.value) {
                let _ = app.emit("theme://changed", scheme_to_str(n));
            }
        }
    }
    Ok(())
}
