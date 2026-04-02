export default {
  '*.{ts,js,json,md,html,css,yaml,yml}': files => `npx prettier --write ${files.join(' ')}`,
};
