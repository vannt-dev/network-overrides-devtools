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

function stripSourceMapComments(text) {
  return text.replace(/^\/\/# sourceMappingURL=.*(?:\r?\n|$)/gm, '');
}

// The WebSocket wrapper runs inside web pages, so it is shipped as source
// text: a function expression the background evaluates with the rules,
// `(<source>)(rules)`. utils.js goes in with it for pattern matching and
// templates; everything stays inside the function, off the page's globals.
async function buildWebSocketWrapperSource() {
  const parts = [];
  for (const relFile of ['utils.js', 'injected/websocket-wrapper.js']) {
    const text = await fs.readFile(path.join(distDir, relFile), 'utf8');
    parts.push(stripSourceMapComments(text));
  }
  return `(function (rules) {\n${parts.join('\n')}\nNetworkOverridesInjected.install(window, rules);\n})`;
}

async function bundleFiles(fileList, outputFile, filterFn, prefix = '') {
  const contents = prefix ? [prefix] : [];
  for (const relFile of fileList) {
    const filePath = path.join(distDir, relFile);
    let text = await fs.readFile(filePath, 'utf8');
    if (filterFn) {
      text = filterFn(text, relFile);
    }
    text = stripSourceMapComments(text);
    contents.push(`/* --- ${relFile} --- */\n${text}`);
  }
  const bundledContent = contents.join('\n\n');
  await fs.writeFile(path.join(distDir, outputFile), bundledContent, 'utf8');
}

async function main() {
  const wrapperSource = await buildWebSocketWrapperSource();
  await bundleFiles(
    backgroundFiles,
    'background.bundle.js',
    (text, file) => {
      if (file === 'background.js') {
        return text.replace(/importScripts\([\s\S]*?\);?/g, '// importScripts bundled');
      }
      return text;
    },
    `/* --- injected/websocket-wrapper (source text) --- */\nvar NETWORK_OVERRIDES_WS_WRAPPER = ${JSON.stringify(wrapperSource)};`
  );

  await bundleFiles(uiFiles, 'ui.bundle.js');

  // Entrypoints are kept as standalone files, but their generated source maps
  // are removed from release builds below. Avoid leaving broken map references.
  for (const entrypoint of ['devtools.js', 'panel.js', 'popup.js']) {
    const entrypointPath = path.join(distDir, entrypoint);
    const text = await fs.readFile(entrypointPath, 'utf8');
    await fs.writeFile(entrypointPath, stripSourceMapComments(text), 'utf8');
  }

  // Clean up unbundled files and subdirectories so dist only contains essential bundles and entrypoints
  const keepFiles = new Set([
    'background.bundle.js',
    'ui.bundle.js',
    'devtools.js',
    'panel.js',
    'popup.js',
  ]);

  const entries = await fs.readdir(distDir, { withFileTypes: true });
  for (const entry of entries) {
    if (keepFiles.has(entry.name)) continue;
    const entryPath = path.join(distDir, entry.name);
    await fs.rm(entryPath, { recursive: true, force: true });
  }

  console.log('Bundled dist/ and cleaned unbundled files successfully.');
}

main().catch(err => {
  console.error('Bundle error:', err);
  process.exit(1);
});
