import { Hono } from 'hono';
import type { Env } from '../index.js';

const auth = new Hono<Env>();

// Utility: SHA-256 hash
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Generate session token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// JST now
function jstNow(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

/**
 * POST /auth/login
 * Body: { email, password }
 * Returns: { success, data: { token, user: { id, email, displayName, role } } }
 */
auth.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json<{ email: string; password: string }>();

    if (!email || !password) {
      return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400);
    }

    const db = c.env.DB;
    const passwordHash = await sha256(password);

    const user = await db.prepare(
      'SELECT id, email, password_hash, display_name, role, is_active FROM admin_users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
      is_active: number;
    }>();

    if (!user) {
      return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
    }

    if (!user.is_active) {
      return c.json({ success: false, error: 'このアカウントは無効です' }, 403);
    }

    if (user.password_hash !== passwordHash) {
      return c.json({ success: false, error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
    }

    // Generate session token
    const token = generateToken();
    const now = jstNow();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
      .toISOString().replace('Z', '+09:00');

    // Create sessions table if not exists and insert
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES admin_users(id)
      )
    `).run();

    await db.prepare(
      'INSERT INTO admin_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(token, user.id, expiresAt, now).run();

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /auth/logout
 * Header: Authorization: Bearer <session_token>
 */
auth.post('/auth/logout', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
    }
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /auth/logout error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /auth/me
 * Returns current user info from session token
 */
auth.get('/auth/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice(7);
    const db = c.env.DB;

    const session = await db.prepare(`
      SELECT s.user_id, s.expires_at, u.id, u.email, u.display_name, u.role
      FROM admin_sessions s
      JOIN admin_users u ON s.user_id = u.id
      WHERE s.token = ? AND u.is_active = 1
    `).bind(token).first<{
      user_id: string;
      expires_at: string;
      id: string;
      email: string;
      display_name: string;
      role: string;
    }>();

    if (!session) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
      return c.json({ success: false, error: 'Session expired' }, 401);
    }

    return c.json({
      success: true,
      data: {
        id: session.id,
        email: session.email,
        displayName: session.display_name,
        role: session.role,
      },
    });
  } catch (err) {
    console.error('GET /auth/me error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { auth };
