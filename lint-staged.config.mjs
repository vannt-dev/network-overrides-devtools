export default {
  'src/**/*.ts': files => [
    `npx eslint --fix ${files.join(' ')}`,
    `npx prettier --write ${files.join(' ')}`,
  ],
  '*.{js,mjs,cjs,json,md,html,css,yaml,yml}': files => `npx prettier --write ${files.join(' ')}`,
};
