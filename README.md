/*  Gallery Download Script for event galleries of LA (vanilla JS)
 * tested with Google Chronme (Desktop)
 * 
 * HOW TO USE:
 * 1. Open the developer console
 * Press F12 and select the Console tab, or
 * Ctrl + Shift + J (Windows/Linux): This shortcut directly opens the Console panel within the DevTools. 
 * Command + Option + J (macOS): This shortcut directly opens the Console panel within the DevTools. 
 *
 * 2. Copy this whole(!) code into the browser console on a gallery page (select whole code with Ctrl+A, then Ctrl+C to copy and Ctrl+P to paste into console input. on Mac it is Cmd not Ctrl).
 *
 * 
 * What it does:
 * 
 * - Injects a small control panel below `.modal-footer`.
 * - Automates: NEXT -> wait for image change -> DOWNLOAD -> repeat.
 * - Skips images already present in IndexedDB ("GalleryDownloadScript").
 * - Shows a History modal with per-item delete (red X) and "Delete all history entries".
 * - Supports pause/resume via Start/Stop buttons.
 * - Live interval: reads the current dropdown value each time (changes apply immediately).
 * - Status line shows filename; shows orange "(SKIPPED)" when skipping.
 *
 * NOTE:
 * - Pure DOM APIs; no `$` to avoid jQuery version conflicts.
 * - All UI text is English.
*/
