const { createClient } = require('@supabase/supabase-js');

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  const parts = typeof key === 'string' ? key.split('.') : [];
  if (parts.length >= 2) {
    try {
      const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson);
      if (payload?.role && payload.role !== 'service_role') return null;
    } catch {
      return null;
    }
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

module.exports = { createSupabaseClient };
