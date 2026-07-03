#!/bin/sh
# Post-instalación de BookOS Shell.
# Activa el feedback de asteriscos al teclear la contraseña de sudo
# (estilo macOS): [sudo] contraseña para usuario: ******
set -e

SUDOERS_FILE="/etc/sudoers.d/pwfeedback"

# Solo si aún no existe (no pisar config del usuario).
if [ ! -f "$SUDOERS_FILE" ]; then
    echo 'Defaults pwfeedback' > "$SUDOERS_FILE"
    chmod 0440 "$SUDOERS_FILE"

    # Validar: si queda inválido, borrarlo para NO romper sudo.
    if command -v visudo >/dev/null 2>&1; then
        if ! visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
            rm -f "$SUDOERS_FILE"
        fi
    fi
fi

exit 0
