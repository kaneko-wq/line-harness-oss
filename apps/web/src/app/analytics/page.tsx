'use client'

import { useState, useEffect } from 'react'
import { useAccount } from '@/contexts/account-context'

interface DashboardData {
  friends: { total: number; active: number; newThisWeek: number }
  messages: { receivedToday: number; sentToday: number }
  scenarios: { active: number }
  recentActivity: Array<{ action: string; user_email: string; resource_type: string; detail: string; created_at: string }>
}

interface TrendPoint {
  date: string
  following_count: number
  account_name: string
}

interface ScoringRule {
  id: string
  name: string
  event_type: string
  score_value: number
  is_active: number
}

interface Permissions {
  role: string
  canEdit: boolean
  canDelete: boolean
  canManageSettings: boolean
}

function fetchApi(path: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
  const token = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''
  return fetch(apiUrl + path, {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  }).then(r => r.json())
}

export default function AnalyticsPage() {
  const { selectedAccountId } = useAccount()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const acctParam = selectedAccountId ? '?lineAccountId=' + selectedAccountId : ''
    Promise.allSettled([
      fetchApi('/api/analytics/dashboard' + acctParam),
      fetchApi('/api/analytics/friend-trends?days=30' + (selectedAccountId ? '&lineAccountId=' + selectedAccountId : '')),
      fetchApi('/api/scoring-rules'),
      fetchApi('/api/users/me/permissions'),
    ]).then(([dashRes, trendRes, rulesRes, permRes]) => {
      if (dashRes.status === 'fulfilled' && dashRes.value.success) setDashboard(dashRes.value.data)
      if (trendRes.status === 'fulfilled' && trendRes.value.success) setTrends(trendRes.value.data)
      if (rulesRes.status === 'fulfilled' && rulesRes.value.success) setRules(rulesRes.value.data)
      if (permRes.status === 'fulfilled' && permRes.value.success) setPermissions(permRes.value.data)
      setLoading(false)
    })
  }, [selectedAccountId])

  if (loading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>

  const maxCount = Math.max(...trends.map(t => t.following_count), 1)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">分析・レポート</h1>
        <p className="text-sm text-gray-500 mt-1">
          {permissions ? 'ロール: ' + permissions.role : ''}
        </p>
      </div>

      {/* KPI カード */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">友だち（有効）</p>
            <p className="text-2xl font-bold" style={{color:'#06C755'}}>{dashboard.friends.active}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">今週の新規追加</p>
            <p className="text-2xl font-bold text-blue-600">+{dashboard.friends.newThisWeek}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">今日の受信</p>
            <p className="text-2xl font-bold text-purple-600">{dashboard.messages.receivedToday}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">今日の送信</p>
            <p className="text-2xl font-bold text-orange-600">{dashboard.messages.sentToday}</p>
          </div>
        </div>
      )}

      {/* 友だち数推移グラフ（CSSバーチャート）*/}
      <div className="bg-white rounded-lg border p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">友だち数推移（過去30日）</h2>
        {trends.length === 0 ? (
          <p className="text-sm text-gray-400">データがまだありません。明日以降に蓄積されます。</p>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {trends.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div
                  className="w-full rounded-t"
                  style={{
                    height: Math.max(4, (t.following_count / maxCount) * 140) + 'px',
                    backgroundColor: '#06C755',
                    opacity: 0.7 + (i / trends.length) * 0.3
                  }}
                  title={t.date + ': ' + t.following_count + '人'}
                />
                {(i === 0 || i === trends.length - 1) && (
                  <p className="text-xs text-gray-400 mt-1">{t.date.slice(5)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* スコアリングルール */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">スコアリングルール</h2>
          {rules.length === 0 ? (
            <p className="text-sm text-gray-400">ルールが設定されていません</p>
          ) : (
            <div className="space-y-2">
              {rules.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.event_type}</p>
                  </div>
                  <span className={'text-sm font-bold ' + (r.score_value >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {r.score_value >= 0 ? '+' : ''}{r.score_value}pt
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 最近の操作ログ */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">最近の操作ログ</h2>
          {!dashboard?.recentActivity?.length ? (
            <p className="text-sm text-gray-400">操作ログはまだありません</p>
          ) : (
            <div className="space-y-2">
              {dashboard.recentActivity.map((log, i) => (
                <div key={i} className="py-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{log.action}</span>
                    <span className="text-xs text-gray-500">{log.user_email}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{log.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
