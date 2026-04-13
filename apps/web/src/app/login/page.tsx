'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        localStorage.setItem('lh_api_key', data.data.token)
        localStorage.setItem('lh_user', JSON.stringify(data.data.user))
        router.push('/')
      } else {
        setError(data.error || '\u30ed\u30b0\u30a4\u30f3\u306b\u5931\u6557\u3057\u307e\u3057\u305f')
      }
    } catch {
      setError('\u63a5\u7d9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">LINE Harness</h1>
          <p className="text-sm text-gray-500 mt-1">\u7ba1\u7406\u753b\u9762\u306b\u30ed\u30b0\u30a4\u30f3</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">\u30d1\u30b9\u30ef\u30fc\u30c9</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="\u30d1\u30b9\u30ef\u30fc\u30c9\u3092\u5165\u529b"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? '\u30ed\u30b0\u30a4\u30f3\u4e2d...' : '\u30ed\u30b0\u30a4\u30f3'}
          </button>
        </form>
      </div>
    </div>
  )
}
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Validate by calling a simple endpoint
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
      const res = await fetch(`${apiUrl}/api/friends/count`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (res.ok) {
        localStorage.setItem('lh_api_key', apiKey)
        // Fetch staff profile for name/role display
        try {
          const profileRes = await fetch(`${apiUrl}/api/staff/me`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          })
          if (profileRes.ok) {
            const profileData = await profileRes.json()
            if (profileData.success && profileData.data) {
              localStorage.setItem('lh_staff_name', profileData.data.name)
              localStorage.setItem('lh_staff_role', profileData.data.role)
            }
          }
        } catch {
          // Profile fetch is best-effort
        }
        router.push('/')
      } else {
        setError('APIキーが正しくありません')
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">LINE Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
