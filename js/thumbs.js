// Thumbnail maker: upload an image or grab a frame from your video, add bold text, and it's
// cropped to 16:9, sized to 1280×720 and squeezed under YouTube's 2 MB limit.
import { $, esc } from './util.js';

const W = 1280, H = 720, MAX = 2 * 1024 * 1024;

function coverDraw(ctx, src, sw, sh) {
  const s = Math.max(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawText(ctx, text) {
  if (!text) return;
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  let size = 132;
  const lines = [];
  const fit = () => {
    lines.length = 0;
    ctx.font = `800 ${size}px Manrope, Impact, sans-serif`;
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > W * 0.86 && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
  };
  fit();
  while ((lines.length > 3 || lines.some(l => ctx.measureText(l).width > W * 0.9)) && size > 48) { size -= 8; fit(); }
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const lh = size * 1.02;
  let y = H - 48 - (lines.length - 1) * lh;
  for (const l of lines) {
    ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#000'; ctx.strokeText(l, 56, y);
    ctx.fillStyle = '#fff'; ctx.fillText(l, 56, y);
    y += lh;
  }
}

async function toJpeg(canvas) {
  for (const q of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
    const b = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (b && b.size < MAX) return new File([b], 'thumbnail.jpg', { type: 'image/jpeg' });
  }
  throw new Error('Could not get the thumbnail under 2 MB.');
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = () => rej(new Error('That image could not be opened.'));
    img.src = URL.createObjectURL(file);
  });
}

function seek(video, t) {
  return new Promise(res => {
    const done = () => { video.removeEventListener('seeked', done); res(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(Math.max(0, t), Math.max(0, (video.duration || 0) - 0.05));
  });
}

/**
 * Mount the editor in `root`.
 * opts: { videoFile?, title?, onChange(file|null, { frameSec }) }
 */
export function thumbnailEditor(root, { videoFile = null, title = '', onChange }) {
  const st = { source: null, img: null, frameSec: 0, text: '' };
  root.innerHTML = `
    <div class="thumb-ed">
      <div class="btn-row">
        <label class="btn small"><input type="file" accept="image/jpeg,image/png,image/webp" hidden data-th-file>Upload image</label>
        ${videoFile ? '<button type="button" class="btn small" data-th-frame>Use a frame from the video</button>' : ''}
        <button type="button" class="btn small" data-th-clear hidden>Remove</button>
      </div>
      <div data-th-scrub hidden style="margin-top:10px">
        <video muted playsinline preload="auto" style="display:none"></video>
        <input type="range" min="0" max="1000" value="100" style="width:100%" aria-label="Pick the frame">
        <div class="how">Slide to pick the frame</div>
      </div>
      <div data-th-edit hidden style="margin-top:10px">
        <label class="field">Text on thumbnail (optional)<input type="text" maxlength="40" data-th-text placeholder="I DID IT"></label>
        <div class="th-previews">
          <div><canvas width="${W}" height="${H}" class="th-big"></canvas><div class="how">Large (home page)</div></div>
          <div class="th-small-wrap"><div class="th-small-card"><img alt="Small preview"><div class="th-small-title">${esc(title || 'Your video title')}</div></div><div class="how">Small (suggested videos)</div></div>
        </div>
        <div class="how" data-th-size></div>
      </div>
    </div>`;
  const canvas = $('.th-big', root), ctx = canvas.getContext('2d');
  const video = $('video', root), range = $('input[type=range]', root);

  let timer;
  const render = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!st.source) return;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (st.source === 'image') coverDraw(ctx, st.img, st.img.naturalWidth, st.img.naturalHeight);
      else coverDraw(ctx, video, video.videoWidth, video.videoHeight);
      drawText(ctx, st.text);
      const file = await toJpeg(canvas);
      $('.th-small-card img', root).src = URL.createObjectURL(file);
      $('[data-th-size]', root).textContent = `1280×720 JPG · ${(file.size / 1024).toFixed(0)} KB`;
      onChange?.(file, { frameSec: st.source === 'frame' ? st.frameSec : null });
    }, 120);
  };
  const show = () => { $('[data-th-edit]', root).hidden = false; $('[data-th-clear]', root).hidden = false; };

  $('[data-th-file]', root).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    st.img = await loadImage(f); st.source = 'image';
    $('[data-th-scrub]', root).hidden = true; show(); render();
  };
  const frameBtn = $('[data-th-frame]', root);
  if (frameBtn) frameBtn.onclick = async () => {
    if (!video.src) {
      video.src = URL.createObjectURL(videoFile);
      await new Promise(r => { if (video.readyState >= 1) r(); else video.onloadedmetadata = r; });
    }
    st.source = 'frame';
    $('[data-th-scrub]', root).hidden = false; show();
    st.frameSec = (range.value / 1000) * video.duration;
    await seek(video, st.frameSec); render();
  };
  let seeking = false, pendingT = null;
  range.oninput = async () => {
    pendingT = (range.value / 1000) * (video.duration || 0);
    if (seeking) return;
    seeking = true;
    while (pendingT != null) { const t = pendingT; pendingT = null; st.frameSec = t; await seek(video, t); render(); }
    seeking = false;
  };
  $('[data-th-text]', root).oninput = e => { st.text = e.target.value; render(); };
  $('[data-th-clear]', root).onclick = () => {
    st.source = null; $('[data-th-edit]', root).hidden = true; $('[data-th-scrub]', root).hidden = true; $('[data-th-clear]', root).hidden = true;
    onChange?.(null, {});
  };
}
