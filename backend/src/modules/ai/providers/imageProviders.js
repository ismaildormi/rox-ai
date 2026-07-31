const Replicate = require('replicate');

const providers = new Map();

function registerImageProvider(key, adapter) {
  if (!key || typeof adapter?.generate !== 'function') {
    throw new Error('Image provider must implement generate(prompt, opts)');
  }

  providers.set(key, {
    label: adapter.label || key,
    generate: adapter.generate,
    isConfigured: adapter.isConfigured || (() => true),
  });
}

function getImageProvider(key) {
  return providers.get(key);
}

function listImageProviders() {
  return [...providers.entries()].map(([key, provider]) => ({
    key,
    label: provider.label,
    configured: Boolean(provider.isConfigured()),
  }));
}

function normalizeOutput(output) {
  if (Array.isArray(output)) return output[0] || null;
  if (typeof output === 'string') return output;

  if (output && typeof output.url === 'function') {
    return output.url();
  }

  if (output?.url) return output.url;
  return null;
}

async function generateImage(prompt, opts = {}) {
  const chain = opts.chain || [
    'fal',
    'huggingface',
    'replicate',
  ];

  const attempts = [];

  for (const providerKey of chain) {
    const provider = getImageProvider(providerKey);

    if (!provider) {
      attempts.push({
        provider: providerKey,
        status: 'skipped',
        error: 'provider_not_registered',
      });
      continue;
    }

    if (!provider.isConfigured()) {
      attempts.push({
        provider: providerKey,
        status: 'skipped',
        error: 'provider_not_configured',
      });
      continue;
    }

    try {
      const startedAt = Date.now();
      const result = await provider.generate(prompt, opts);
      const url = normalizeOutput(result);

      if (!url) {
        throw new Error('provider_returned_no_image_url');
      }

      attempts.push({
        provider: providerKey,
        status: 'success',
        latencyMs: Date.now() - startedAt,
      });

      return {
        url,
        provider: providerKey,
        attempts,
      };
    } catch (error) {
      attempts.push({
        provider: providerKey,
        status: 'error',
        error: error.message,
      });
    }
  }

  const error = new Error('all_image_providers_failed');
  error.code = 'all_image_providers_failed';
  error.attempts = attempts;
  throw error;
}

registerImageProvider('fal', {
  label: 'Fal AI',
  isConfigured: () => Boolean(process.env.FAL_KEY),

  async generate(prompt, opts = {}) {
    const { fal } = await import('@fal-ai/client');

    fal.config({
      credentials: opts.apiKey || process.env.FAL_KEY,
    });

    const model =
      opts.model ||
      process.env.FAL_IMAGE_MODEL ||
      'fal-ai/flux/schnell';

    const result = await fal.subscribe(model, {
      input: {
        prompt,
        num_images: 1,
        ...(opts.input || {}),
      },
      logs: false,
    });

    const url = result?.data?.images?.[0]?.url;

    if (!url) {
      throw new Error('fal_returned_no_image_url');
    }

    return url;
  },
});
registerImageProvider('replicate', {
  label: 'Replicate',
  isConfigured: () => Boolean(process.env.REPLICATE_API_TOKEN),

  async generate(prompt, opts = {}) {
    const replicate = new Replicate({
      auth: opts.apiKey || process.env.REPLICATE_API_TOKEN,
    });

    const model =
      opts.model ||
      process.env.REPLICATE_IMAGE_MODEL ||
      'black-forest-labs/flux-schnell';

    return replicate.run(model, {
      input: {
        prompt,
        ...(opts.input || {}),
      },
    });
  },
});

module.exports = {
  registerImageProvider,
  getImageProvider,
  listImageProviders,
  generateImage,
};