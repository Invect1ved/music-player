const builtins = [
  { id: "rassvet", title: "Рассвет", src: "audio/rassvet.wav" },
  { id: "dozhd", title: "Дождь", src: "audio/dozhd.wav" },
  { id: "gorod", title: "Город", src: "audio/gorod.wav" },
  { id: "kosmos", title: "Космос", src: "audio/kosmos.wav" },
  { id: "final", title: "Финал", src: "audio/final.wav" }
];

const audio = document.querySelector("#audio");
const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");
const playButton = document.querySelector("#play");
const seek = document.querySelector("#seek");
const timeLabel = document.querySelector("#time");
const volume = document.querySelector("#volume");
const trackList = document.querySelector("#tracks");
const title = document.querySelector("#now-title");
const playlistSelect = document.querySelector("#playlist");

const state = {
  playlists: loadPlaylists(),
  currentPlaylist: localStorage.getItem("player-current") || "Демо",
  index: 0,
  shuffle: false,
  repeat: "none",
  seeking: false,
  custom: new Map()
};

let audioCtx;
let analyser;
let freq;
let wave;
let vizSource;
let realViz = false;
const vizCache = new Map();
let levels = new Array(48).fill(0);

function loadPlaylists() {
  const saved = localStorage.getItem("player-playlists");
  if (saved) return JSON.parse(saved);
  return { "Демо": builtins.map(track => ({ kind: "builtin", id: track.id })) };
}

function savePlaylists() {
  localStorage.setItem("player-playlists", JSON.stringify(state.playlists));
  localStorage.setItem("player-current", state.currentPlaylist);
}

function tracksOf(name) {
  return (state.playlists[name] || []).map(resolve).filter(Boolean);
}

function resolve(item) {
  if (item.kind === "builtin") return builtins.find(track => track.id === item.id) || null;
  const custom = state.custom.get(item.id);
  return custom ? { id: item.id, title: custom.title, src: custom.url } : { id: item.id, title: item.title + " (файл не в этой сессии)", src: "" };
}

function renderPlaylists() {
  playlistSelect.innerHTML = Object.keys(state.playlists).map(name => `<option ${name === state.currentPlaylist ? "selected" : ""}>${name}</option>`).join("");
  const tracks = tracksOf(state.currentPlaylist);
  trackList.innerHTML = tracks.map((track, index) => `<li><button type="button" data-index="${index}" class="${index === state.index ? "active" : ""}">${index + 1}. ${track.title}</button></li>`).join("");
  if (!tracks.length) trackList.innerHTML = "<li>Плейлист пуст. Добавьте файл или вернитесь к «Демо».</li>";
}

function format(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

function currentTrack() {
  return tracksOf(state.currentPlaylist)[state.index] || null;
}

async function ensureGraph() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (analyser) return;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const silent = audioCtx.createGain();
  silent.gain.value = 0;
  analyser.connect(silent);
  silent.connect(audioCtx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
}

function stopViz() {
  if (!vizSource) return;
  try { vizSource.stop(); } catch { /* уже остановлен */ }
  vizSource.disconnect();
  vizSource = null;
}

async function bufferFor(src) {
  if (vizCache.has(src)) return vizCache.get(src);
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(String(response.status));
    const bytes = await response.arrayBuffer();
    const buffer = await audioCtx.decodeAudioData(bytes);
    vizCache.set(src, buffer);
    return buffer;
  } catch {
    vizCache.set(src, null);
    return null;
  }
}

async function syncViz() {
  if (audio.paused || !audio.src) {
    stopViz();
    realViz = false;
    return;
  }
  await ensureGraph();
  const buffer = await bufferFor(audio.src);
  if (audio.paused) return;
  stopViz();
  if (!buffer) {
    realViz = false;
    return;
  }
  vizSource = audioCtx.createBufferSource();
  vizSource.buffer = buffer;
  vizSource.connect(analyser);
  vizSource.start(0, Math.min(audio.currentTime || 0, Math.max(0, buffer.duration - 0.01)));
  realViz = true;
}

async function playIndex(index) {
  const tracks = tracksOf(state.currentPlaylist);
  if (!tracks.length) return;
  state.index = (index + tracks.length) % tracks.length;
  const track = tracks[state.index];
  if (!track.src) {
    title.textContent = track.title;
    renderPlaylists();
    return;
  }
  stopViz();
  const graph = ensureGraph();
  audio.src = track.src;
  title.textContent = track.title;
  playButton.textContent = "Пауза";
  renderPlaylists();
  try {
    await audio.play();
    await graph;
  } catch {
    playButton.textContent = "Слушать";
    title.textContent = "Браузер не включил звук. Нажмите «Слушать» ещё раз.";
  }
}

playButton.onclick = async () => {
  const track = currentTrack();
  if (!track) return;
  if (!audio.src || audio.src.endsWith("/")) {
    await playIndex(state.index);
    return;
  }
  if (audio.paused) {
    const graph = ensureGraph();
    playButton.textContent = "Пауза";
    try {
      await audio.play();
      await graph;
    } catch {
      playButton.textContent = "Слушать";
      title.textContent = "Браузер не включил звук. Нажмите «Слушать» ещё раз.";
    }
  } else {
    audio.pause();
    playButton.textContent = "Слушать";
  }
};

