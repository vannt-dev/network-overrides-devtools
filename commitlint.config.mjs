export default {
  extends: ['@commitlint/config-conventional'],
  // The squash merge of #29 (5355258) reached develop with a body line over 100
  // characters. Only a rewrite of develop could change it, so that one message is
  // let through; every other commit is still checked.
  // Dependabot writes release notes into its commit bodies, with lines well over 100
  // characters. Its commits never reach develop as they are (a squash merge writes a
  // new message), so they are let through too.
  ignores: [
    message =>
      message.startsWith(
        'chore(deps): clear the tooling advisories and add a Dependabot config (#29)'
      ),
    message => message.includes('Signed-off-by: dependabot[bot] <support@github.com>'),
  ],
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
