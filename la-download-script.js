(() => {
  /**
   * Gallery Download Script for event galleries of CoM and others on skald website (vanilla JS)
   * tested with Google Chronme (Desktop)
   * 
   * HOW TO USE:
   * 1. Open the developer console
   * Press F12 and select the Console tab, or
   * Ctrl + Shift + J (Windows/Linux): This shortcut directly opens the Console panel within the DevTools. 
   * Command + Option + J (macOS): This shortcut directly opens the Console panel within the DevTools. 
   *
   * 2. Copy this whole(including this comment and 1 line!) code into the browser console on a gallery page (select whole code with Ctrl+A, then Ctrl+C to copy and Ctrl+P to paste into console input. on Mac it is Cmd not Ctrl).
   * 3. Press Enter to execute
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

  // ---------- Configuration & DOM helpers ----------
  const UI_IDS = {
    panel: 'gds-panel',
    title: 'gds-title',
    interval: 'gds-interval',
    start: 'gds-start',
    stop: 'gds-stop',
    history: 'gds-history',
    histModal: 'gds-hist-modal',
    histContent: 'gds-hist-content',
    histClose: 'gds-hist-close',
    histFlush: 'gds-hist-flush',
    status: 'gds-status',
    histInfo: 'gds-hist-info',
    counters: 'gds-counters'
  };

  const DB_NAME = 'GalleryDownloadScript';
  const STORE = 'images';

  /** Shorthand for querySelector */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  /** Element existence guard */
  function elExists(el) { return el && el instanceof Element; }

  const modalFooter = qs('.modal-footer');
  const modalBody = qs('.modal-body.gallery-modal-body');

  if (!elExists(modalFooter) || !elExists(modalBody)) {
    console.error('GDS: Required elements not found (.modal-footer / .modal-body.gallery-modal-body).');
    alert('GDS: Missing .modal-footer or .modal-body.gallery-modal-body.');
    return;
  }

  /** Always fetch fresh references (page may re-render) */
  const getNextBtn = () => document.getElementById('next');
  const getDownloadBtn = () => document.getElementById('download');
  const getModalImg = () => modalBody.querySelector('img');

  /** Current src of the modal image */
  function getImgSrc(imgEl) {
    if (!imgEl) return null;
    return imgEl.getAttribute('src') || imgEl.currentSrc || null;
  }

  /** Friendly filename for status display (DB still stores full src) */
  function fileNameFromSrc(src) {
    if (!src) return '(unknown)';
    const path = src.split('#')[0].split('?')[0];
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }

  /** Escape text for safe HTML injection in status/history */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'src' });
          os.createIndex('by_time', 'time');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      Promise.resolve(fn(store))
        .then((res) => { tx.oncomplete = () => resolve(res); tx.onerror = () => reject(tx.error); })
        .catch(reject);
    });
  }

  async function dbHas(src) {
    if (!src) return false;
    return await withStore('readonly', (store) => new Promise((resolve) => {
      const r = store.get(src);
      r.onsuccess = () => resolve(!!r.result);
      r.onerror = () => resolve(false);
    }));
  }

  async function dbPut(src) {
    if (!src) return;
    const rec = { src, time: Date.now() };
    return await withStore('readwrite', (store) => store.put(rec));
  }

  async function dbDelete(src) {
    if (!src) return;
    return await withStore('readwrite', (store) => store.delete(src));
  }

  async function dbAll() {
    return await withStore('readonly', (store) => new Promise((resolve) => {
      const out = [];
      const req = store.openCursor(null, 'prev'); // newest first
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); } else resolve(out);
      };
    }));
  }

  async function dbClear() {
    return await withStore('readwrite', (store) => store.clear());
  }

  // ---------- UI injection ----------
  if (!document.getElementById(UI_IDS.panel)) {
    const panel = document.createElement('div');
    panel.id = UI_IDS.panel;
    panel.style.cssText = `
      width:100%; display:flex; flex-direction:column; align-items:center; gap:.5rem;
      margin-top:.75rem; padding:.75rem; border:1px dashed #999; border-radius:8px; background:#fafafa;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    `;
    panel.innerHTML = `
      <div id="${UI_IDS.title}" style="font-weight:700; font-size:14px; text-transform:uppercase;">download script</div>
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:.5rem;">
        <label for="${UI_IDS.interval}" style="font-size:13px;">ms interval:</label>
        <select id="${UI_IDS.interval}" style="padding:.25rem .5rem; font-size:13px; border-radius:6px; border:1px solid #bbb;">
          <option value="250">250</option>
          <option value="500" selected>500</option>
          <option value="750">750</option>
          <option value="1000">1000</option>
        </select>
        <button id="${UI_IDS.start}" style="padding:.4rem .7rem; border:1px solid #888; border-radius:6px; cursor:pointer; background:#111; color:#fff;">
          Start download script
        </button>
        <button id="${UI_IDS.stop}" style="padding:.4rem .7rem; border:1px solid #888; border-radius:6px; cursor:pointer; background:#fff;">
          Stop download script
        </button>
        <button id="${UI_IDS.history}" style="padding:.4rem .7rem; border:1px solid #888; border-radius:6px; cursor:pointer; background:#fff;">
          Show script history
        </button>
      </div>
      <div id="${UI_IDS.counters}" style="font-size:12px; color:#333;">Saved: 0 | Skipped: 0</div>
      <div id="${UI_IDS.status}" style="font-size:12px; color:#444;"></div>
    `;
    modalFooter.appendChild(panel);
  }

  if (!document.getElementById(UI_IDS.histModal)) {
    const m = document.createElement('div');
    m.id = UI_IDS.histModal;
    m.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; z-index:99999;
      align-items:center; justify-content:center;
    `;
    m.innerHTML = `
      <div style="background:#fff; width:min(800px, 92vw); max-height:80vh; overflow:auto; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.3);">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:.8rem 1rem; border-bottom:1px solid #eee;">
          <div style="font-weight:700;">Download Script – History</div>
          <div style="display:flex; gap:.5rem; align-items:center;">
            <button id="${UI_IDS.histFlush}" style="padding:.35rem .6rem; border:1px solid #c33; color:#c33; border-radius:6px; background:#fff;">Delete all history entries</button>
            <button id="${UI_IDS.histClose}" style="padding:.35rem .6rem; border:1px solid #888; border-radius:6px; background:#fff;">Close</button>
          </div>
        </div>
        <div id="${UI_IDS.histContent}" style="padding:.8rem 1rem; font-size:13px;"></div>
      </div>
    `;
    document.body.appendChild(m);
  }

  // ---------- UI element references ----------
  const intervalSel = document.getElementById(UI_IDS.interval);
  const startBtn = document.getElementById(UI_IDS.start);
  const stopBtn = document.getElementById(UI_IDS.stop);
  const historyBtn = document.getElementById(UI_IDS.history);
  const countersEl = document.getElementById(UI_IDS.counters);
  const statusEl = document.getElementById(UI_IDS.status);
  const histModal = document.getElementById(UI_IDS.histModal);
  const histContent = document.getElementById(UI_IDS.histContent);
  const histClose = document.getElementById(UI_IDS.histClose);
  const histFlush = document.getElementById(UI_IDS.histFlush);

  // ---------- Status & helpers ----------
  function setStatusText(msg) { statusEl.textContent = msg || ''; }
  function setStatusHTML(html) { statusEl.innerHTML = html || ''; }
  function updateCounters(saved, skipped) {
    countersEl.textContent = `Saved: ${saved} | Skipped: ${skipped}`;
  }
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  /** Get the current interval in ms from the dropdown (live) */
  function getIntervalMs() {
    const v = parseInt(intervalSel.value, 10);
    return Number.isFinite(v) ? v : 500;
  }

  // ---------- State ----------
  let running = false;
  let paused = false;
  let savedCount = 0;
  let skippedCount = 0;

  async function waitWhilePaused() {
    while (paused) {
      setStatusText('Paused. Press “Resume download script”.');
      await sleep(150);
    }
  }

  // ---------- Image change detection ----------
  function waitForImgChange(containerEl, prevSrc, timeoutMsBase = 6000) {
    // Timeout scales a bit with the chosen interval (for slow galleries)
    const timeoutMs = Math.max(timeoutMsBase, getIntervalMs() * 6);

    return new Promise((resolve, reject) => {
      let done = false;

      const finish = (ok, v) => {
        if (done) return;
        done = true;
        try { mo.disconnect(); } catch {}
        clearTimeout(timer);
        ok ? resolve(v) : reject(v);
      };

      const check = () => {
        const img = getModalImg();
        const current = getImgSrc(img);
        if (current && current !== prevSrc) return finish(true, current);
      };

      const mo = new MutationObserver(() => check());
      mo.observe(containerEl, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['src', 'srcset']
      });

      const timer = setTimeout(() => finish(false, new Error('Timed out waiting for new image')), timeoutMs);

      (async function poll() {
        while (!done) {
          await sleep(100);
          check();
        }
      })();

      check();
    });
  }

  // ---------- Download completion heuristic ----------
  async function waitForDownloadCompletion() {
    // Keep checking until the download button looks enabled again or a time limit passes.
    const maxWait = Math.max(3000, getIntervalMs() * 4);
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const btn = getDownloadBtn();
      if (!btn) break; // if re-rendered, don't block forever
      const disabled = btn.disabled || btn.getAttribute('disabled') !== null ||
                       window.getComputedStyle(btn).pointerEvents === 'none';
      if (!disabled) return true;
      await sleep(60);
    }
    return true;
  }

  // ---------- NEXT button state ----------
  function isNextDisabled() {
    const btn = getNextBtn();
    return !btn || btn.disabled || btn.getAttribute('disabled') !== null || btn.matches(':disabled');
  }

  // ---------- History rendering (with per-item delete X) ----------
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
  }

  async function renderHistory() {
    const items = await dbAll();

    const infoHTML = `
      <div id="${UI_IDS.histInfo}" style="margin:.25rem 0 .75rem; padding:.5rem .6rem; background:#f8f8f8; border:1px solid #eee; border-radius:6px; color:#333;">
        <b>Note:</b> Images listed here will be <b>skipped automatically</b> by the script.
      </div>
    `;

    if (!items.length) {
      histContent.innerHTML = infoHTML + `<div style="color:#666;">No entries.</div>`;
      return;
    }

    const rows = items.map((r, i) => {
      const escSrc = escapeHtml(r.src);
      return `
        <div class="gds-row" style="display:grid; grid-template-columns: 2.5rem 1fr auto auto; gap:.5rem; align-items:center; padding:.35rem .25rem; border-bottom:1px solid #f1f1f1;">
          <div style="color:#999;">#${i + 1}</div>
          <div style="overflow:auto;"><code title="${escSrc}" style="white-space:nowrap;">${escSrc}</code></div>
          <div style="color:#666;">${fmtTime(r.time)}</div>
          <button class="gds-del" data-src="${escSrc}" title="Delete this entry"
            style="padding:.2rem .5rem; border:1px solid #b91c1c; color:#fff; background:#ef4444; border-radius:6px; cursor:pointer; font-size:12px;">✕</button>
        </div>
      `;
    }).join('');

    histContent.innerHTML = `
      ${infoHTML}
      <div style="margin-bottom:.5rem; color:#333;">Total: <b>${items.length}</b></div>
      ${rows}
    `;
  }

  // Delegate click on per-item delete buttons inside the history content
  histContent?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button.gds-del');
    if (!btn) return;
    const src = btn.getAttribute('data-src');
    if (!src) return;
    // Confirm delete of a single entry
    const yes = confirm('Delete this history entry? The image may be downloaded again next time.');
    if (!yes) return;
    await dbDelete(src);
    await renderHistory();
  });

  // ---------- Main loop ----------
  async function runLoop() {
    running = true;
    paused = false;

    // Reset counters on each fresh run (keeps semantics simple)
    savedCount = 0;
    skippedCount = 0;
    updateCounters(savedCount, skippedCount);

    // UI: disable Start during run; enable Stop
    startBtn.disabled = true;
    stopBtn.disabled = false;
    startBtn.textContent = 'Start download script';

    try {
      let cycle = 0;

      while (!isNextDisabled()) {
        // Honor pause
        await waitWhilePaused();
        cycle++;

        // Remember current image src (fresh lookup every cycle)
        const prevSrc = getImgSrc(getModalImg());

        // Click NEXT (fresh button each time)
        const nb = getNextBtn();
        if (!nb) break;
        nb.click();

        // Wait for the image to change (node or src); timeout scales with current interval
        let newSrc;
        try {
          newSrc = await waitForImgChange(modalBody, prevSrc);
        } catch {
          // If we time out, try to proceed with the currently visible image
          newSrc = getImgSrc(getModalImg()) || prevSrc;
        }

        const displayName = escapeHtml(fileNameFromSrc(newSrc));

        // Pause check again before DB work
        await waitWhilePaused();

        // If this image was already downloaded -> show SKIPPED and wait live interval
        if (await dbHas(newSrc)) {
          skippedCount++;
          updateCounters(savedCount, skippedCount);
          setStatusHTML(
            `Image ${cycle}: <span title="${escapeHtml(newSrc)}">${displayName}</span> ` +
            `<span style="color:#d97706; font-weight:600;">(SKIPPED)</span>`
          );
          // Wait the currently selected interval (read live)
          const end = Date.now() + getIntervalMs();
          while (Date.now() < end) { await waitWhilePaused(); await sleep(50); }
          continue;
        }

        // Not in DB: trigger download
        setStatusHTML(`Image ${cycle}: <span title="${escapeHtml(newSrc)}">${displayName}</span>`);
        const dlb = getDownloadBtn();
        if (dlb) dlb.click();

        // Wait until download button looks ready again (heuristic uses live interval)
        await waitForDownloadCompletion();

        // Record in DB and update counters
        await dbPut(newSrc);
        savedCount++;
        updateCounters(savedCount, skippedCount);

        // Wait current interval (read live), pause-aware
        const end = Date.now() + getIntervalMs();
        while (Date.now() < end) { await waitWhilePaused(); await sleep(50); }
      }

      setStatusText('Completed: #next is no longer clickable.');
    } catch (err) {
      console.error('GDS error:', err);
      setStatusText('Error: ' + (err && err.message ? err.message : String(err)));
    } finally {
      running = false;
      startBtn.disabled = false;
      startBtn.textContent = 'Start download script';
      stopBtn.disabled = true;
    }
  }

  // ---------- Event wiring ----------
  startBtn.addEventListener('click', () => {
    // Resume if paused; otherwise start a new loop
    if (running && paused) {
      paused = false;
      startBtn.disabled = true;
      startBtn.textContent = 'Start download script';
      stopBtn.disabled = false;
      setStatusText('Resumed…');
      return;
    }
    if (running && !paused) return; // already running
    setStatusText('Running…');
    runLoop();
  });

  stopBtn.addEventListener('click', () => {
    if (!running) return;
    paused = true;
    startBtn.disabled = false;
    startBtn.textContent = 'Resume download script';
    stopBtn.disabled = true;
    setStatusText('Paused. Press “Resume download script” to continue.');
  });

  historyBtn.addEventListener('click', async () => {
    await renderHistory();
    histModal.style.display = 'flex';
  });
  histClose.addEventListener('click', () => { histModal.style.display = 'none'; });

  histFlush.addEventListener('click', async () => {
    if (!confirm('Really delete ALL history entries?')) return;
    await dbClear();
    await renderHistory();
  });

  // ---------- Initial UI state ----------
  stopBtn.disabled = true;
  setStatusText('Ready. Choose interval, click “Start download script”. Use “Stop” to pause. Interval changes apply immediately.');
})();
