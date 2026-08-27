/* ================= transcription (server-side via openai-whisper) ================= */
async function transcribeOnServer(filepath, language) {
  const res = await fetch('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath, language }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Transcription failed');
  return data;
}

/* ================= refs ================= */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const audio = document.getElementById('audio');
const playBtn = document.getElementById('playBtn');
const speedBtn = document.getElementById('speedBtn');
const langSelect = document.getElementById('langSelect');
const volSlider = document.getElementById('volSlider');
const volIcon = document.getElementById('volIcon');
const urlInput = document.getElementById('urlInput');
const urlBtn = document.getElementById('urlBtn');
const lyricsTrack = document.getElementById('lyricsTrack');
const lyricsViewport = document.getElementById('lyricsViewport');
const controlsGroup = document.getElementById('controlsGroup');
const scrubTrack = document.getElementById('scrubTrack');
const scrubFill = document.getElementById('scrubFill');
const scrubKnob = document.getElementById('scrubKnob');
const curTimeEl = document.getElementById('curTime');
const durTimeEl = document.getElementById('durTime');
const statusArea = document.getElementById('statusArea');
const toolBtns = document.getElementById('toolBtns');
const officialRow = document.getElementById('officialRow');
const artistInput = document.getElementById('artistInput');
const titleInput = document.getElementById('titleInput');
const officialBtn = document.getElementById('officialBtn');
const exportLrc = document.getElementById('exportLrc');
const exportSrt = document.getElementById('exportSrt');
const uploadOverlay = document.getElementById('uploadOverlay');
const spotlightEl = document.getElementById('spotlight');
const mouseGlowEl = document.getElementById('mouseGlow');
const fsOverlay = document.getElementById('fsOverlay');
const fsLyrics = document.getElementById('fsLyrics');
const fsPlayBtn = document.getElementById('fsPlayBtn');
const fsExit = document.getElementById('fsExit');
const fsScrubTrack = document.getElementById('fsScrubTrack');
const fsScrubFill = document.getElementById('fsScrubFill');
const fsCurTime = document.getElementById('fsCurTime');
const fsDurTime = document.getElementById('fsDurTime');
const kbdHint = document.getElementById('kbdHint');
const introEl = document.getElementById('intro');

/* ================= state ================= */
let words = [];
let lines = [];
let timedLines = [];
let activeLineIndex = -1;
let lyricsMode = 'whisper';
let whisperWords = [];
const WORD_LEAD_S = 0;
let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
let speedIdx = 2;
let isFullscreen = false;
let spotlightX = window.innerWidth / 2;
let spotlightY = window.innerHeight / 2;
let spotlightTargetX = spotlightX;
let spotlightTargetY = spotlightY;

/* ================= intro ================= */
setTimeout(() => introEl.classList.add('hide'), 3000);

/* ================= mouse glow ================= */
let mouseGX = -300, mouseGY = -300;
let mouseGXtarget = -300, mouseGYtarget = -300;
document.addEventListener('mousemove', e => {
  mouseGXtarget = e.clientX;
  mouseGYtarget = e.clientY;
  mouseGlowEl.classList.add('on');
  showControls();
});
(function animMouseGlow() {
  mouseGX += (mouseGXtarget - mouseGX) * 0.12;
  mouseGY += (mouseGYtarget - mouseGY) * 0.12;
  mouseGlowEl.style.left = mouseGX + 'px';
  mouseGlowEl.style.top = mouseGY + 'px';
  requestAnimationFrame(animMouseGlow);
})();

/* ================= spotlight — always centered in viewport ================= */
function centerSpotlight() {
  const vp = lyricsViewport;
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  spotlightTargetX = r.left + r.width / 2;
  spotlightTargetY = r.top + r.height / 2;
}
centerSpotlight();
window.addEventListener('resize', centerSpotlight);

