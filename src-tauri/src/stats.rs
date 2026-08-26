//! Estadísticas del sistema para la barra tipo "neofetch":
//! CPU, GPU, memoria, swap, disco, IP local + interfaz y batería.
//!
//! Se recogen bajo demanda desde el frontend (`get_stats`), que las refresca
//! en un intervalo. Usamos `sysinfo` para lo portable y `sysfs` para lo que
//! es específico de Linux (batería, nombre de GPU).

use std::fs;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use sysinfo::{Disks, Networks, System};

/// Estado persistente: `System` necesita dos lecturas para calcular el % de CPU.
static SYS: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));

#[derive(Serialize, Default)]
pub struct Stats {
    cpu_model: String,
    cpu_usage: f32, // %
    gpu_model: String,
    mem_used: u64,  // bytes
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    disk_used: u64,
    disk_total: u64,
    disk_fs: String,
    ip: String,
    iface: String,
    battery_percent: Option<u8>,
    battery_state: Option<String>, // Charging / Discharging / Full
}

pub fn collect() -> Stats {
    let mut sys = SYS.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let mut s = Stats::default();

    // CPU
    s.cpu_usage = sys.global_cpu_usage();
    s.cpu_model = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();

    // Memoria y swap
    s.mem_used = sys.used_memory();
    s.mem_total = sys.total_memory();
    s.swap_used = sys.used_swap();
    s.swap_total = sys.total_swap();

    // Disco raíz "/"
    let disks = Disks::new_with_refreshed_list();
    if let Some(root) = disks.iter().find(|d| d.mount_point() == std::path::Path::new("/")) {
        s.disk_total = root.total_space();
        s.disk_used = root.total_space().saturating_sub(root.available_space());
        s.disk_fs = root.file_system().to_string_lossy().to_string();
    }

    // Red: preferimos interfaces físicas (wlan/eth/wifi) y descartamos
    // loopback y virtuales/VPN (tailscale, docker, veth, br, tun, vpn, wg...).
    let networks = Networks::new_with_refreshed_list();
    let mut best: Option<(u8, String, String)> = None; // (prioridad, iface, ip)
    for (name, data) in &networks {
        if name == "lo" {
            continue;
        }
        let Some(ipn) = data.ip_networks().iter().find(|n| n.addr.is_ipv4()) else {
            continue;
        };
        let prio = iface_priority(name);
        let cand = (
            prio,
            name.clone(),
            format!("{}/{}", ipn.addr, ipn.prefix),
        );
        if best.as_ref().map_or(true, |b| cand.0 > b.0) {
            best = Some(cand);
        }
    }
    if let Some((_, iface, ip)) = best {
        s.iface = iface;
        s.ip = ip;
    }

    // GPU y batería desde sysfs (Linux puro).
    s.gpu_model = gpu_model();
    let (pct, state) = battery();
    s.battery_percent = pct;
    s.battery_state = state;

    s
}

/// Puntúa una interfaz de red: más alta = más "real" (física). Las VPN y
/// puentes virtuales quedan al fondo para no eclipsar la wifi/ethernet.
fn iface_priority(name: &str) -> u8 {
    let n = name.to_lowercase();
    // Virtuales / VPN / contenedores: prioridad mínima.
    const VIRTUAL: [&str; 8] = [
        "tailscale", "docker", "veth", "br-", "virbr", "tun", "wg", "vpn",
    ];
    if VIRTUAL.iter().any(|v| n.starts_with(v) || n.contains(v)) {
        return 0;
    }
    if n.starts_with("wl") || n.starts_with("wlan") || n.contains("wifi") {
        return 3; // Wi-Fi
    }
    if n.starts_with("en") || n.starts_with("eth") {
        return 2; // Ethernet
    }
    1 // resto (desconocido pero no claramente virtual)
}

/// Intenta dar un nombre legible de GPU a partir del driver DRM.
fn gpu_model() -> String {
    // Mapa de drivers comunes -> etiqueta amigable.
    let mut driver = String::new();
    if let Ok(uevent) = fs::read_to_string("/sys/class/drm/card0/device/uevent") {
        for line in uevent.lines() {
            if let Some(d) = line.strip_prefix("DRIVER=") {
                driver = d.to_string();
            }
        }
    }
    match driver.as_str() {
        "xe" | "i915" => "Intel Graphics".to_string(),
        "amdgpu" | "radeon" => "AMD Radeon".to_string(),
        "nvidia" | "nouveau" => "NVIDIA".to_string(),
        "" => "GPU".to_string(),
        other => other.to_string(),
    }
}

/// Lee porcentaje y estado de la batería desde /sys/class/power_supply.
fn battery() -> (Option<u8>, Option<String>) {
    let base = "/sys/class/power_supply";
    let entries = match fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return (None, None),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let typ = fs::read_to_string(path.join("type")).unwrap_or_default();
        if typ.trim() != "Battery" {
            continue;
        }
        let pct = fs::read_to_string(path.join("capacity"))
            .ok()
            .and_then(|c| c.trim().parse::<u8>().ok());
        let state = fs::read_to_string(path.join("status"))
            .ok()
            .map(|s| s.trim().to_string());
        return (pct, state);
    }
    (None, None)
}

/// Lista las familias de fuentes instaladas en el sistema (para el selector
/// de tipografía de los perfiles). Devuelve nombres únicos y ordenados.
pub fn list_fonts() -> Vec<String> {
    let out = std::process::Command::new("fc-list")
        .args(["--format", "%{family[0]}\\n"])
        .output();
    let mut fonts: Vec<String> = match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => vec!["monospace".to_string()],
    };
    fonts.sort();
    fonts.dedup();
    fonts
}
