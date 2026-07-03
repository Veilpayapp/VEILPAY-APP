/**
 * VeilPay app-icon generator.
 *
 * Source of truth: the repo-root `Logo.png` — the shield-only brand glyph
 * (black shield on an off-white background). Every launcher / splash / adaptive
 * / notification asset is derived from it so they never drift again.
 *
 * Why this exists: the previous icon assets were wrong —
 *   - android-icon-foreground.png was a blue chevron (not the shield)
 *   - android-icon-background.png was a Figma safe-zone guide template
 *   - icon.png / android-icon-monochrome.png were the chevron too
 *   - logo-icon.png was a speckled photo of the logo (looked deformed)
 *
 * Run: `node scripts/generate-icons.js`  (jimp is already a dependency)
 */
const path = require('path');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'Logo.png');
const OUT = path.join(ROOT, 'apps', 'consumer-app', 'assets');

// Brand dark — matches app.config.js splash/adaptive backgroundColor.
const BG = 0x0a0a0bff;

/**
 * Extract the shield as a white silhouette on transparency.
 *
 * The source is a black glyph on ~#F8F8F8. We convert luminance to alpha with a
 * ramp that keys the off-white background fully transparent while preserving the
 * anti-aliased glyph edge, then paint every kept pixel pure white so the shield
 * reads cleanly on any background (and can be system-tinted for themed icons).
 */
async function extractWhiteShield() {
  const img = await Jimp.read(SRC);
  const { width, height, data } = img.bitmap;

  // Tight bounding box of the dark glyph.
  let minX = width, minY = height, maxX = 0, maxY = 0;
  img.scan(0, 0, width, height, (x, y, i) => {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < 110) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });

  // Repaint to white + luminance-derived alpha.
  //   lum <= DARK  -> fully opaque (glyph body)
  //   lum >= LIGHT -> fully transparent (background)
  //   between      -> linear ramp (anti-aliased edge)
  const DARK = 70;
  const LIGHT = 225;
  img.scan(0, 0, width, height, (x, y, i) => {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    let a;
    if (lum <= DARK) a = 255;
    else if (lum >= LIGHT) a = 0;
    else a = Math.round((1 - (lum - DARK) / (LIGHT - DARK)) * 255);
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = a;
  });

  // Crop to the glyph bbox (1px pad, clamped) so scaling math is exact.
  const pad = 1;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(width - cx, maxX - minX + 1 + pad * 2);
  const ch = Math.min(height - cy, maxY - minY + 1 + pad * 2);
  img.crop({ x: cx, y: cy, w: cw, h: ch });
  return img;
}

/**
 * Compose one asset: a `size`×`size` canvas (optionally filled with `bg`) with
 * the white shield scaled so its HEIGHT is `coverage`× the canvas and centered.
 */
async function compose(shield, { size, coverage, bg }) {
  const canvas = new Jimp({ width: size, height: size, color: bg ?? 0x00000000 });

  const sprite = shield.clone();
  const targetH = Math.round(size * coverage);
  const scale = targetH / sprite.bitmap.height;
  const targetW = Math.round(sprite.bitmap.width * scale);
  sprite.resize({ w: targetW, h: targetH });

  const x = Math.round((size - targetW) / 2);
  const y = Math.round((size - targetH) / 2);
  canvas.composite(sprite, x, y);
  return canvas;
}

async function main() {
  const shield = await extractWhiteShield();
  console.log(`Extracted shield ${shield.bitmap.width}×${shield.bitmap.height} from Logo.png`);

  // iOS app icon + splash source: white shield on brand dark, full-bleed with a
  // comfortable margin (iOS rounds the corners itself).
  const logoIcon = await compose(shield, { size: 1024, coverage: 0.6, bg: BG });
  await logoIcon.write(path.join(OUT, 'logo-icon.png'));

  // Android adaptive foreground: shield inside the ~66% safe zone, transparent
  // so the separate background layer shows through the launcher mask.
  const fg = await compose(shield, { size: 512, coverage: 0.52 });
  await fg.write(path.join(OUT, 'android-icon-foreground.png'));

  // Android adaptive background: solid brand dark.
  const bg = new Jimp({ width: 512, height: 512, color: BG });
  await bg.write(path.join(OUT, 'android-icon-background.png'));

  // Android themed (monochrome) icon: silhouette in the safe zone; the system
  // recolors it, so pure white on transparent is correct.
  const mono = await compose(shield, { size: 432, coverage: 0.52 });
  await mono.write(path.join(OUT, 'android-icon-monochrome.png'));

  // Notification icon: Android renders only the alpha channel, so a white
  // silhouette on transparent is required.
  const notif = await compose(shield, { size: 1024, coverage: 0.6 });
  await notif.write(path.join(OUT, 'icon.png'));

  console.log('Wrote: logo-icon.png, android-icon-foreground.png, android-icon-background.png, android-icon-monochrome.png, icon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
