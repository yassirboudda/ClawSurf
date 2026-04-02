// Generate PNG icons from canvas (no external deps needed for simple shapes)
const { createCanvas } = (() => {
  try { return require('canvas'); } catch { return { createCanvas: null }; }
})();

const fs = require('fs');

function drawIcon(size) {
  // Use a simple SVG approach and write it, then we'll use Chrome's SVG support
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c4b5fd"/>
      <stop offset="100%" stop-color="#f9a8d4"/>
    </linearGradient>
    <linearGradient id="inner" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#67e8f9"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <!-- Claw/wave arc -->
  <path d="M32 64c0-17.7 14.3-32 32-32s32 14.3 32 32-14.3 32-32 32" 
        stroke="white" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.9"/>
  <path d="M48 64c0-8.8 7.2-16 16-16s16 7.2 16 16" 
        stroke="white" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.75"/>
  <!-- Center dot -->
  <circle cx="64" cy="64" r="6" fill="white"/>
  <!-- Surf sparkle -->
  <circle cx="92" cy="36" r="4" fill="white" opacity="0.6"/>
  <circle cx="100" cy="48" r="2.5" fill="white" opacity="0.4"/>
</svg>`;
  return svg;
}

[16, 32, 48, 128].forEach(size => {
  const svg = drawIcon(size);
  fs.writeFileSync(`icon${size}.svg`, svg);
});
console.log('SVG icons generated');
