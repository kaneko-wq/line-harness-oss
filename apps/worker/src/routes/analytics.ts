import { Hono } from 'hono';
import type { Env } from '../index.js';

const analytics = new Hono<Env>();

// ============================================================
// 1. 操作ログ (Audit Logs)
// ============================================================

// GET /api/audit-logs - 操作ログ一覧
analytics.get('/api/audit-logs', async (c) => {
  try {
    const db = c.env.DB;
    const limit = Number(c.req.query('limit') || '50');
    const offset = Number(c.req.query('offset') || '0');
    const userId = c.req.query('userId');
    const action = c.req.query('action');

    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const binds: (string | number)[] = [];

    if (userId) { sql += ' AND user_id = ?'; binds.push(userId); }
    if (action) { sql += ' AND action = ?'; binds.push(action); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    binds.push(limit, offset);

    const result = await db.prepare(sql).bind(...binds).all();

    const countSql = 'SELECT COUNT(*) as total FROM audit_logs';
    const countResult = await db.prepare(countSql).first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        items: result.results || [],
        total: countResult?.total ?? 0,
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error('GET /api/audit-logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================
// 2. 友だち数推移 (Friend Count Trends)
// ============================================================

// GET /api/analytics/friend-trends - 友だち数推移データ
analytics.get('/api/analytics/friend-trends', async (c) => {
  try {
    const db = c.env.DB;
    const lineAccountId = c.req.query('lineAccountId');
    const days = Number(c.req.query('days') || '30');

    let sql = `
      SELECT fs.date, fs.total_count, fs.following_count, fs.blocked_count, la.name as account_name
      FROM friend_snapshots fs
      JOIN line_accounts la ON fs.line_account_id = la.id
      WHERE fs.date >= date('now', '-' || ? || ' days')
    `;
    const binds: (string | number)[] = [days];

    if (lineAccountId) {
      sql += ' AND fs.line_account_id = ?';
      binds.push(lineAccountId);
    }

    sql += ' ORDER BY fs.date ASC, la.name ASC';

    const result = await db.prepare(sql).bind(...binds).all();
    return c.json({ success: true, data: result.results || [] });
  } catch (err) {
    console.error('GET /api/analytics/friend-trends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/analytics/friend-snapshot - 手動スナップショット取得（cronでも呼ぶ）
analytics.post('/api/analytics/friend-snapshot', async (c) => {
  try {
    const db = c.env.DB;
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const result = await db.prepare(`
      INSERT OR REPLACE INTO friend_snapshots (line_account_id, date, total_count, following_count, blocked_count, created_at)
      SELECT f.line_account_id, ?, COUNT(*), SUM(CASE WHEN f.is_following=1 THEN 1 ELSE 0 END), SUM(CASE WHEN f.is_following=0 THEN 1 ELSE 0 END), ?
      FROM friends f GROUP BY f.line_account_id
    `).bind(today, now).run();

    return c.json({ success: true, data: { date: today, changes: result.meta?.changes ?? 0 } });
  } catch (err) {
    console.error('POST /api/analytics/friend-snapshot error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================
// 3. 流入経路分析 (Traffic Source Analytics)
// ============================================================

// GET /api/analytics/traffic-sources - 流入経路集計
analytics.get('/api/analytics/traffic-sources', async (c) => {
  try {
    const db = c.env.DB;
    const days = Number(c.req.query('days') || '30');

    // affiliatesテーブルからクリック数を集計
    const result = await db.prepare(`
      SELECT
        a.id,
        a.name,
        a.code,
        COUNT(ac.id) as click_count,
        COUNT(DISTINCT ac.ip_address) as unique_clicks,
        MIN(ac.created_at) as first_click,
        MAX(ac.created_at) as last_click
      FROM affiliates a
      LEFT JOIN affiliate_clicks ac ON a.id = ac.affiliate_id
        AND ac.created_at >= datetime('now', '-' || ? || ' days')
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY click_count DESC
    `).bind(days).all();

    // 友だち追加時のref_codeから流入元ごとの友だち数を取得
    const friendsByRef = await db.prepare(`
      SELECT
        a.name as source_name,
        a.code as ref_code,
        COUNT(f.id) as friend_count
      FROM friends f
      JOIN affiliates a ON f.user_id = a.code
      WHERE f.created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY a.code
      ORDER BY friend_count DESC
    `).bind(days).all();

    return c.json({
      success: true,
      data: {
        sources: result.results || [],
        friendsBySource: friendsByRef.results || [],
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/traffic-sources error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================
// 4. スコアリングルール管理
// ============================================================

// GET /api/scoring-rules - ルール一覧
analytics.get('/api/scoring-rules', async (c) => {
  try {
    const db = c.env.DB;
    const result = await db.prepare('SELECT * FROM scoring_rules ORDER BY created_at ASC').all();
    return c.json({ success: true, data: result.results || [] });
  } catch (err) {
    console.error('GET /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scoring-rules - ルール追加
analytics.post('/api/scoring-rules', async (c) => {
  try {
    const db = c.env.DB;
    const body = await c.req.json<{ name: string; eventType: string; scoreValue: number }>();

    if (!body.name || !body.eventType || body.scoreValue === undefined) {
      return c.json({ success: false, error: 'name, eventType, scoreValue are required' }, 400);
    }

    const id = 'sr_' + crypto.randomUUID().slice(0, 8);
    await db.prepare(
      'INSERT INTO scoring_rules (id, name, event_type, score_value, is_active) VALUES (?, ?, ?, ?, 1)'
    ).bind(id, body.name, body.eventType, body.scoreValue).run();

    return c.json({ success: true, data: { id, name: body.name, event_type: body.eventType, score_value: body.scoreValue } }, 201);
  } catch (err) {
    console.error('POST /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/scoring-rules/:id - ルール更新
analytics.put('/api/scoring-rules/:id', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; eventType?: string; scoreValue?: number; isActive?: boolean }>();

    const sets: string[] = [];
    const binds: (string | number)[] = [];

    if (body.name !== undefined) { sets.push('name = ?'); binds.push(body.name); }
    if (body.eventType !== undefined) { sets.push('event_type = ?'); binds.push(body.eventType); }
    if (body.scoreValue !== undefined) { sets.push('score_value = ?'); binds.push(body.scoreValue); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }

    if (sets.length === 0) {
      return c.json({ success: false, error: 'No fields to update' }, 400);
    }

    sets.push("updated_at = datetime('now', '+9 hours')");
    binds.push(id);

    await db.prepare(`UPDATE scoring_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ success: true, data: { id } });
  } catch (err) {
    console.error('PUT /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/scoring-rules/:id - ルール削除
analytics.delete('/api/scoring-rules/:id', async (c) => {
  try {
    const db = c.env.DB;
    await db.prepare('DELETE FROM scoring_rules WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================
// 5. ダッシュボード統計 (Dashboard Stats)
// ============================================================

// GET /api/analytics/dashboard - ダッシュボード用集計データ
analytics.get('/api/analytics/dashboard', async (c) => {
  try {
    const db = c.env.DB;
    const lineAccountId = c.req.query('lineAccountId');

    const accountFilter = lineAccountId ? ' AND f.line_account_id = ?' : '';
    const accountFilterDirect = lineAccountId ? ' AND line_account_id = ?' : '';
    const binds = lineAccountId ? [lineAccountId] : [];

    // 友だち数
    const friends = await db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_following=1 THEN 1 ELSE 0 END) as active FROM friends f WHERE 1=1${accountFilter}`
    ).bind(...binds).first<{ total: number; active: number }>();

    // 今日のメッセージ数
    const todayMsgs = await db.prepare(
      `SELECT
        SUM(CASE WHEN ml.direction='incoming' THEN 1 ELSE 0 END) as received,
        SUM(CASE WHEN ml.direction='outgoing' THEN 1 ELSE 0 END) as sent
      FROM messages_log ml
      JOIN friends f ON ml.friend_id = f.id
      WHERE ml.created_at >= date('now')${accountFilter}`
    ).bind(...binds).first<{ received: number; sent: number }>();

    // 今週の友だち追加数
    const newFriends = await db.prepare(
      `SELECT COUNT(*) as count FROM friends f WHERE f.created_at >= date('now', '-7 days')${accountFilter}`
    ).bind(...binds).first<{ count: number }>();

    // アクティブシナリオ数
    const activeScenarios = await db.prepare(
      `SELECT COUNT(DISTINCT fs.scenario_id) as count
       FROM friend_scenarios fs
       JOIN friends f ON fs.friend_id = f.id
       WHERE fs.status = 'active'${accountFilter}`
    ).bind(...binds).first<{ count: number }>();

    // 直近の操作ログ（5件）
    const recentLogs = await db.prepare(
      'SELECT action, user_email, resource_type, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5'
    ).all();

    return c.json({
      success: true,
      data: {
        friends: {
          total: friends?.total ?? 0,
          active: friends?.active ?? 0,
          newThisWeek: newFriends?.count ?? 0,
        },
        messages: {
          receivedToday: todayMsgs?.received ?? 0,
          sentToday: todayMsgs?.sent ?? 0,
        },
        scenarios: {
          active: activeScenarios?.count ?? 0,
        },
        recentActivity: recentLogs.results || [],
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/dashboard error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================
// 6. 権限チェック用エンドポイント
// ============================================================

// GET /api/users/me/permissions - 現在のユーザーの権限
analytics.get('/api/users/me/permissions', async (c) => {
  try {
    const db = c.env.DB;
    const userId = c.get('userId') as string | undefined;

    if (!userId) {
      // 静的APIキー認証の場合は全権限
      return c.json({
        success: true,
        data: { role: 'admin', canEdit: true, canDelete: true, canManageSettings: true, canManageUsers: true },
      });
    }

    const user = await db.prepare('SELECT role FROM admin_users WHERE id = ?').bind(userId).first<{ role: string }>();
    const role = user?.role || 'viewer';

    const permissions = {
      role,
      canEdit: role === 'admin' || role === 'editor',
      canDelete: role === 'admin',
      canManageSettings: role === 'admin',
      canManageUsers: role === 'admin',
    };

    return c.json({ success: true, data: permissions });
  } catch (err) {
    console.error('GET /api/users/me/permissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { analytics };
