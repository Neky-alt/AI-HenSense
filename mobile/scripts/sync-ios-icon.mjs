/**
 * HenSense V4.5 - synchronize the supplied golden app icon into an existing
 * native iOS AppIcon asset catalog, without recreating ios/ or losing Xcode
 * signing changes. Run from mobile/: node scripts/sync-ios-icon.mjs
 * Uses macOS's built-in `sips`; no npm dependency is required.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ios = path.join(mobile, 'ios');
const icon = path.join(mobile, 'assets', 'brand', 'hensense-app-icon-v45.png');

if (!fs.existsSync(icon)) {
  console.error(`Missing HenSense golden app icon: ${icon}`);
  process.exit(1);
}
if (!fs.existsSync(ios)) {
  console.error('No mobile/ios directory found. First create the iOS project with Expo, then rerun this script.');
  process.exit(1);
}

function findIconCatalogs(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['Pods', 'build', '.git', 'DerivedData'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.name === 'AppIcon.appiconset') {
      if (fs.existsSync(path.join(absolute, 'Contents.json'))) result.push(absolute);
    } else {
      findIconCatalogs(absolute, result);
    }
  }
  return result;
}

const catalogs = findIconCatalogs(ios);
if (!catalogs.length) {
  console.error('No AppIcon.appiconset/Contents.json was found under mobile/ios. Check the Xcode project asset catalog.');
  process.exit(1);
}

let updated = 0;
for (const catalog of catalogs) {
  const manifestPath = path.join(catalog, 'Contents.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.images)) {
    console.error(`No images array in ${manifestPath}`);
    process.exit(1);
  }
  // Xcode's universal 1024pt AppIcon entry often has one file; older catalogs
  // can list 40/60pt entries at 2x/3x. Respect each declared pixel dimension.
  if (!manifest.images.some((item) => item.filename)) {
    const universal = manifest.images.find((item) => item.size === '1024x1024') ?? manifest.images[0];
    if (!universal) throw new Error(`Empty image catalog: ${manifestPath}`);
    universal.filename = 'hensense-app-icon-v45.png';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const item of manifest.images) {
    if (!item.filename) continue;
    const match = String(item.size ?? '1024x1024').match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
    const scale = Number.parseFloat(String(item.scale ?? '1x')) || 1;
    const width = match ? Math.round(Number(match[1]) * scale) : 1024;
    const height = match ? Math.round(Number(match[2]) * scale) : 1024;
    const dest = path.join(catalog, item.filename);
    if (width === 1024 && height === 1024) {
      fs.copyFileSync(icon, dest);
    } else {
      // macOS sips ships with Xcode-compatible macOS installs.
      execFileSync('sips', ['-s', 'format', 'png', '-z', String(height), String(width), icon, '--out', dest], { stdio: 'pipe' });
    }
    updated += 1;
    console.log(`${path.relative(mobile, dest)} (${width}x${height})`);
  }
}
console.log(`Updated ${updated} native iOS icon image(s). Rebuild HenSense with: npx expo run:ios --device`);