audio.onplay = () => { syncViz(); };
audio.onseeked = () => { if (!audio.paused) syncViz(); };
audio.onpause = () => stopViz();

audio.ontimeupdate = () => {
  if (!state.seeking && audio.duration) seek.value = String(Math.round(audio.currentTime / audio.duration * 1000));
  timeLabel.textContent = format(audio.currentTime) + " / " + format(audio.duration);
};

seek.onpointerdown = () => { state.seeking = true; };
seek.onchange = () => {
  if (audio.duration) audio.currentTime = audio.duration * (Number(seek.value) / 1000);
  state.seeking = false;
  if (!audio.paused) syncViz();
};
volume.oninput = () => { audio.volume = Number(volume.value); };
audio.volume = 0.8;

audio.onended = () => {
  if (state.repeat === "one") {
    playIndex(state.index);
    return;
  }
  const tracks = tracksOf(state.currentPlaylist);
  if (state.shuffle && tracks.length > 1) {
    let next = state.index;
    while (next === state.index) next = Math.floor(Math.random() * tracks.length);
    playIndex(next);
    return;
  }
  if (state.index < tracks.length - 1) playIndex(state.index + 1);
  else if (state.repeat === "all") playIndex(0);
  else playButton.textContent = "Слушать";
};

trackList.onclick = event => {
  const button = event.target.closest("button[data-index]");
  if (button) playIndex(Number(button.dataset.index));
};

document.querySelector("#shuffle").onclick = event => {
  state.shuffle = !state.shuffle;
  event.target.textContent = "Случайно: " + (state.shuffle ? "вкл" : "выкл");
};

document.querySelector("#repeat").onclick = event => {
  state.repeat = state.repeat === "none" ? "all" : state.repeat === "all" ? "one" : "none";
  event.target.textContent = "Повтор: " + (state.repeat === "none" ? "нет" : state.repeat === "all" ? "все" : "один");
};

playlistSelect.onchange = () => {
  state.currentPlaylist = playlistSelect.value;
  state.index = 0;
  audio.removeAttribute("src");
  title.textContent = "Выберите трек";
  savePlaylists();
  renderPlaylists();
};

document.querySelector("#save-form").onsubmit = event => {
  event.preventDefault();
  const name = new FormData(event.target).get("name").toString().trim();
  if (!name || name === "Демо") return;
  state.playlists[name] = state.playlists[state.currentPlaylist].map(item => ({ ...item }));
  state.currentPlaylist = name;
  savePlaylists();
  renderPlaylists();
  event.target.reset();
};

document.querySelector("#remove-playlist").onclick = () => {
  if (state.currentPlaylist === "Демо") return;
  delete state.playlists[state.currentPlaylist];
  state.currentPlaylist = "Демо";
  state.index = 0;
  savePlaylists();
  renderPlaylists();
};

document.querySelector("#file").onchange = async event => {
  for (const file of event.target.files) {
    const id = "file-" + crypto.randomUUID();
    const url = URL.createObjectURL(file);
    state.custom.set(id, { title: file.name, url });
    state.playlists[state.currentPlaylist].push({ kind: "custom", id, title: file.name });
    await storeFile(id, file);
  }
  savePlaylists();
  renderPlaylists();
  event.target.value = "";
};

function storeFile(id, file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("player-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => {
      const tx = request.result.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function restoreFiles() {
  const items = Object.values(state.playlists).flat().filter(item => item.kind === "custom");
  if (!items.length) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("player-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      let pending = items.length;
      if (!pending) resolve();
      for (const item of items) {
        const get = store.get(item.id);
        get.onsuccess = () => {
          if (get.result) {
            state.custom.set(item.id, { title: item.title, url: URL.createObjectURL(get.result) });
          }
          if (--pending === 0) resolve();
        };
      }
    };
  }).catch(() => {});
}

function draw() {
  requestAnimationFrame(draw);
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, width, height);

  if (realViz && analyser && !audio.paused) {
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    const step = Math.max(1, Math.floor(freq.length / levels.length));
    for (let i = 0; i < levels.length; i++) levels[i] = freq[i * step] / 255;
  } else if (!audio.paused) {
    const t = audio.currentTime || 0;
    wave = new Uint8Array(128);
    for (let i = 0; i < levels.length; i++) {
      levels[i] = 0.2 + 0.7 * Math.abs(Math.sin(t * 8 + i * 0.37) * Math.sin(t * 1.7 + i));
    }
    for (let i = 0; i < wave.length; i++) wave[i] = 128 + Math.sin(t * 14 + i * 0.2) * 70;
  } else {
    for (let i = 0; i < levels.length; i++) levels[i] *= 0.86;
  }

  const gap = 4;
  const barWidth = (width - gap * levels.length) / levels.length;
  levels.forEach((level, i) => {
    const barHeight = Math.max(2, level * (height - 36));
    ctx.fillStyle = audio.paused ? "#6d564c" : "#e36a3a";
    ctx.fillRect(i * (barWidth + gap), height - 16 - barHeight, barWidth, barHeight);
  });

  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#f4efe6";
  const data = wave || new Uint8Array(128);
  for (let i = 0; i < data.length; i++) {
    const x = i / data.length * width;
    const y = audio.paused ? height * 0.35 : (data[i] / 255) * height * 0.45;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

restoreFiles().then(() => {
  renderPlaylists();
  draw();
});
