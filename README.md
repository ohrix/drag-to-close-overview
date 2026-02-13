
# Drag To Close In Overview

GNOME-Shell-Extension zum Schließen von Fenstern im App-Overview per Touch-Geste:

- Fenster-Vorschau im Overview berühren
- Nach unten ziehen
- Am unteren Bildschirmrand loslassen

Dann wird das Fenster geschlossen.

## Installation (manuell)

1. Ordner anlegen:
   - `~/.local/share/gnome-shell/extensions/drag-to-close-overview@felix.local`
2. Dateien `metadata.json` und `extension.js` in diesen Ordner kopieren.
3. GNOME Shell neu laden:
   - Wayland: ab- und wieder anmelden
   - X11: `Alt` + `F2`, dann `r` und Enter
4. Extension aktivieren:
   - z. B. mit `gnome-extensions enable drag-to-close-overview@felix.local`
