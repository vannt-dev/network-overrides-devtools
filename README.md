# network-overrides-devtools
Overrides content

## TypeScript build

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Load extension in Chrome/Edge:
   - packed folder: root with `manifest.json` and `dist/` scripts.
   - `manifest.json` points to `dist/background.js`, `popup.html` and `panel.html` use `dist/` script artifacts.

## Cleanup

Legacy JS files were removed after TypeScript migration:
- `background.js`
- `popup.js`
- `panel.js`
- `devtools.js`

