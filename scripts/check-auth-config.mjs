const url = process.env.VITE_SUPABASE_URL?.trim();
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
let validUrl = false;
try {
  const parsed = new URL(url);
  validUrl = parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
} catch {}
if (!validUrl || !key?.startsWith('sb_publishable_')) {
  console.error('Client access is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY as GitHub repository variables before deploying. Only use a publishable key.');
  process.exit(1);
}
console.log('Public authentication configuration is present.');
