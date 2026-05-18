import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path.match(/^\/api\/images\/[^/]+$/) || // Public image serving
    path === '/api/image-proxy' // LINE image proxy
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // 1. Check against static API_KEY (backward compatible)
  if (token === c.env.API_KEY) {
    return next();
  }

  // 2. Check against session token in admin_sessions
  try {
    const session = await c.env.DB.prepare(
      'SELECT s.user_id, s.expires_at FROM admin_sessions s JOIN admin_users u ON s.user_id = u.id WHERE s.token = ? AND u.is_active = 1'
    ).bind(token).first<{ user_id: string; expires_at: string }>();

    if (session && new Date(session.expires_at) > new Date()) {
      // Store user_id in context for downstream route handlers
      c.set('userId', session.user_id);
      return next();
    }
  } catch {
    // If admin_sessions table doesn't exist yet, just fall through
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
