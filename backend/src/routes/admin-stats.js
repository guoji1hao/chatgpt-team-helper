import express from 'express'
import { getDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireSuperAdmin } from '../middleware/rbac.js'

const router = express.Router()

router.use(authenticateToken, requireSuperAdmin)

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/
const ACCOUNT_CAPACITY = 6

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const formatLocalDateOnly = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const resolveDateRange = (query) => {
  const today = formatLocalDateOnly(new Date())
  const rawFrom = String(query?.from ?? '').trim()
  const rawTo = String(query?.to ?? '').trim()

  const from = DATE_ONLY_REGEX.test(rawFrom) ? rawFrom : today
  const to = DATE_ONLY_REGEX.test(rawTo) ? rawTo : today

  if (from > to) {
    return { ok: false, error: '`from` must be <= `to`' }
  }

  const maxDays = 366
  const maxDaysLimit = Math.max(1, toInt(query?.maxDays, maxDays))
  if (maxDaysLimit > 0) {
    const start = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
    if (diffDays > maxDaysLimit) {
      return { ok: false, error: `date range too large (max ${maxDaysLimit} days)` }
    }
  }

  return { ok: true, from, to }
}

router.get('/overview', async (req, res) => {
  const range = resolveDateRange(req.query)
  if (!range.ok) {
    return res.status(400).json({ error: range.error })
  }

  try {
    const db = await getDatabase()
    const { from, to } = range

    const scalar = (sql, params = []) => {
      const result = db.exec(sql, params)
      const value = result?.[0]?.values?.[0]?.[0]
      return value == null ? 0 : Number(value)
    }

    const userColumns = new Set((db.exec('PRAGMA table_info(users)')[0]?.values || []).map(row => String(row[1] || '')))
    const hasInviteEnabled = userColumns.has('invite_enabled')

    const usersTotal = scalar('SELECT COUNT(*) FROM users')
    const usersCreated = scalar(
      `SELECT COUNT(*) FROM users WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)`,
      [from, to]
    )
    const usersInviteEnabled = hasInviteEnabled
      ? scalar(`SELECT COUNT(*) FROM users WHERE COALESCE(invite_enabled, 0) != 0`)
      : 0

    const accountsTotal = scalar('SELECT COUNT(*) FROM gpt_accounts')
    const accountsOpen = scalar(`SELECT COUNT(*) FROM gpt_accounts WHERE COALESCE(is_open, 0) = 1`)
    const accountsBanned = scalar(`SELECT COUNT(*) FROM gpt_accounts WHERE COALESCE(is_banned, 0) = 1`)
    const accountsExpiringSoon = scalar(
      `
        SELECT COUNT(*)
        FROM gpt_accounts
        WHERE NULLIF(TRIM(COALESCE(expire_at, '')), '') IS NOT NULL
          AND DATETIME(expire_at) >= DATETIME('now', 'localtime')
          AND DATETIME(expire_at) <= DATETIME('now', 'localtime', '+7 days')
      `
    )
    const usedSeats = scalar(`SELECT COALESCE(SUM(COALESCE(user_count, 0)), 0) FROM gpt_accounts`)
    const invitePending = scalar(`SELECT COALESCE(SUM(COALESCE(invite_count, 0)), 0) FROM gpt_accounts`)
    const totalSeats = accountsTotal * ACCOUNT_CAPACITY
    const seatUtilization = totalSeats > 0 ? usedSeats / totalSeats : 0
    const openAccountsOverCapacity = scalar(
      `
        SELECT COUNT(*)
        FROM gpt_accounts
        WHERE COALESCE(is_open, 0) = 1
          AND COALESCE(is_banned, 0) = 0
          AND COALESCE(user_count, 0) > ?
      `,
      [ACCOUNT_CAPACITY]
    )

    const codesTotal = scalar('SELECT COUNT(*) FROM redemption_codes')
    const codesUnused = scalar(`SELECT COUNT(*) FROM redemption_codes WHERE COALESCE(is_redeemed, 0) = 0`)
    const codesRedeemed = scalar(`SELECT COUNT(*) FROM redemption_codes WHERE COALESCE(is_redeemed, 0) = 1`)
    const codesCreated = scalar(
      `SELECT COUNT(*) FROM redemption_codes WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)`,
      [from, to]
    )
    const codesRedeemedInRange = scalar(
      `SELECT COUNT(*) FROM redemption_codes WHERE COALESCE(is_redeemed, 0) = 1 AND DATE(redeemed_at) BETWEEN DATE(?) AND DATE(?)`,
      [from, to]
    )

    const codesByChannelResult = db.exec(
      `
        SELECT
          COALESCE(NULLIF(TRIM(channel), ''), 'common') AS channel,
          COUNT(*) AS total,
          SUM(CASE WHEN COALESCE(is_redeemed, 0) = 0 THEN 1 ELSE 0 END) AS unused,
          SUM(CASE WHEN COALESCE(is_redeemed, 0) = 1 THEN 1 ELSE 0 END) AS redeemed
        FROM redemption_codes
        GROUP BY COALESCE(NULLIF(TRIM(channel), ''), 'common')
        ORDER BY total DESC, channel ASC
      `
    )
    const byChannel = (codesByChannelResult?.[0]?.values || []).map(row => ({
      channel: String(row[0] || 'common'),
      total: Number(row[1] || 0),
      unused: Number(row[2] || 0),
      redeemed: Number(row[3] || 0),
    }))

    const recentRedeemsResult = db.exec(
      `
        SELECT code, redeemed_by, account_email, COALESCE(NULLIF(TRIM(channel), ''), 'common') AS channel, redeemed_at
        FROM redemption_codes
        WHERE COALESCE(is_redeemed, 0) = 1
        ORDER BY DATETIME(COALESCE(redeemed_at, updated_at, created_at)) DESC
        LIMIT 10
      `
    )
    const recentRedeems = (recentRedeemsResult?.[0]?.values || []).map(row => ({
      code: String(row[0] || ''),
      redeemedBy: row[1] ? String(row[1]) : null,
      accountEmail: row[2] ? String(row[2]) : null,
      channel: String(row[3] || 'common'),
      redeemedAt: row[4] ? String(row[4]) : null,
    }))

    res.json({
      range: { from, to },
      users: {
        total: usersTotal,
        created: usersCreated,
        inviteEnabled: usersInviteEnabled,
      },
      gptAccounts: {
        total: accountsTotal,
        open: accountsOpen,
        banned: accountsBanned,
        expiringSoon: accountsExpiringSoon,
        usedSeats,
        totalSeats,
        seatUtilization,
        invitePending,
        openAccountsOverCapacity,
      },
      redemptionCodes: {
        total: codesTotal,
        unused: codesUnused,
        redeemed: codesRedeemed,
        created: codesCreated,
        redeemedInRange: codesRedeemedInRange,
        byChannel,
      },
      recentRedeems,
    })
  } catch (error) {
    console.error('[Admin Stats] overview error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
