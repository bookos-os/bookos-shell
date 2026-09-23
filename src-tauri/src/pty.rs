//! Puente PTY <-> Frontend.
//!
//! Cada terminal (pestaña o panel dividido) tiene su propio PTY con un `id`
//! único. La salida de la shell se emite con latencia adaptativa: si la
//! terminal estaba en reposo (eco de una tecla, prompt), el primer chunk sale
//! inmediatamente; solo cuando hay flujo continuo (cat de un fichero grande)
//! se agrupa en ventanas de ~16 ms (60 fps) para no saturar el WebView.
//! En reposo no hay ningún wakeup periódico: el hilo emisor duerme bloqueado
//! en el canal (0% CPU, importante en batería).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Ventana de agrupado bajo flujo continuo (60 fps).
const FRAME: Duration = Duration::from_millis(16);

/// Una sesión PTY activa: el par maestro/esclavo y el writer hacia la shell.
struct Session {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
}

/// Registro global de todas las sesiones PTY abiertas, indexadas por id.
#[derive(Default, Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

/// Payload de un volcado de datos hacia el frontend.
#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

/// Emite lo acumulado en `buf` hacia la ventana dueña del PTY.
///
/// Un carácter UTF-8 multibyte partido por el corte del chunk no debe
/// emitirse como '�': la cola incompleta se queda en `buf` y sale entera en
/// el siguiente volcado (salvo en el volcado final, donde ya no habrá más).
fn emit_chunk(app: &AppHandle, target: &str, id: &str, buf: &mut Vec<u8>, final_flush: bool) {
    if buf.is_empty() {
        return;
    }
    let mut chunk = std::mem::take(buf);
    if !final_flush {
        if let Err(e) = std::str::from_utf8(&chunk) {
            if e.error_len().is_none() {
                *buf = chunk.split_off(e.valid_up_to());
            }
        }
        if chunk.is_empty() {
            return;
        }
    }
    let data = String::from_utf8_lossy(&chunk).to_string();
    let _ = app.emit_to(
        target,
        "pty://data",
        PtyOutput {
            id: id.to_string(),
            data,
        },
    );
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Abre un nuevo PTY ejecutando la shell de login del usuario.
    ///
    /// `target` es la etiqueta de la ventana que pidió el PTY: los eventos
    /// `pty://data` / `pty://exit` se emiten SOLO a esa ventana, no a todas
    /// (con varias ventanas abiertas cada WebView deserializaría el tráfico
    /// de todas las terminales).
    pub fn spawn(
        &self,
        app: AppHandle,
        target: String,
        id: String,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        cwd: Option<String>,
    ) -> Result<(), String> {
        let sys = NativePtySystem::default();
        let pair = sys
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty: {e}"))?;

        // Shell: la que pida el frontend (perfil), o $SHELL, o /bin/bash.
        // Por petición del usuario, NUNCA usamos fish: si la shell resuelta es
        // fish, caemos a la primera alternativa disponible (zsh -> bash).
        let shell = shell
            .or_else(|| std::env::var("SHELL").ok())
            .unwrap_or_else(|| "/bin/bash".to_string());
        let shell = if shell.contains("fish") {
            ["/usr/bin/zsh", "/bin/zsh", "/usr/bin/bash", "/bin/bash"]
                .iter()
                .find(|p| std::path::Path::new(p).exists())
                .map(|p| p.to_string())
                .unwrap_or_else(|| "/bin/bash".to_string())
        } else {
            shell
        };

        let mut cmd = CommandBuilder::new(&shell);
        // Login + interactiva para que se carguen perfiles del usuario.
        cmd.arg("-l");
        // No heredamos el directorio desde el que se lanzó la aplicación:
        // una terminal nueva debe comenzar siempre en HOME.
        let start_dir = cwd
            .or_else(|| std::env::var("HOME").ok())
            .unwrap_or_else(|| "/".to_string());
        cmd.cwd(start_dir);
        // Pista para programas: terminal con color real.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("writer: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("reader: {e}"))?;

        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), Session { pair, writer });

        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        // --- Hilo lector: PTY -> canal ---
        // Al cerrarse el PTY (EOF o kill()), tx se destruye y el emisor sale.
        std::thread::spawn(move || {
            let mut tmp = [0u8; 8192];
            loop {
                match reader.read(&mut tmp) {
                    Ok(0) => break, // EOF: la shell terminó
                    Ok(n) => {
                        if tx.send(tmp[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // --- Hilo emisor: canal -> frontend, con latencia adaptativa ---
        std::thread::spawn(move || {
            let mut buf: Vec<u8> = Vec::with_capacity(8192);
            // Arranca "vencido" para que el primer chunk salga al instante.
            let mut last_emit = Instant::now() - FRAME;
            loop {
                // Reposo: duerme bloqueado hasta que llegue algo (0 wakeups).
                match rx.recv() {
                    Ok(chunk) => buf.extend_from_slice(&chunk),
                    Err(_) => break, // canal cerrado: el PTY terminó
                }
                // Si hace >=16 ms del último volcado (eco de tecla tras
                // reposo), emitimos YA. Si hay flujo continuo, esperamos el
                // resto de la ventana acumulando lo que siga llegando.
                let since = last_emit.elapsed();
                if since < FRAME {
                    std::thread::sleep(FRAME - since);
                }
                while let Ok(chunk) = rx.try_recv() {
                    buf.extend_from_slice(&chunk);
                }
                emit_chunk(&app, &target, &id, &mut buf, false);
                last_emit = Instant::now();
            }
            // Volcado final pendiente (sin perder las últimas líneas) + exit.
            emit_chunk(&app, &target, &id, &mut buf, true);
            let _ = app.emit_to(target.as_str(), "pty://exit", id.clone());
            let _ = child.wait();
        });

        Ok(())
    }

    /// Escribe la entrada del usuario (teclas) hacia la shell.
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(id).ok_or("sesión inexistente")?;
        s.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    }

    /// Reajusta el tamaño del PTY cuando la ventana/panel cambia de dimensiones.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(id).ok_or("sesión inexistente")?;
        s.pair
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    /// Cierra y elimina una sesión PTY.
    pub fn kill(&self, id: &str) {
        self.sessions.lock().unwrap().remove(id);
    }
}