(function animSpotlight() {
  spotlightX += (spotlightTargetX - spotlightX) * 0.15;
  spotlightY += (spotlightTargetY - spotlightY) * 0.15;
  spotlightEl.style.left = spotlightX + 'px';
  spotlightEl.style.top = spotlightY + 'px';
  requestAnimationFrame(animSpotlight);
})();

/* ================= controls auto-hide ================= */
let controlsTimer;
function showControls() {
  controlsGroup.classList.add('show');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (!audio.paused) controlsGroup.classList.remove('show');
  }, 3000);
}
controlsGroup.addEventListener('mouseenter', () => {
  clearTimeout(controlsTimer);
  controlsGroup.classList.add('show');
});
showControls();

/* ================= upload ================= */
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
urlBtn.addEventListener('click', () => handleUrl());
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUrl(); });

function hideUpload() { uploadOverlay.classList.add('hidden'); showControls(); }

async function handleUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  urlBtn.disabled = true; urlBtn.textContent = 'Fetching...';
  setStatus('Downloading from YouTube...', true);
  try {
    const res = await fetch('/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (data.error) { setStatus('Error: ' + data.error); urlBtn.disabled = false; urlBtn.textContent = 'Fetch'; return; }
    const meta = guessMeta(data.filename);
    artistInput.value = meta.artist; titleInput.value = meta.title;
    audio.src = '/uploads/' + data.id;
    hideUpload();
    setStatus('Transcribing on server...', true);
    const result = await transcribeOnServer(data.id, langSelect.value);
    words = result.words; whisperWords = [...words];
    setStatus('');
    buildTimedLines();
    renderLyrics(result.language);
    tryAutoOfficial();
  } catch (e) { setStatus('Error: ' + e.message); console.error(e); }
  finally { urlBtn.disabled = false; urlBtn.textContent = 'Fetch'; }
}

async function handleFile(file) {
  const meta = guessMeta(file.name);
  artistInput.value = meta.artist; titleInput.value = meta.title;
  setStatus('Uploading...', true);
  const fd = new FormData();
  fd.append('audio', file);
  try {
    const upRes = await fetch('/upload', { method: 'POST', body: fd });
    const upData = await upRes.json();
    if (upData.error) throw new Error(upData.error);
    audio.src = '/uploads/' + upData.id;
    hideUpload();
    setStatus('Transcribing on server...', true);
    const result = await transcribeOnServer(upData.id, langSelect.value);
    words = result.words; whisperWords = [...words];
    setStatus('');
    buildTimedLines();
    renderLyrics(result.language);
    tryAutoOfficial();
  } catch (e) {
    console.error(e);
    setStatus('Error: ' + e.message);
  }
}

function setStatus(msg, loading) {
  statusArea.innerHTML = msg ? '<div class="status ' + (loading ? 'loading' : '') + '">' + msg + '</div>' : '';
}

/* ================= lyrics building ================= */
function buildLines() {
  lines = [];
  let current = [];
  words.forEach((w, i) => {
    current.push(i);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 1;
    if (gap > 0.45 || !next || current.length >= 10) {
      lines.push({ wordIdxs: current.slice(), startTime: words[current[0]].start, endTime: words[current[current.length - 1]].end });
      current = [];
    }
  });
  if (current.length) {
    lines.push({ wordIdxs: current.slice(), startTime: words[current[0]].start, endTime: words[current[current.length - 1]].end });
  }
}

function buildTimedLines() {
  buildLines();
  timedLines = lines.map(line => ({ ...line, wordEls: [], el: null }));
}

