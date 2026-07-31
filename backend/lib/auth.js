// ROX AI — lib/auth.js
// Real gap in the original server.js: every route pulled userId straight
// from req.body.userId or the x-user-id header. Anyone could send any
// userId and spend someone else's credits, or read/act on their behalf —
// there was no check that the caller actually IS that user.
//
// Fix: require a Supabase session access token (the one the frontend
// already gets from supabase.auth.getSession()), verify it server-side,
// and take userId from the verified token — never from the request body.
//
// v3.3 addition: every failed verification now also feeds lib/ipGuard.js,
// so an IP burning through stolen/guessed tokens gets temporarily
// blocked instead of being able to retry indefinitely.

const { supabaseAdmin } = require('./supabaseAdmin');
const { recordAuthFailure, clearAuthFailures } = require('./ipGuard');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    await recordAuthFailure(req);
    return res.status(401).json({ status: 'error', message: 'Missing Authorization bearer token.' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    await recordAuthFailure(req);
    return res.status(401).json({ status: 'error', message: 'Invalid or expired session.' });
  }

  await clearAuthFailures(req);
  req.userId = data.user.id; // trustworthy from here on — routes should stop reading userId from req.body
  req.userEmail = data.user.email;
  next();
}

module.exports = { requireAuth };
