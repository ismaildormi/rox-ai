// ROX AI — cli/commands/ai/routing.js
//
// Prints the actual fallback chains from aiRouter.js (`ROUTES`), plus
// what getEffectiveChain() will do to them for each load level — the
// same function server.js calls per-request, so this shows real
// behavior, not a paraphrase of it. Options let you check a specific
// scenario without generating traffic:
//   --load=normal|elevated|high   (default: normal)
//   --free                        (simulate a free-tier user; default is pro)

const { log, loadEnv } = require('../../lib/util');
const { loadAiRouter } = require('../../lib/aiBackend');

module.exports = async function routing(args = []) {
  log.step('ROX AI — routing');
  loadEnv();

  const loadArg = args.find((a) => a.startsWith('--load='));
  const loadLevel = loadArg ? loadArg.split('=')[1] : 'normal';
  const isPro = !args.includes('--free');

  if (!['normal', 'elevated', 'high'].includes(loadLevel)) {
    log.err(`Invalid --load value "${loadLevel}" — must be normal, elevated, or high.`);
    process.exitCode = 1;
    return;
  }

  const routerResult = loadAiRouter();
  if (!routerResult.ok) {
    log.err(`Could not load aiRouter.js: ${routerResult.error.message}`);
    log.info('This needs `npm install` to have run in backend/ (bullmq, ioredis, @supabase/supabase-js).');
    process.exitCode = 1;
    return;
  }
  const { ROUTES, getEffectiveChain } = routerResult.module;

  for (const feature of Object.keys(ROUTES)) {
    log.step(`Feature: ${feature}`);
    console.log('  Configured chain (in order):');
    ROUTES[feature].forEach((route, i) => {
      console.log(`    ${i + 1}. ${route.provider} / ${route.model}`);
    });

    const effective = getEffectiveChain(feature, loadLevel, isPro);
    const reordered = effective[0]?.model !== ROUTES[feature][0]?.model;
    console.log(`  Effective chain (load=${loadLevel}, ${isPro ? 'pro' : 'free'} user)${reordered ? ' — REORDERED' : ''}:`);
    effective.forEach((route, i) => {
      console.log(`    ${i + 1}. ${route.provider} / ${route.model}`);
    });
    console.log('');
  }

  log.ok('Run again with --load=high or --free to see how the chain changes for that scenario.');
};
