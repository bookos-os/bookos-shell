//! Puente PTY <-> Frontend.
//!
//! Cada terminal (pestaña o panel dividido) tiene su propio PTY con un `id`
//! único. El flujo de la shell se acumula en un buffer y se vuelca al frontend
//! cada ~16 ms (60 fps) para no saturar el WebView con miles de eventos.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Abre un nuevo PTY ejecutando la shell de login del usuario.
    pub fn spawn(
        &self,
        app: AppHandle,
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
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }
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

        // --- Hilo lector con buffering a 60 fps ---
        let app_read = app.clone();
        let read_id = id.clone();
        std::thread::spawn(move || {
            let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(8192)));
            // Flag de cierre explícito: un byte NUL legítimo en la salida no
            // debe confundirse con el fin del PTY, y el último volcado pendiente
            // debe emitirse antes de terminar (sin perder las últimas líneas).
            let done = Arc::new(std::sync::atomic::AtomicBool::new(false));

            // Hilo de volcado: cada 16 ms manda lo acumulado en un solo evento.
            let flush_buf = buffer.clone();
            let flush_app = app_read.clone();
            let flush_id = read_id.clone();
            let flush_done = done.clone();
            let flusher = std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(16));
                let finished = flush_done.load(std::sync::atomic::Ordering::Acquire);
                let mut chunk = std::mem::take(&mut *flush_buf.lock().unwrap());
                if !chunk.is_empty() {
                    // Un carácter UTF-8 multibyte partido por el corte de 16 ms
                    // no debe emitirse como '�': la cola incompleta vuelve al
                    // frente del buffer y sale entera en el siguiente volcado.
                    if !finished {
                        if let Err(e) = std::str::from_utf8(&chunk) {
                            if e.error_len().is_none() {
                                let tail = chunk.split_off(e.valid_up_to());
                                let mut b = flush_buf.lock().unwrap();
                                let mut merged = tail;
                                merged.extend_from_slice(&b);
                                *b = merged;
                            }
                        }
                    }
                    if chunk.is_empty() {
                        continue;
                    }
                    let data = String::from_utf8_lossy(&chunk).to_string();
                    let _ = flush_app.emit(
                        "pty://data",
                        PtyOutput {
                            id: flush_id.clone(),
                            data,
                        },
                    );
                }
                if finished {
                    break;
                }
            });

            let mut tmp = [0u8; 8192];
            loop {
                match reader.read(&mut tmp) {
                    Ok(0) => break,             // EOF: la shell terminó
                    Ok(n) => buffer.lock().unwrap().extend_from_slice(&tmp[..n]),
                    Err(_) => break,
                }
            }

            // Señalamos cierre al flusher (vuelca lo pendiente y termina).
            done.store(true, std::sync::atomic::Ordering::Release);
            let _ = flusher.join();
            let _ = app_read.emit("pty://exit", read_id.clone());
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
