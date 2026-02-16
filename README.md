# Drag To Close Overview

GNOME Shell extension for closing windows in the app overview using a touch gesture:

- Touch a window preview in the overview
- Drag it downward
- Release it at the bottom edge of the screen

The window will then be closed.

## Installation (manual)

1. Create the folder:
   - `~/.local/share/gnome-shell/extensions/drag-to-close-overview@ohrix.github.com`
2. Copy the files `metadata.json` and `extension.js` into this folder.
3. Reload GNOME Shell:
   - Wayland: log out and log back in
4. Enable the extension:
   - for example with `gnome-extensions enable drag-to-close-overview@ohrix.github.com`

## Compatibility

- Tested only under Wayland.
