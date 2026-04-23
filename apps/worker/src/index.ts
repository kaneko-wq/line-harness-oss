import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { getLineAccounts } from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { authMiddleware } from './middleware/auth.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { auth } from './routes/auth.js';
import { analytics } from './routes/analytics.js';
import { auditMiddleware } from './middleware/audit.js';
import { roleGuard } from './middleware/role-guard.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
  };
};

const app = new Hono<Env>();

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Auth routes (before auth middleware skip)
app.route('/', auth);

// Role-based access control & audit logging (after auth, before routes)
app.use('*', roleGuard);
app.use('*', auditMiddleware);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', openapi);
app.route('/', liffRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', analytics);

// Image upload — 画像をアップロードしてLINE送信用の公開URLを生成
app.post('/api/upload-image', async (c) => {
  try {
    const body = await c.req.json<{ data: string; contentType?: string }>();
    if (!body.data) return c.json({ error: 'Missing image data' }, 400);

    const id = crypto.randomUUID();
    const contentType = body.contentType || 'image/jpeg';

    await c.env.DB.prepare(
      'INSERT INTO uploaded_images (id, data, content_type) VALUES (?, ?, ?)'
    ).bind(id, body.data, contentType).run();

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const imageUrl = `${workerUrl}/api/images/${id}`;

    return c.json({ success: true, data: { id, url: imageUrl } });
  } catch (err) {
    console.error('Upload image error:', err);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// Image serve — アップロード済み画像を公開配信
app.get('/api/images/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT data, content_type FROM uploaded_images WHERE id = ?'
  ).bind(id).first<{ data: string; content_type: string }>();

  if (!row) return c.json({ error: 'Not found' }, 404);

  // base64 → binary
  const binary = Uint8Array.from(atob(row.data), ch => ch.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': row.content_type,
      'Cache-Control': 'public, max-age=604800',
    },
  });
});

// Image proxy — LINE内部ストレージの画像をプロキシ取得
app.get('/api/image-proxy', async (c) => {
  const url = c.req.query('url');
  const token = c.req.query('token');
  if (!url || !token) return c.json({ error: 'Missing url or token' }, 400);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return c.json({ error: 'Failed to fetch image' }, res.status);

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.json({ error: 'Proxy error' }, 500);
  }
});

// Short link: /r/:ref → landing page with LINE open button
app.get('/r/:ref', (c) => {
  const ref = c.req.param('ref');
  const liffUrl = c.env.LIFF_URL || 'https://liff.line.me/2009554425-4IMBmLQ9';
  const target = `${liffUrl}?ref=${encodeURIComponent(ref)}`;

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE Harness</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans',system-ui,sans-serif;background:#0d1117;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{text-align:center;max-width:400px;width:90%;padding:48px 24px}
h1{font-size:28px;font-weight:800;margin-bottom:8px}
.sub{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:40px}
.btn{display:block;width:100%;padding:18px;border:none;border-radius:12px;font-size:18px;font-weight:700;text-decoration:none;text-align:center;color:#fff;background:#06C755;transition:opacity .15s}
.btn:active{opacity:.85}
.note{font-size:12px;color:rgba(255,255,255,0.3);margin-top:24px;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<h1>LINE Harness</h1>
<p class="sub">L社 / U社 の無料代替 OSS</p>
<a href="${target}" class="btn">LINE で体験する</a>
<p class="note">友だち追加するだけで<br>ステップ配信・フォーム・自動返信を体験できます</p>
</div>
</body>
</html>`);
});

// 404 fallback
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

// Scheduled handler for cron triggers — runs for all active LINE accounts
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  // Get all active accounts from DB, plus the default env account
  const dbAccounts = await getLineAccounts(env.DB);
  const activeTokens = new Set<string>();

  // Default account from env
  activeTokens.add(env.LINE_CHANNEL_ACCESS_TOKEN);

  // DB accounts
  for (const account of dbAccounts) {
    if (account.is_active) {
      activeTokens.add(account.channel_access_token);
    }
  }

  // Run delivery for each account
  const jobs = [];
  for (const token of activeTokens) {
    const lineClient = new LineClient(token);
    jobs.push(
      processStepDeliveries(env.DB, lineClient, env.WORKER_URL),
      processScheduledBroadcasts(env.DB, lineClient),
      processReminderDeliveries(env.DB, lineClient),
    );
  }
  jobs.push(checkAccountHealth(env.DB));

  // Daily friend count snapshot
  jobs.push(
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT OR REPLACE INTO friend_snapshots (line_account_id, date, total_count, following_count, blocked_count, created_at)
          SELECT f.line_account_id, ?, COUNT(*), SUM(CASE WHEN f.is_following=1 THEN 1 ELSE 0 END), SUM(CASE WHEN f.is_following=0 THEN 1 ELSE 0 END), ?
          FROM friends f GROUP BY f.line_account_id
        `).bind(today, now).run();
      } catch { /* snapshot failure should not break cron */ }
    })()
  );

  await Promise.allSettled(jobs);
}

export default {
  fetch: app.fetch,
  scheduled,
};
