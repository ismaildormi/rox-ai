// ROX AI — lib/requireAdmin.js
//
// requireAuth (lib/auth.js) proves WHO the caller is; this proves they're
// allowed to see admin-only surface (Business Advisor, Auto Optimizer,
// and anything else under /api/v1/admin). Always mount AFTER requireAuth
// — this reads req.userId, which only requireAuth sets from a verified
// token, never from the request itself.
//
// `profiles.is_admin` (13_advisor_optimizer_schema.sql) defaults to
// false for every existing row — this is opt-in per account, set
// manually in the DB (or a future internal tool), never settable by a
// user through any client-facing route.

const { supabaseAdmin } = require('./supabaseAdmin');

async function requireAdmin(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ status: 'error', message: 'Missing authenticated user.' });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', req.userId)
    .single();

  if (error || !data || !data.is_admin) {
    return res.status(403).json({ status: 'error', code: 'admin_required', message: 'Admin access required.' });
  }

  next();
}

module.exports = { requireAdmin };
