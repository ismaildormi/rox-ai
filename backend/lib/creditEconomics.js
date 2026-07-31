// ROX AI — lib/creditEconomics.js
//
// Connects the credit system to real money, so "is traffic paying for
// itself" becomes a number you can query instead of a hope.
//
// CREDIT_PRICE_USD = how much subscription revenue one credit represents.
// Derive it from your actual plan, not a guess:
//   Pro plan = $20/month for 20,000 credits  =>  CREDIT_PRICE_USD = 20/20000 = 0.001
// Set it in .env as CREDIT_PRICE_USD so it can be updated the moment
// pricing/plan changes, without touching code.

const CREDIT_PRICE_USD = Number(process.env.CREDIT_PRICE_USD || 0.001);

/**
 * @param {number} creditsConsumed - what was charged to the user for this call
 * @param {number} costUsd - estimated real API cost of this call (lib/modelCosts.js)
 * @returns {number} margin in USD — positive means this request was profitable
 *                    on its own, negative means it was a loss even before
 *                    counting fixed server costs.
 */
function marginUsd(creditsConsumed, costUsd) {
  const revenueUsd = creditsConsumed * CREDIT_PRICE_USD;
  return Number((revenueUsd - costUsd).toFixed(6));
}

module.exports = { CREDIT_PRICE_USD, marginUsd };
