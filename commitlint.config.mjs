export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    // Off: a subject may start with a name that is spelled with capitals
    // (WebSocket, HAR, Chrome). A squash merge takes the PR title as it is, so
    // the default rule failed CI after the merge, when nothing could be fixed.
    'subject-case': [0],
    'type-enum': [
      2,
      'always',
      [
        'add', // add new files, assets, or dependencies
        'feat', // new feature
        'fix', // bug fix
        'docs', // documentation changes only
        'style', // formatting, missing semicolons, etc. (no logic change)
        'refactor', // code refactor (not a feat or fix)
        'perf', // performance improvement
        'test', // add or update tests
        'chore', // build process, tooling, or dependency updates
        'ci', // CI configuration changes
        'revert', // revert a previous commit
        'build', // build system changes
      ],
    ],
  },
};