function renderLyrics(detectedLang) {
  lyricsMode = 'whisper';
  if (!lines.length) { lyricsTrack.innerHTML = ''; return; }
  const isRtl = detectedLang === 'ar' || detectedLang === 'he' || detectedLang === 'fa' || detectedLang === 'ur';
  document.body.dir = isRtl ? 'rtl' : 'ltr';
  lyricsTrack.innerHTML = '';
  lines.forEach((line, li) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.line = li;
    const wordEls = [];
    line.wordIdxs.forEach(wi => {
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.idx = wi;
      span.textContent = words[wi].word;
      div.appendChild(span);
      wordEls.push(span);
    });
    div.addEventListener('click', () => { audio.currentTime = line.startTime; if (audio.paused) audio.play(); });
    lyricsTrack.appendChild(div);
    timedLines[li].el = div;
    timedLines[li].wordEls = wordEls;
  });
  activeLineIndex = -1;
  showToolBtns();
  syncFsLyricsIfOpen();
}

function showToolBtns() {
  if (words.length) toolBtns.style.display = 'flex';
  if (words.length) officialRow.style.display = 'flex';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ================= time ================= */
function fmt(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
function fmtSrt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}
function fmtLrc(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0') + '.' + String(Math.floor((s % 1) * 100)).padStart(2, '0');
}
function getLineText(lineIdx) {
  if (lines[lineIdx].text !== undefined) return lines[lineIdx].text;
  return lines[lineIdx].wordIdxs.map(wi => words[wi].word).join(' ');
}

/* ================= scrub ================= */
function updateScrubUI(t) {
  const pct = audio.duration ? (t / audio.duration * 100) : 0;
  scrubFill.style.width = pct + '%';
  scrubKnob.style.left = pct + '%';
  curTimeEl.textContent = fmt(t);
  fsCurTime.textContent = fmt(t);
  fsScrubFill.style.width = pct + '%';
}
scrubTrack.addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = scrubTrack.getBoundingClientRect();
  audio.currentTime = (e.clientX - rect.left) / rect.width * audio.duration;
});
fsScrubTrack.addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = fsScrubTrack.getBoundingClientRect();
  audio.currentTime = (e.clientX - rect.left) / rect.width * audio.duration;
});

/* ================= main update ================= */
function updateActiveLine(t) {
  if (!timedLines.length) return;

  let idx = timedLines.length - 1;
  for (let i = 0; i < timedLines.length; i++) {
    if (t < timedLines[i].startTime) { idx = Math.max(0, i - 1); break; }
    if (t >= timedLines[i].startTime && t <= timedLines[i].endTime) { idx = i; break; }
    if (i === timedLines.length - 1) { idx = i; }
  }

  if (idx !== activeLineIndex) {
    const prevIdx = activeLineIndex;
    activeLineIndex = idx;
    spotlightEl.classList.toggle('on', idx >= 0);
    timedLines.forEach((l, i) => {
      if (!l.el) return;
      l.el.classList.remove('active', 'near', 'past');
      if (i === idx) l.el.classList.add('active');
      else if (Math.abs(i - idx) <= 2) l.el.classList.add('near');
      else if (i < idx) l.el.classList.add('past');
    });
    const prevLine = prevIdx >= 0 ? timedLines[prevIdx] : null;
    const canScroll = !prevLine || t >= prevLine.endTime;
    if (canScroll && !isFullscreen && timedLines[idx] && timedLines[idx].el) {
      const el = timedLines[idx].el;
      const vpH = lyricsViewport.clientHeight;
      const offset = -el.offsetTop + vpH / 2 - el.clientHeight / 2;
      lyricsTrack.style.transform = 'translateY(' + offset + 'px)';
    }
  }

  const line = timedLines[idx];
  if (!line) return;
  const wt = t + WORD_LEAD_S;
  line.wordEls.forEach(wEl => {
    const wi = parseInt(wEl.dataset.idx);
    const w = words[wi];
    wEl.classList.remove('sung', 'lit');
    if (wt >= w.end) wEl.classList.add('sung');
    else if (wt >= w.start) wEl.classList.add('lit');
  });
}

