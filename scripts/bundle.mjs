import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');

const backgroundFiles = [
  'utils.js',
  'shared.js',
  'tab-state.js',
  'background/encoding.js',
  'background/api-capture.js',
  'background/interceptor.js',
  'background/debugger-controller.js',
  'background/message-router.js',
  'background.js',
];

const uiFiles = [
  'utils.js',
  'shared.js',
  'ui/types.js',
  'ui/view-utils.js',
  'ui/primitives.js',
  'ui/notifications.js',
  'ui/dialogs.js',
  'ui/persistence.js',
  'ui/attach-status.js',
  'ui/curl.js',
  'ui/swagger.js',
  'ui/har.js',
  'ui/headers-editor.js',
  'ui/modal.js',
  'ui/rules-list.js',
  'ui/api-list.js',
  'ui/profiles.js',
  'ui/modal-controller.js',
  'ui/rules-io-controller.js',
  'ui/toolbar-controller.js',
  'ui.js',
];

async function bundleFiles(fileList, outputFile, filterFn) {
  const contents = [];
  for (const relFile of fileList) {
    const filePath = path.join(distDir, relFile);
    let text = await fs.readFile(filePath, 'utf8');
    if (filterFn) {
      text = filterFn(text, relFile);
    }
    contents.push(`/* --- ${relFile} --- */\n${text}`);
  }
  const bundledContent = contents.join('\n\n');
  await fs.writeFile(path.join(distDir, outputFile), bundledContent, 'utf8');
}

async function main() {
  await bundleFiles(backgroundFiles, 'background.bundle.js', (text, file) => {
    if (file === 'background.js') {
      return text.replace(/importScripts\([\s\S]*?\);?/g, '// importScripts bundled');
    }
    return text;
  });

  await bundleFiles(uiFiles, 'ui.bundle.js');

  console.log('Bundled dist/background.bundle.js and dist/ui.bundle.js successfully.');
}

main().catch(err => {
  console.error('Bundle error:', err);
  process.exit(1);
});
