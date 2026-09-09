const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A stand-in for ripgrep, so the search's other half can be run.
 *
 * The search route has two content engines. Which one runs is decided at
 * request time by whether `rg` can be spawned, and the two enforce their bounds
 * in different functions — so a machine without ripgrep runs the fallback and
 * never the code that ships in the image, while CI, which installs ripgrep,
 * runs the opposite half. A guard deleted from either one looks harmless on the
 * machine that does not take that path.
 *
 * This makes the choice explicit instead of ambient. The stand-in answers
 * `--version` so the route takes the ripgrep path, and reports no matches, so
 * whatever the test is about is decided by the route rather than by ripgrep.
 * That is the limit of it: it proves what the route does around ripgrep, never
 * what ripgrep itself finds.
 */

const SCRIPT = `#!/bin/sh
case "$1" in
  --version) echo "ripgrep 14.0.0 (test stand-in)"; exit 0 ;;
esac
exit 1
`;

/**
 * Put the stand-in first on PATH for the duration of a test.
 *
 * @returns {() => void} restores PATH and removes the stand-in
 */
const useFakeRipgrep = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-rg-'));
  const binary = path.join(dir, 'rg');
  fs.writeFileSync(binary, SCRIPT, { mode: 0o755 });

  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${previousPath || ''}`;

  return () => {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  };
};

/** Whether a real ripgrep is installed on this machine. */
const hasRealRipgrep = () => {
  const previousPath = process.env.PATH;
  return (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => {
      try {
        fs.accessSync(path.join(entry, 'rg'), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) && Boolean(previousPath);
};

module.exports = { useFakeRipgrep, hasRealRipgrep };
