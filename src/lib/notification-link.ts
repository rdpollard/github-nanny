// Notification links carry context only: they never establish current idle.
// Keep the URL allowlist aligned with public/sw.js, which runs as a classic worker.
export function notificationRunUrl(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('idle-run');
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash &&
      /^\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/actions\/runs\/[1-9]\d{0,15}\/attempts\/[1-9]\d{0,15}$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
