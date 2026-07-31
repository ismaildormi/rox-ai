// ROX AI — Server-side Supabase client
// Uses the SERVICE ROLE key (never expose this key to the browser —
// it bypasses RLS and must only live in server environment variables 
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: WebSocket
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

module.exports = { supabaseAdmin };
