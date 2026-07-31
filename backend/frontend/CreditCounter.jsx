// ROX AI — Live credit counter + upgrade button.
// npm install @tanstack/react-query @supabase/supabase-js
//
// server.js now requires a verified Supabase session token on every
// route (see lib/auth.js) rather than trusting a userId passed in the
// request body, so handleUpgrade sends the session's access_token as
// a Bearer header instead.

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function CreditCounter({ userId }) {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('credits_used, credits_total, subscription_status')
        .eq('id', userId)
        .single();
      return data;
    },
    refetchInterval: 5000 // keeps the counter live without a manual refresh
  });

  async function handleUpgrade() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = '/login';
      return;
    }

    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const { url } = await res.json();
    window.location.href = url; // redirect to Stripe Checkout
  }

  if (isLoading || !profile) return <div>Chargement...</div>;

  const remaining = profile.credits_total - profile.credits_used;
  const isLow = profile.subscription_status === 'free' && remaining <= profile.credits_total * 0.1;

  return (
    <div>
      <span>{profile.credits_used.toLocaleString()} / {profile.credits_total.toLocaleString()}</span>

      {isLow && (
        <div className="alert-banner">
          <p>Il vous reste peu de crédits — passez au Pro pour continuer sans interruption.</p>
          <button onClick={handleUpgrade}>Passer au Plan Pro 🚀</button>
        </div>
      )}

      {profile.subscription_status === 'free' && !isLow && (
        <button onClick={handleUpgrade}>⭐ Passer au Plan Pro</button>
      )}
    </div>
  );
}
