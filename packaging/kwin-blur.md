# Blur de fondo (KWin)

La ventana de BookOS Shell es **sin marco y transparente**, con glassmorphism en
CSS. El `backdrop-filter` de CSS solo difumina el contenido *dentro* de la
página; para difuminar el **escritorio detrás** de la ventana hace falta que el
compositor (KWin) aplique su efecto de _blur_ a esta ventana concreta.

Tauri no expone el protocolo `org_kde_kwin_blur`, así que se activa con una
**regla de ventana de KWin** por `app_id` (`com.bookos.shell`).

## Instalación automática

Copia el bloque siguiente al final de `~/.config/kwinrulesrc` (creando una
entrada nueva con su número de índice) o impórtalo desde
**Preferencias del Sistema → Gestión de ventanas → Reglas de ventana →
Importar**.

```ini
[com.bookos.shell-blur]
Description=BookOS Shell — blur
wmclass=com.bookos.shell
wmclassmatch=1
types=1
# Activa el desenfoque de fondo del compositor para esta ventana
blur=true
blurrule=2
```

Después recarga las reglas:

```sh
qdbus org.kde.KWin /KWin reconfigure
```

> El efecto **Blur** debe estar habilitado en
> *Preferencias del Sistema → Efectos de escritorio → Desenfoque*.
