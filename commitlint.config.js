// Conventional Commits, so semantic-release never silently skips a mistyped commit.
// Length rules are off: run subjects are often long, and Dependabot bodies carry long URLs.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