let rafId = null;
function startWordLoop() {
  if (rafId) return;
  (function tick() {
    if (audio.paused || audio.ended) { rafId = null; return; }
    const t = audio.currentTime;
    updateActiveLine(t);
    updateScrubUI(t);
    syncFsLyrics();
    rafId = requestAnimationFrame(tick);
  })();
}
audio.addEventListener('play', startWordLoop);
audio.addEventListener('pause', () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } });
audio.addEventListener('ended', () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } });

audio.addEventListener('timeupdate', () => {
  updateScrubUI(audio.currentTime);
  if (audio.paused) updateActiveLine(audio.currentTime);
});

/* ================= audio controls ================= */
audio.addEventListener('loadedmetadata', () => {
  durTimeEl.textContent = fmt(audio.duration);
  fsDurTime.textContent = fmt(audio.duration);
});
playBtn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
audio.addEventListener('play', () => { playBtn.innerHTML = '&#10074;&#10074;'; fsPlayBtn.innerHTML = '&#10074;&#10074;'; });
audio.addEventListener('pause', () => { playBtn.innerHTML = '&#9654;'; fsPlayBtn.innerHTML = '&#9654;'; });
speedBtn.addEventListener('click', () => { speedIdx = (speedIdx + 1) % speeds.length; audio.playbackRate = speeds[speedIdx]; speedBtn.textContent = speeds[speedIdx] + 'x'; });
volSlider.addEventListener('input', () => {
  audio.volume = volSlider.value;
  volIcon.innerHTML = audio.volume == 0 ? '&#128264;' : audio.volume < 0.5 ? '&#128265;' : '&#128266;';
});
volIcon.addEventListener('click', () => {
  audio.muted = !audio.muted;
  volIcon.innerHTML = audio.muted ? '&#128264;' : '&#128266;';
});

/* ================= official lyrics ================= */
function guessMeta(name) {
  let base = name.replace(/\.[^.]+$/, '');
  base = base.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base };
}

function parseLrc(lrc) {
  const out = [];
  lrc.split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (m && m[3].trim()) out.push({ t: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() });
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}

function normTok(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function alignOfficial(items) {
  const N = whisperWords.length;
  const wn = whisperWords.map(w => normTok(w.word));
  const matches = new Array(items.length).fill(null);

  if (N > 0) {
    let from = 0;
    items.forEach((it, li) => {
      const toks = it.text ? it.text.trim().split(/\s+/).filter(Boolean).map(normTok).filter(Boolean) : [];
      if (!toks.length) return;
      const n = toks.length;
      let bestScore = 0, bestI = -1, bestM = n;
      [n - 1, n, n + 1].forEach(m => {
        if (m < 1 || m > N) return;
        for (let i = from; i + m <= N; i++) {
          let hits = 0;
          for (let k = 0; k < n; k++) {
            const wi = i + Math.round(k * (m - 1) / Math.max(1, n - 1));
            if (wn[wi] === toks[k]) hits++;
          }
          const score = hits / n;
          if (score > bestScore) { bestScore = score; bestI = i; bestM = m; }
        }
      });
      if (bestScore >= 0.5 && bestI >= 0) {
        matches[li] = { i: bestI, m: bestM };
        from = bestI + bestM;
      }
    });
  }

  words = [];
  lines = [];
  let prevEnd = 0;
  items.forEach((it, li) => {
    const lrcStart = it.t;
    const lrcEnd = items[li + 1] ? Math.max(it.t + 0.5, items[li + 1].t) : (audio.duration || it.t + 5);
    const rawToks = it.text ? it.text.trim().split(/\s+/).filter(Boolean) : [];
    const mat = matches[li];
    const wordIdxs = [];
    if (mat && rawToks.length) {
      const n = rawToks.length;
      rawToks.forEach((tok, k) => {
        const wi = Math.min(mat.i + mat.m - 1, mat.i + Math.round(k * (mat.m - 1) / Math.max(1, n - 1)));
        const src = whisperWords[Math.max(0, Math.min(N - 1, wi))];
        const ws = Math.max(prevEnd + 0.02, src.start);
        const we = Math.max(ws + 0.08, src.end);
        prevEnd = we;
        wordIdxs.push(words.length);
        words.push({ word: tok, start: +ws.toFixed(3), end: +we.toFixed(3) });
      });
    } else {
      const n = rawToks.length;
      rawToks.forEach((tok, k) => {
        wordIdxs.push(words.length);
        words.push({
          word: tok,
          start: +(lrcStart + (lrcEnd - lrcStart) * k / Math.max(1, n)).toFixed(3),
          end: +(lrcStart + (lrcEnd - lrcStart) * (k + 1) / Math.max(1, n)).toFixed(3),
        });
      });
    }
    lines.push({ wordIdxs, startTime: lrcStart, endTime: lrcEnd });
  });
}

function renderExternal(items) {
  lyricsMode = 'whisper';
  activeLineIndex = -1;
  alignOfficial(items);
  const isRtl = /[\u0590-\u08FF]/.test(words.map(w => w.word).join(' '));
  document.body.dir = isRtl ? 'rtl' : 'ltr';
  timedLines = lines.map(line => ({ ...line, wordEls: [], el: null }));
  lyricsTrack.innerHTML = '';
  lines.forEach((line, li) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.line = li;
    const wordEls = [];
    line.wordIdxs.forEach(wi => {
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.idx = wi;
      span.textContent = words[wi].word;
      div.appendChild(span);
      wordEls.push(span);
    });
    div.addEventListener('click', () => { audio.currentTime = line.startTime; if (audio.paused) audio.play(); });
    lyricsTrack.appendChild(div);
    timedLines[li].el = div;
    timedLines[li].wordEls = wordEls;
  });
  activeLineIndex = -1;
  showToolBtns();
  syncFsLyricsIfOpen();
}

