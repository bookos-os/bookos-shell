# BookOS Shell

Terminal nativa para **BookOS**, construida con [Tauri 2](https://tauri.app/),
[xterm.js](https://xtermjs.org/) (WebGL) y [`portable-pty`](https://crates.io/crates/portable-pty).
Ligera, rápida y totalmente integrada con el escritorio: cambia entre modo claro
y oscuro de forma automática junto con KDE Plasma, respetando la estética de las
apps de BookOS (estilo Apple/macOS).

---

## ✨ Características

- **PTY nativo de Linux** vía `portable-pty`, con _buffering_ a 60 fps
  (Rust agrupa la salida cada 16 ms antes de mandarla al frontend) para que el
  scroll de grandes volúmenes de texto no produzca _lag_.
- **Render por GPU** con el addon WebGL de xterm.js.
- **Tema automático**: un listener D-Bus (`org.freedesktop.appearance`) detecta
  cuándo cambias el tema del sistema y la terminal alterna claro/oscuro con una
  transición suave. El texto de la terminal cambia de paleta al instante.
- **Paleta BookOS** extraída de los esquemas de color del sistema (claro y oscuro).
- **Perfiles** personalizables: tipografía (de las fuentes instaladas en tu
  sistema, vía `fc-list`), tamaño, shell y activación automática al cambiar a
  modo claro u oscuro.
- **Múltiples ventanas** (como Notepad), **pestañas** y **vista dividida**
  (izquierda/derecha o arriba/abajo).
- **Bilingüe** (español / inglés) con i18n en todos los menús, submenús,
  botones y el panel de sistema.
- **Panel de sistema** estilo _neofetch_: CPU, GPU, Memoria, Swap, Disco,
  IP local, interfaz de red y batería.

---

## 🧱 Stack

| Capa        | Tecnología                                            |
| ----------- | ----------------------------------------------------- |
| Frontend    | HTML + CSS + JS (Vite), xterm.js + addon WebGL        |
| Backend     | Rust (Tauri 2)                                        |
| PTY         | `portable-pty`                                        |
| Stats       | `sysinfo` + lectura directa de `sysfs`                |
| Tema        | `zbus` (D-Bus, portal `org.freedesktop.appearance`)   |

---

## 📁 Estructura

```
bookos-shell/
├── package.json, vite.config.js
├── src/                       # Frontend
│   ├── index.html             # titlebar, menús, pestañas, panel sistema, modal perfiles
│   ├── css/app.css            # temas BookOS claro/oscuro + glassmorphism
│   └── js/
│       ├── main.js            # orquestador (pestañas, divisiones, atajos, eventos)
│       ├── term.js            # xterm.js + WebGL + paletas BookOS
│       ├── profiles.js        # perfiles (CRUD + activación por tema)
│       └── i18n/index.js      # diccionarios es / en
└── src-tauri/                 # Backend Rust
    ├── src/pty.rs             # puente PTY ↔ frontend con buffering 60 fps
    ├── src/theme.rs           # listener de tema D-Bus
    ├── src/stats.rs           # estadísticas del sistema + listado de fuentes
    ├── src/lib.rs             # comandos Tauri + ventanas nuevas
    └── tauri.conf.json
```

---

## 🚀 Requisitos

- **Rust** (toolchain estable) y **Cargo**
- **Node.js** ≥ 18 y **npm**
- Dependencias de sistema de Tauri en Linux:
  `webkit2gtk-4.1`, `gtk3`, `libappindicator`/`ayatana`, `librsvg`
- La **CLI de Tauri**:
  ```sh
  cargo install tauri-cli --version "^2"
  ```

---

## 🛠️ Desarrollo

```sh
# Instalar dependencias del frontend
npm install

# Arrancar en modo desarrollo (Vite + Tauri con recarga en caliente)
npm run tauri dev
```

## 📦 Compilar para distribución

```sh
npm run tauri build
```

Genera paquetes `.deb`, `.rpm` y `.AppImage` en
`src-tauri/target/release/bundle/`.

> El icono incluido es un _placeholder_. Sustitúyelo por el de BookOS y regenera
> el set completo con:
> ```sh
> cargo tauri icon ruta/al/icono.png
> ```

---

## ⌨️ Atajos de teclado

| Acción                   | Atajo            |
| ------------------------ | ---------------- |
| Nueva pestaña            | `Ctrl+T`         |
| Nueva ventana            | `Ctrl+N`         |
| Cerrar pestaña           | `Ctrl+W`         |
| Dividir horizontal       | `Ctrl+Shift+D`   |
| Dividir vertical         | `Ctrl+Shift+E`   |
| Copiar                   | `Ctrl+Shift+C`   |
| Pegar                    | `Ctrl+Shift+V`   |
| Ampliar / reducir texto  | `Ctrl++` / `Ctrl+-` |
| Tamaño normal            | `Ctrl+0`         |

---

## 🎨 Perfiles

Desde **Perfiles → Gestionar perfiles…** puedes crear configuraciones con
nombre, tipografía, tamaño y shell propios, y elegir que un perfil se active
automáticamente al cambiar el sistema a **modo claro** o **modo oscuro**. Los
perfiles aparecen además como entradas directas en el menú _Perfiles_ para abrir
una pestaña nueva con ellos.

---

## 📄 Licencia

Parte del proyecto **BookOS**.
