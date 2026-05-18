import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * Audit logging middleware — records POST/PUT/DELETE actions to audit_logs.
 * Safe: only INSERT, never modifies existing data. If audit_logs table doesn't exist, silently skips.
 */
export async function auditMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Only log write operations
  const method = c.req.method;
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    return next();
  }

  // Skip internal/webhook/auth endpoints
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path.startsWith('/auth/') ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path === '/api/analytics/friend-snapshot'
  ) {
    return next();
  }

  // Execute the actual handler first
  await next();

  // Log after successful response (non-blocking)
  try {
    const userId = c.get('userId') as string | undefined;

    // Determine action name from method + path
    const actionMap: Record<string, string> = {
      POST: 'create',
      PUT: 'update',
      DELETE: 'delete',
    };
    const action = actionMap[method] || method.toLowerCase();

    // Extract resource type from path (e.g., /api/friends/123 → friends)
    const pathParts = path.split('/').filter(Boolean);
    const resourceType = pathParts[1] || 'unknown'; // After 'api'
    const resourceId = pathParts[2] || null;

    // Get user email for readability
    let userEmail = 'api-key-user';
    if (userId) {
      const user = await c.env.DB.prepare('SELECT email FROM admin_users WHERE id = ?').bind(userId).first<{ email: string }>();
      userEmail = user?.email || userId;
    }

    const detail = `${method} ${path}`;
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');

    await c.env.DB.prepare(
      'INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId || 'api-key', userEmail, action, resourceType, resourceId, detail, now).run();
  } catch {
    // Audit logging failure should never break the actual request
  }
}
