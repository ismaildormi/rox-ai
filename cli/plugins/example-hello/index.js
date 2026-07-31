// ROX AI — cli/plugins/example-hello/index.js
//
// Reference plugin. Run `rox hello` (or `rox hello --name=Ada`) to see
// it work, then `rox plugins` to see it listed. Delete this whole
// `example-hello/` folder any time — it's not depended on by anything.
//
// The point being demonstrated: this folder is the ONLY thing that
// exists to add `rox hello` as a real command. cli/rox.js, every file
// under cli/commands/, and every file under cli/lib/ are completely
// unmodified by this plugin existing.
//
// A plugin gets the same shared infrastructure every built-in command
// gets — `log`/`loadEnv` from cli/lib/util.js, `makeGroup` from
// cli/lib/group.js if you want subcommands (`rox hello foo|bar`) —
// because it's just requiring the same files a built-in would.

const { log, getContext } = require('../../lib/util');

module.exports = async function hello(args = []) {
  const nameArg = args.find((a) => a.startsWith('--name='));
  const name = nameArg ? nameArg.split('=')[1] : 'world';

  log.step('ROX AI — hello (plugin)');
  log.ok(`Hello, ${name}! This command came from cli/plugins/example-hello/, not cli/commands/.`);

  const ctx = getContext();
  if (ctx.verbose) {
    log.verbose('Every global flag (--json, --verbose, --timeout, etc.) already works here too — they\'re parsed once in cli/rox.js before any handler, built-in or plugin, ever runs.');
  }
};
