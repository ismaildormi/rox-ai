// ROX AI — src/modules/billing/growth.js
// Extension point for "Referral System" and "Affiliate Program" (flags:
// referral_system, affiliate_program). Grouped under billing because
// both ultimately grant credits or Stripe discounts — they extend the
// existing credit/Stripe machinery (gatekeeper.js, createCheckoutSession.js)
// rather than inventing a parallel currency.
//
// Storage: table `referral_codes` (owner, code, reward_credits) and
// `affiliate_accounts` (see 12_extension_schema.sql).

async function getReferralCode(/* userId */) {
  return null;
}

async function redeemReferralCode(/* code, newUserId */) {
  throw Object.assign(new Error('Referrals are not implemented yet.'), { code: 'not_implemented' });
}

module.exports = { getReferralCode, redeemReferralCode };
