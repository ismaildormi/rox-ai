// ROX AI — cli/lib/progress.js
//
// One progress-bar implementation shared by any command that does
// multi-step or long-running work (backup/restore archiving, setup's
// install steps, disk sweeps). Silences itself automatically under
// --json/--silent or when stdout isn't a TTY (piped/CI/logged output),
// so callers never need their own environment checks.

const { getContext } = require('./util');

function createProgressBar({ total = 100, label = '', width = 28 } = {}) {
  let current = 0;
  const isTTY = Boolean(process.stdout.isTTY);
  let lastPrintedDecile = -1;

  function quiet() {
    const ctx = getContext();
    return ctx.json || ctx.silent;
  }

  function render(force) {
    if (quiet()) return;
    const pct = total > 0 ? Math.min(1, current / total) : 0;

    if (!isTTY) {
      // Non-interactive output (piped, CI, logs): print a plain line
      // every ~10% instead of carriage-return animation, which would
      // otherwise show up as garbage in a log file.
      const decile = Math.floor(pct * 10);
      if (force || decile > lastPrintedDecile) {
        lastPrintedDecile = decile;
        console.log(`${label ? label + ': ' : ''}${Math.round(pct * 100)}%`);
      }
      return;
    }

    const filled = Math.round(width * pct);
    const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
    process.stdout.write(`\r${label ? label + ' ' : ''}[${bar}] ${Math.round(pct * 100)}%`);
  }

  return {
    tick(n = 1) { current += n; render(); },
    set(n) { current = n; render(); },
    finish(msg) {
      current = total;
      render(true);
      if (isTTY && !quiet()) process.stdout.write('\n');
      if (msg) require('./util').log.ok(msg);
    },
  };
}

/** Simple indeterminate spinner for steps with no known total (e.g. "waiting for API…"). */
function createSpinner(label = '') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let timer = null;
  const isTTY = Boolean(process.stdout.isTTY);

  function quiet() {
    const ctx = getContext();
    return ctx.json || ctx.silent || !isTTY;
  }

  return {
    start() {
      if (quiet()) return;
      timer = setInterval(() => {
        process.stdout.write(`\r${frames[i = (i + 1) % frames.length]} ${label}`);
      }, 80);
    },
    stop(msg) {
      if (timer) clearInterval(timer);
      if (!quiet()) process.stdout.write('\r' + ' '.repeat(label.length + 2) + '\r');
      if (msg) require('./util').log.ok(msg);
    },
  };
}

module.exports = { createProgressBar, createSpinner };
