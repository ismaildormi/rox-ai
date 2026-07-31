// ROX AI — src/modules/sdk
// Extension point for "API Access" and "Public SDK" (flags:
// public_api_access, public_sdk). A future public API key is a second
// auth mechanism alongside the existing Supabase session token
// (lib/auth.js) — this module is where a requireApiKey middleware
// would live, checked against table `api_keys` (hashed, never stored
// plaintext — see 12_extension_schema.sql), attaching req.userId the
// same way requireAuth does today so every downstream route (rate
// limiting, gatekeeper, credit ledger) keeps working unchanged
// regardless of which auth path was used.

async function verifyApiKey(/* rawKey */) {
  return null; // no valid key yet — feature not implemented
}

module.exports = { verifyApiKey };
