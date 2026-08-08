import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'manifest.json');
const releaseDir = path.join(repoRoot, 'release');

const requiredPaths = [
  'manifest.json',
  'devtools.html',
  'panel.html',
  'popup.html',
  'guide.html',
  'styles.css',
  'dist',
  'icons',
  'privacy_policy.md',
];

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function timestampSuffix() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ];
  return parts.join('');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function copyRequiredFiles() {
  const stagingDir = path.join(releaseDir, `store-package-${timestampSuffix()}`);

  for (const relativePath of requiredPaths) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(stagingDir, relativePath);

    if (!(await pathExists(sourcePath))) {
      throw new Error(`Missing required path: ${relativePath}`);
    }

    await fs.cp(sourcePath, destinationPath, {
      recursive: true,
      // Source maps and the store-listing icon are not runtime files.
      filter: copiedSourcePath =>
        !copiedSourcePath.endsWith('.map') && path.basename(copiedSourcePath) !== 'storeIcon.png',
    });
  }

  return stagingDir;
}

function createZip(stagingDir, zipPath) {
  const executable = process.platform === 'win32' ? 'powershell' : 'zip';
  const args =
    process.platform === 'win32'
      ? [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path * -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
        ]
      : ['-r', zipPath, '.'];

  execFileSync(executable, args, {
    cwd: stagingDir,
    stdio: 'inherit',
  });
}

async function safeRemove(targetPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        await delay(250);
        continue;
      }
      throw error;
    }
  }
  return false;
}

async function cleanupStagingDirs() {
  if (!(await pathExists(releaseDir))) {
    return;
  }

  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('store-package')) {
      continue;
    }

    await safeRemove(path.join(releaseDir, entry.name));
  }
}

async function prepareZipTarget(canonicalZipPath) {
  const canonicalName = path.basename(canonicalZipPath);
  const canonicalPrefix = canonicalName.slice(0, -'.zip'.length);
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  const warnings = [];
  let finalZipPath = canonicalZipPath;

  if (await pathExists(canonicalZipPath)) {
    const removed = await safeRemove(canonicalZipPath);
    if (!removed) {
      finalZipPath = path.join(releaseDir, `${canonicalPrefix}-${timestampSuffix()}.zip`);
      warnings.push(`Could not replace locked canonical ZIP: ${canonicalName}`);
    }
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) {
      continue;
    }

    if (entry.name === path.basename(finalZipPath)) {
      continue;
    }

    const matchesSameVersion =
      entry.name === canonicalName ||
      (entry.name.startsWith(`${canonicalPrefix}-`) && entry.name.endsWith('.zip'));

    if (matchesSameVersion) {
      const removed = await safeRemove(path.join(releaseDir, entry.name));
      if (!removed) {
        warnings.push(entry.name);
      }
    }
  }

  return { finalZipPath, warnings };
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const baseZipName = `${slugify(manifest.name || 'extension')}-v${manifest.version || '0.0.0'}-store.zip`;
  const canonicalZipPath = path.join(releaseDir, baseZipName);

  await fs.mkdir(releaseDir, { recursive: true });
  await cleanupStagingDirs();
  const { finalZipPath, warnings } = await prepareZipTarget(canonicalZipPath);
  const stagingDir = await copyRequiredFiles();
  createZip(stagingDir, finalZipPath);
  await safeRemove(stagingDir);
  await cleanupStagingDirs();

  console.log(`Store package created: ${finalZipPath}`);
  if (warnings.length > 0) {
    console.warn(`Skipped removing locked ZIP files for the same version: ${warnings.join(', ')}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
