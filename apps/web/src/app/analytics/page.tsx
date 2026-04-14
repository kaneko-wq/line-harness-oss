'use client'

import { useState, useEffect } from 'react'
import { useAccount } from '@/contexts/account-context'

interface DashboardData {
  friends: { total: number; active: number; newThisWeek: number }
  messages: { receivedToday: number; sentToday: number }
  scenarios: { active: number }
  recentActivity: { action: string; user_email: string; detail: string; created_at: string }[]
}

interface FriendTrend {
  date: string
  following_count: number
  total_count: number
  account_name: string
}

interface ScoringRule {
  id: string
  name: string
  eventType: string
  scoreValue: number
  isActive: boolean
}

interface Permissions {
  role: string
  canEdit: boolean
  canDelete: boolean
}

function fetchApi(path: string) {
  return fetch('https://line-crm-worker.kaneko-845.workers.dev' + path, {
    headers: {
      'Authorization': 'Bearer ' + (localStorage.getItem('lh_api_key') || ''),
      'Content-Type': 'application/json',
    },
  }).then(r => r.json())
}

export default function AnalyticsPage() {
  const { selectedAccountId } = useAccount()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [trends, setTrends] = useState<FriendTrend[]>([])
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const acctParam = selectedAccountId ? '?lineAccountId=' + selectedAccountId : ''
    const acctParam2 = selectedAccountId ? '&lineAccountId=' + selectedAccountId : ''

    Promise.allSettled([
      fetchApi('/api/analytics/dashboard' + acctParam),
      fetchApi('/api/analytics/friend-trends?days=30' + acctParam2),
      fetchApi('/api/scoring-rules'),
      fetchApi('/api/users/me/permissions'),
    ]).then(([dRes, tRes, sRes, pRes]) => {
      if (dRes.status === 'fulfilled' && dRes.value.success) setDashboard(dRes.value.data)
      if (tRes.status === 'fulfilled' && tRes.value.success) setTrends(tRes.value.data)
      if (sRes.status === 'fulfilled' && sRes.value.success) setRules(sRes.value.data)
      if (pRes.status === 'fulfilled' && pRes.value.success) setPermissions(pRes.value.data)
      setLoading(false)
    })
  }, [selectedAccountId])

  if (loading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>

  const maxFollowing = Math.max(...trends.map(t => t.following_count), 1)

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">分析・レポート</h1>
        <p className="text-sm text-gray-500 mt-1">{permissions ? 'ロール: ' + permissions.role : ''}</p>
      </div>

      {/* KPI Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">友だち（有効）</p>
            <p className="text-2xl font-bold" style={{ color: '#06C755' }}>{dashboard.friends.active}</p>
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

      {/* Friend Trends Chart */}
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
                    height: Math.max(4, (t.following_count / maxFollowing) * 140) + 'px',
                    backgroundColor: '#06C755',
                    opacity: 0.7 + (i / trends.length) * 0.3,
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

      {/* Scoring Rules & Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
                    <p className="text-xs text-gray-400">{r.eventType}</p>
                  </div>
                  <span className={'text-sm font-bold ' + (r.scoreValue >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {r.scoreValue >= 0 ? '+' : ''}{r.scoreValue}pt
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">最近の操作ログ</h2>
          {dashboard?.recentActivity?.length ? (
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
          ) : (
            <p className="text-sm text-gray-400">操作ログはまだありません</p>
          )}
        </div>
      </div>
    </div>
  )
}
