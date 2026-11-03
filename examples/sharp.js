// Draws a demo's fixed-size canvas (<canvas data-sharp width="800" height="600">) at the
// screen's real resolution, so text and edges stay crisp on phones and retina screens. The game
// still sees an 800 × 600 canvas: width and height read the same, and the context is pre-scaled.
for (const c of document.querySelectorAll('canvas[data-sharp]')) {
  const k = Math.min(2, window.devicePixelRatio || 1);
  if (k === 1) continue;
  const w = c.width;
  const h = c.height;
  c.width = w * k;
  c.height = h * k;
  Object.defineProperty(c, 'width', { get: () => w });
  Object.defineProperty(c, 'height', { get: () => h });
  c.getContext('2d').scale(k, k);
}

// Inside the landing page's frames the page around it is already Joinable's: no link back.
if (window.top !== window.self) document.documentElement.classList.add('framed');
