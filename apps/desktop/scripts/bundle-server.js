/**
 * Creates a standalone, flat server bundle for Electron packaging.
 *
 * pnpm's node_modules uses symlinks that break when electron-builder copies
 * them as extraResources. This script builds a flat bundle using npm instead:
 *
 *   1. Copies compiled server code (dist/) and dashboard (public/)
 *   2. Creates a package.json with resolved (non-workspace) dependencies
 *   3. Runs `npm install --production` to get a flat node_modules/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_DIR = path.join(ROOT, 'apps', 'local-server');
const PROCESSING_DIR = path.join(ROOT, 'packages', 'processing');
const OUT = path.join(__dirname, '..', 'server-bundle');

// Clean previous bundle
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true });
}
fs.mkdirSync(OUT, { recursive: true });

// Copy server dist/ and public/
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[bundle] Copying server dist/ ...');
copyDirSync(path.join(SERVER_DIR, 'dist'), path.join(OUT, 'dist'));

console.log('[bundle] Copying server public/ ...');
copyDirSync(path.join(SERVER_DIR, 'public'), path.join(OUT, 'public'));

// Build a package.json with the processing library as a local file dependency
// First, pack the processing library into a tarball
console.log('[bundle] Packing @force-plate/processing ...');
const packOutput = execSync('npm pack --pack-destination ' + JSON.stringify(OUT), {
  cwd: PROCESSING_DIR,
  encoding: 'utf-8',
}).trim();
const tarball = path.basename(packOutput.split('\n').pop());
console.log('[bundle] Packed:', tarball);

// Read the server's package.json to get its dependencies
const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf-8'));
const deps = { ...serverPkg.dependencies };

// Replace workspace reference with the local tarball
deps['@force-plate/processing'] = 'file:./' + tarball;

// Write bundle package.json
const bundlePkg = {
  name: 'force-plate-server-bundle',
  version: '1.0.0',
  private: true,
  type: 'module',
  dependencies: deps,
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(bundlePkg, null, 2));
console.log('[bundle] Created package.json with dependencies:', Object.keys(deps).join(', '));

// Run npm install to get a flat node_modules
console.log('[bundle] Running npm install --production ...');
execSync('npm install --production --ignore-scripts', {
  cwd: OUT,
  stdio: 'inherit',
});

// Clean up tarball and package-lock (not needed in the bundle)
try { fs.unlinkSync(path.join(OUT, tarball)); } catch {}
try { fs.unlinkSync(path.join(OUT, 'package-lock.json')); } catch {}

console.log('[bundle] Done! Bundle at:', OUT);
