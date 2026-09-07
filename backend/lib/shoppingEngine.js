'use strict';

const config = require('../config/chat-system.v1.json');
const { normalizeSource } = require('./sourceContract');

function shoppingError(code) { const error = new Error(code); error.code = code; return error; }

function normalizeProduct(product, index = 0) {
  if (!product || typeof product !== 'object') throw shoppingError('invalid_product');
  const price = Number(product.price);
  const currency = String(product.currency || '').toUpperCase();
  if (!Number.isFinite(price) || price < 0 || !config.shopping.supportedCurrencies.includes(currency)) throw shoppingError('invalid_product_price');
  const source = normalizeSource({ type: 'product', title: product.title, url: product.url, snippet: product.description, id: product.id }, index);
  return Object.freeze({
    id: source.externalId || `product-${index + 1}`,
    title: source.title,
    price,
    currency,
    availability: ['in_stock', 'out_of_stock', 'unknown'].includes(product.availability) ? product.availability : 'unknown',
    seller: String(product.seller || '').slice(0, 160) || null,
    specifications: product.specifications && typeof product.specifications === 'object' ? { ...product.specifications } : {},
    source
  });
}

async function compareProducts({ query, searchProducts, allowExecution = false }) {
  if (allowExecution !== true) throw shoppingError('shopping_disabled');
  if (typeof searchProducts !== 'function') throw shoppingError('shopping_provider_required');
  const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim();
  if (!normalizedQuery || normalizedQuery.length > 500) throw shoppingError('invalid_shopping_query');
  const raw = await searchProducts(normalizedQuery, config.shopping.maxResults);
  const products = (Array.isArray(raw) ? raw : []).slice(0, config.shopping.maxResults).map(normalizeProduct);
  products.sort((a, b) => a.currency.localeCompare(b.currency) || a.price - b.price || a.title.localeCompare(b.title));
  return Object.freeze(products);
}

module.exports = { normalizeProduct, compareProducts };