async function fetchOfficial(silent) {
  const artist = artistInput.value.trim();
  const title = titleInput.value.trim();
  if (!title) { if (!silent) setStatus('Enter a song title first'); return; }
  officialBtn.disabled = true;
  officialBtn.textContent = 'Searching...';
  try {
    const res = await fetch('/lyrics?' + new URLSearchParams({ title, artist }));
    const data = await res.json();
    if (!res.ok || data.error) { if (!silent) setStatus(data.error || 'Not found'); return false; }
    if (data.syncedLyrics) {
      renderExternal(parseLrc(data.syncedLyrics));
      setStatus('Synced official lyrics loaded (' + data.artistName + ' \u2014 ' + data.trackName + ')');
      setTimeout(() => setStatus(''), 4000);
      return true;
    }
    if (silent) return false;
    if (data.plainLyrics) {
      const dur = audio.duration || 240;
      const rows = data.plainLyrics.split(/\r?\n/);
      renderExternal(rows.map((t, i) => ({ t: i / rows.length * dur, text: t.trim() })));
      setStatus('Plain lyrics loaded \u2014 timing is approximate');
      setTimeout(() => setStatus(''), 4000);
    } else {
      setStatus('No lyrics found');
    }
    return true;
  } catch (e) {
    if (!silent) setStatus('Network error');
    return false;
  } finally {
    officialBtn.disabled = false;
    officialBtn.textContent = 'Official lyrics';
  }
}

async function tryAutoOfficial() {
  const title = titleInput.value.trim();
  if (!title) return;
  const ok = await fetchOfficial(true);
  if (!ok && lines.length) setStatus('Using Whisper transcription \u2014 click Official lyrics to search manually');
}

officialBtn.addEventListener('click', fetchOfficial);
titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchOfficial(); });
artistInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchOfficial(); });

