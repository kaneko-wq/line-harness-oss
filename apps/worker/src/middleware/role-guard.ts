import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * Role-based access control middleware.
 * - admin: full access
 * - editor: read + write (no delete settings/users)
 * - viewer: read-only (GET only)
 *
 * Safe: only blocks requests, never modifies data.
 * Falls back to allowing if user_line_accounts or admin_users table doesn't exist.
 */
export async function roleGuard(c: Context<Env>, next: Next): Promise<Response | void> {
  const method = c.req.method;

  // GET requests are always allowed
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Skip for non-API paths, auth, webhooks
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path.startsWith('/auth/') ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/)
  ) {
    return next();
  }

  const userId = c.get('userId') as string | undefined;

  // Static API_KEY auth → full access
  if (!userId) {
    return next();
  }

  try {
    const user = await c.env.DB.prepare('SELECT role FROM admin_users WHERE id = ?').bind(userId).first<{ role: string }>();
    const role = user?.role || 'viewer';

    // Viewer can only read
    if (role === 'viewer') {
      return c.json({ success: false, error: 'この操作を行う権限がありません（閲覧専用アカウント）' }, 403);
    }

    // Editor cannot delete settings or manage users
    if (role === 'editor' && method === 'DELETE') {
      if (path.startsWith('/api/line-accounts') || path.startsWith('/api/scoring-rules')) {
        return c.json({ success: false, error: 'この操作にはadmin権限が必要です' }, 403);
      }
    }
  } catch {
    // If table doesn't exist, allow (backward compatible)
  }

  return next();
}