/* ================= export ================= */
exportLrc.addEventListener('click', () => {
  if (!lines.length) return;
  let lrc = '';
  lines.forEach((line, i) => {
    lrc += '[' + fmtLrc(line.startTime) + ']' + getLineText(i) + '\n';
  });
  downloadFile(lrc, 'lyrics.lrc', 'text/plain');
});
exportSrt.addEventListener('click', () => {
  if (!lines.length) return;
  let srt = '';
  lines.forEach((line, i) => {
    srt += (i + 1) + '\n' + fmtSrt(line.startTime) + ' --> ' + fmtSrt(line.endTime) + '\n' + getLineText(i) + '\n\n';
  });
  downloadFile(srt, 'lyrics.srt', 'text/plain');
});
function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* ================= fullscreen ================= */
const fsBtnPill = document.getElementById('fsBtnPill');
const fsBtnTop = document.getElementById('fsBtn');
function enterFullscreen() {
  if (!lines.length) return;
  isFullscreen = true;
  fsOverlay.classList.add('active');
  fsLyrics.innerHTML = lyricsTrack.innerHTML;
  fsLyrics.querySelectorAll('.lyric-line').forEach(el => {
    el.addEventListener('click', () => {
      const li = parseInt(el.dataset.line);
      audio.currentTime = lines[li].startTime;
      if (audio.paused) audio.play();
    });
  });
  syncFsLyrics();
}
function exitFullscreen() {
  isFullscreen = false;
  fsOverlay.classList.remove('active');
}
function syncFsLyricsIfOpen() {
  if (isFullscreen) syncFsLyrics();
}
function syncFsLyrics() {
  if (!isFullscreen || !timedLines.length) return;
  const t = audio.currentTime;
  const els = fsLyrics.querySelectorAll('.lyric-line');
  let newLine = timedLines.length - 1;
  for (let i = 0; i < timedLines.length; i++) {
    if (t < timedLines[i].startTime) { newLine = Math.max(0, i - 1); break; }
    if (t >= timedLines[i].startTime && t <= timedLines[i].endTime) { newLine = i; break; }
    if (i === timedLines.length - 1) { newLine = i; }
  }

  els.forEach((el, i) => {
    el.classList.remove('active', 'past', 'future', 'near');
    if (i === newLine) el.classList.add('active');
    else if (Math.abs(i - newLine) <= 2) el.classList.add('near');
    else if (i < newLine) el.classList.add('past');
    else el.classList.add('future');
  });

  if (els[newLine]) {
    const wt = t + WORD_LEAD_S;
    const wordElsInFs = els[newLine].querySelectorAll('.word');
    wordElsInFs.forEach(wEl => {
      const w = words[parseInt(wEl.dataset.idx)];
      wEl.classList.remove('sung', 'lit');
      if (wt >= w.end) wEl.classList.add('sung');
      else if (wt >= w.start) wEl.classList.add('lit');
    });

    const boxRect = fsLyrics.getBoundingClientRect();
    const elRect = els[newLine].getBoundingClientRect();
    if (elRect.top < boxRect.top + 100 || elRect.bottom > boxRect.bottom - 100) {
      els[newLine].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

fsBtnPill.addEventListener('click', enterFullscreen);
if (fsBtnTop) fsBtnTop.addEventListener('click', enterFullscreen);
fsExit.addEventListener('click', exitFullscreen);
fsPlayBtn.addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });

/* ================= keyboard ================= */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (audio.paused) audio.play(); else audio.pause();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      audio.volume = Math.min(1, audio.volume + 0.1);
      volSlider.value = audio.volume;
      volIcon.innerHTML = audio.volume == 0 ? '&#128264;' : audio.volume < 0.5 ? '&#128265;' : '&#128266;';
      break;
    case 'ArrowDown':
      e.preventDefault();
      audio.volume = Math.max(0, audio.volume - 0.1);
      volSlider.value = audio.volume;
      volIcon.innerHTML = audio.volume == 0 ? '&#128264;' : audio.volume < 0.5 ? '&#128265;' : '&#128266;';
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      if (isFullscreen) exitFullscreen(); else enterFullscreen();
      break;
    case 'Escape':
      if (isFullscreen) exitFullscreen();
      break;
  }
});
