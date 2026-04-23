import express from 'express'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireSuperAdmin } from '../middleware/rbac.js'
import { parseDomainWhitelist, getEmailDomainWhitelistFromEnv } from '../utils/email-domain-whitelist.js'
import { upsertSystemConfigValue } from '../utils/system-config.js'
import { getTurnstileSettings, getTurnstileSettingsFromEnv, invalidateTurnstileSettingsCache } from '../utils/turnstile-settings.js'
import { getTelegramSettings, getTelegramSettingsFromEnv, invalidateTelegramSettingsCache } from '../utils/telegram-settings.js'
import {
  GLOBAL_PROXY_URLS_CONFIG_KEY,
  getGlobalProxySettings,
  inspectProxyListInput,
  invalidateGlobalProxySettingsCache,
  stringifyProxyUrlEntries,
} from '../utils/proxy.js'
import { CHANNEL_KEY_REGEX, getChannelByKey, getChannels, invalidateChannelsCache, normalizeChannelKey } from '../utils/channels.js'

const router = express.Router()

router.use(authenticateToken, requireSuperAdmin)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseBool = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) return fallback
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized)
}

const buildProxySettingsResponse = (settings) => ({
  proxy: {
    proxyUrls: String(settings?.proxyUrls || ''),
    stored: Boolean(settings?.stored),
    effectiveCount: Number(settings?.effectiveCount || 0) || 0,
  },
})

const normalizeChannelRedeemMode = (value, fallback = 'code') => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['code', 'external-card'].includes(normalized) ? normalized : fallback
}

const normalizeChannelProviderType = (value, fallback = 'local') => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['local', 'custom-http', 'platform-upstream'].includes(normalized) ? normalized : fallback
}

const normalizeUserRow = (row, roles = []) => ({
  id: Number(row[0]),
  username: String(row[1] || ''),
  email: String(row[2] || ''),
  createdAt: row[3],
  inviteCode: row[4] || null,
  invitedByUserId: row[5] || null,
  inviteEnabled: Number(row[6] ?? 1) !== 0,
  roles,
})

const getUserWithRoles = (db, userId) => {
  const userResult = db.exec(
    'SELECT id, username, email, created_at, invite_code, invited_by_user_id, COALESCE(invite_enabled, 1) FROM users WHERE id = ? LIMIT 1',
    [userId]
  )
  const row = userResult[0]?.values?.[0]
  if (!row) return null

  const rolesResult = db.exec(
    `
      SELECT r.role_key, r.role_name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.id ASC
    `,
    [userId]
  )
  const roles = (rolesResult[0]?.values || []).map(roleRow => ({
    roleKey: String(roleRow[0] || ''),
    roleName: String(roleRow[1] || ''),
  }))

  return normalizeUserRow(row, roles)
}

router.get('/email-domain-whitelist', async (req, res) => {
  try {
    const db = await getDatabase()
    const result = db.exec('SELECT config_value FROM system_config WHERE config_key = ? LIMIT 1', ['email_domain_whitelist'])
    const stored = result[0]?.values?.length ? String(result[0].values[0][0] || '') : ''
    const domains = stored ? parseDomainWhitelist(stored) : getEmailDomainWhitelistFromEnv()
    res.json({ domains })
  } catch (error) {
    console.error('Get email-domain-whitelist error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/email-domain-whitelist', async (req, res) => {
  try {
    const domains = parseDomainWhitelist(req.body?.domains)
    const db = await getDatabase()
    upsertSystemConfigValue(db, 'email_domain_whitelist', domains.join(','))
    saveDatabase()
    res.json({ domains })
  } catch (error) {
    console.error('Update email-domain-whitelist error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/turnstile-settings', async (req, res) => {
  try {
    const db = await getDatabase()
    const settings = await getTurnstileSettings(db, { forceRefresh: true })
    res.json({
      turnstile: {
        siteKey: String(settings.siteKey || ''),
        siteKeyStored: Boolean(settings.stored?.siteKey),
        secretSet: Boolean(String(settings.secretKey || '').trim()),
        secretStored: Boolean(settings.stored?.secretKey),
      },
      enabled: Boolean(settings.enabled),
    })
  } catch (error) {
    console.error('Get turnstile-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/turnstile-settings', async (req, res) => {
  try {
    const payload = req.body?.turnstile && typeof req.body.turnstile === 'object' ? req.body.turnstile : (req.body || {})
    const db = await getDatabase()
    const env = getTurnstileSettingsFromEnv()

    const siteKey = String(payload.siteKey ?? env.siteKey ?? '').trim()
    const secretKey = String(payload.secretKey ?? '').trim()

    upsertSystemConfigValue(db, 'turnstile_site_key', siteKey)
    if (secretKey) {
      upsertSystemConfigValue(db, 'turnstile_secret_key', secretKey)
    }

    saveDatabase()
    invalidateTurnstileSettingsCache()

    const updated = await getTurnstileSettings(db, { forceRefresh: true })
    res.json({
      turnstile: {
        siteKey: String(updated.siteKey || ''),
        siteKeyStored: Boolean(updated.stored?.siteKey),
        secretSet: Boolean(String(updated.secretKey || '').trim()),
        secretStored: Boolean(updated.stored?.secretKey),
      },
      enabled: Boolean(updated.enabled),
    })
  } catch (error) {
    console.error('Update turnstile-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/telegram-settings', async (req, res) => {
  try {
    const db = await getDatabase()
    const settings = await getTelegramSettings(db, { forceRefresh: true })
    res.json({
      telegram: {
        allowedUserIds: String(settings.allowedUserIds || ''),
        allowedUserIdsStored: Boolean(settings.stored?.allowedUserIds),
        notifyEnabled: Boolean(settings.notifyEnabled),
        notifyEnabledStored: Boolean(settings.stored?.notifyEnabled),
        notifyChatIds: String(settings.notifyChatIds || ''),
        notifyChatIdsStored: Boolean(settings.stored?.notifyChatIds),
        notifyTimeoutMs: Number(settings.notifyTimeoutMs || 0) || 0,
        notifyTimeoutMsStored: Boolean(settings.stored?.notifyTimeoutMs),
        tokenSet: Boolean(String(settings.token || '').trim()),
        tokenStored: Boolean(settings.stored?.token),
      },
    })
  } catch (error) {
    console.error('Get telegram-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/telegram-settings', async (req, res) => {
  try {
    const payload = req.body?.telegram && typeof req.body.telegram === 'object' ? req.body.telegram : (req.body || {})
    const db = await getDatabase()
    const current = await getTelegramSettings(db, { forceRefresh: true })
    const env = getTelegramSettingsFromEnv()

    const allowedUserIds = String(payload.allowedUserIds ?? current.allowedUserIds ?? '').trim()
    const tokenInput = typeof payload.botToken === 'string'
      ? payload.botToken.trim()
      : (typeof payload.token === 'string' ? payload.token.trim() : '')

    let token = String(current.token || '').trim()
    let shouldUpsertToken = false
    if (tokenInput) {
      token = tokenInput
      shouldUpsertToken = true
    } else if (!current.stored?.token) {
      const envToken = String(env.token || '').trim()
      if (envToken) {
        token = envToken
        shouldUpsertToken = true
      }
    }

    const notifyEnabledInput = payload.notifyEnabled ?? payload.notify_enabled
    let notifyEnabled = Boolean(current.notifyEnabled)
    let shouldUpsertNotifyEnabled = false
    if (notifyEnabledInput !== undefined) {
      notifyEnabled = parseBool(notifyEnabledInput, notifyEnabled)
      shouldUpsertNotifyEnabled = true
    }

    const notifyChatIdsInput = payload.notifyChatIds ?? payload.notify_chat_ids
    const notifyChatIds = notifyChatIdsInput !== undefined ? String(notifyChatIdsInput ?? '').trim() : ''
    const shouldUpsertNotifyChatIds = notifyChatIdsInput !== undefined

    const notifyTimeoutMsInput = payload.notifyTimeoutMs ?? payload.notify_timeout_ms
    let notifyTimeoutMs = Number(current.notifyTimeoutMs || 0) || 8000
    let shouldUpsertNotifyTimeoutMs = false
    if (notifyTimeoutMsInput !== undefined) {
      const parsed = toInt(notifyTimeoutMsInput, Number(env.notifyTimeoutMs || 0) || 8000)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'Invalid telegram notify timeout' })
      }
      notifyTimeoutMs = Math.min(120000, Math.max(1000, parsed))
      shouldUpsertNotifyTimeoutMs = true
    }

    upsertSystemConfigValue(db, 'telegram_allowed_user_ids', allowedUserIds)
    if (shouldUpsertNotifyEnabled) {
      upsertSystemConfigValue(db, 'telegram_notify_enabled', notifyEnabled ? 'true' : 'false')
    }
    if (shouldUpsertNotifyChatIds) {
      upsertSystemConfigValue(db, 'telegram_notify_chat_ids', notifyChatIds)
    }
    if (shouldUpsertNotifyTimeoutMs) {
      upsertSystemConfigValue(db, 'telegram_notify_timeout_ms', String(notifyTimeoutMs))
    }
    if (shouldUpsertToken) {
      upsertSystemConfigValue(db, 'telegram_bot_token', token)
    }

    saveDatabase()
    invalidateTelegramSettingsCache()

    const updated = await getTelegramSettings(db, { forceRefresh: true })
    res.json({
      telegram: {
        allowedUserIds: String(updated.allowedUserIds || ''),
        allowedUserIdsStored: Boolean(updated.stored?.allowedUserIds),
        notifyEnabled: Boolean(updated.notifyEnabled),
        notifyEnabledStored: Boolean(updated.stored?.notifyEnabled),
        notifyChatIds: String(updated.notifyChatIds || ''),
        notifyChatIdsStored: Boolean(updated.stored?.notifyChatIds),
        notifyTimeoutMs: Number(updated.notifyTimeoutMs || 0) || 0,
        notifyTimeoutMsStored: Boolean(updated.stored?.notifyTimeoutMs),
        tokenSet: Boolean(String(updated.token || '').trim()),
        tokenStored: Boolean(updated.stored?.token),
      },
    })
  } catch (error) {
    console.error('Update telegram-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/proxy-settings', async (req, res) => {
  try {
    const db = await getDatabase()
    const settings = await getGlobalProxySettings(db, { forceRefresh: true })
    res.json(buildProxySettingsResponse(settings))
  } catch (error) {
    console.error('Get proxy-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/proxy-settings', async (req, res) => {
  try {
    const proxyUrls = String(req.body?.proxy?.proxyUrls ?? req.body?.proxyUrls ?? '').trim()
    const inspection = inspectProxyListInput(proxyUrls)
    if (inspection.invalidEntries.length > 0) {
      return res.status(400).json({
        error: '代理地址格式不正确',
        invalidEntries: inspection.invalidEntries,
      })
    }

    const db = await getDatabase()
    upsertSystemConfigValue(db, GLOBAL_PROXY_URLS_CONFIG_KEY, stringifyProxyUrlEntries(inspection.entries))
    saveDatabase()
    invalidateGlobalProxySettingsCache()

    const settings = await getGlobalProxySettings(db, { forceRefresh: true })
    res.json(buildProxySettingsResponse(settings))
  } catch (error) {
    console.error('Update proxy-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/proxy-settings/test', async (req, res) => {
  try {
    const proxyUrls = String(req.body?.proxy?.proxyUrls ?? req.body?.proxyUrls ?? '').trim()
    const inspection = inspectProxyListInput(proxyUrls)
    if (inspection.invalidEntries.length > 0) {
      return res.status(400).json({
        error: '代理地址格式不正确',
        invalidEntries: inspection.invalidEntries,
      })
    }

    res.json({
      total: inspection.proxies.length,
      passed: inspection.proxies.length,
      failed: 0,
      results: inspection.proxies.map((proxy) => ({
        proxy: proxy.url,
        ok: true,
        reachable: true,
        status: 200,
        durationMs: 0,
        message: '格式校验通过',
      })),
    })
  } catch (error) {
    console.error('Test proxy-settings error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/rbac/roles', async (req, res) => {
  try {
    const db = await getDatabase()
    const result = db.exec(
      `
        SELECT id, role_key, role_name, COALESCE(description, '')
        FROM roles
        ORDER BY id ASC
      `
    )

    const roles = (result[0]?.values || []).map(row => ({
      id: Number(row[0]),
      roleKey: String(row[1] || ''),
      roleName: String(row[2] || ''),
      description: String(row[3] || ''),
      menuKeys: [],
    }))

    res.json({ roles })
  } catch (error) {
    console.error('Get roles error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/rbac/users', async (req, res) => {
  try {
    const db = await getDatabase()
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10))
    const search = String(req.query.search || '').trim().toLowerCase()

    const conditions = []
    const params = []
    if (search) {
      const keyword = `%${search}%`
      conditions.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(invite_code) LIKE ?)')
      params.push(keyword, keyword, keyword)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const countResult = db.exec(`SELECT COUNT(*) FROM users ${whereClause}`, params)
    const total = Number(countResult[0]?.values?.[0]?.[0] || 0)

    const offset = (page - 1) * pageSize
    const usersResult = db.exec(
      `
        SELECT id, username, email, created_at, invite_code, invited_by_user_id, COALESCE(invite_enabled, 1)
        FROM users
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    )

    const userRows = usersResult[0]?.values || []
    const userIds = userRows.map(row => row[0]).filter(Boolean)
    const rolesByUser = new Map()

    if (userIds.length) {
      const placeholders = userIds.map(() => '?').join(',')
      const rolesResult = db.exec(
        `
          SELECT ur.user_id, r.role_key, r.role_name
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id IN (${placeholders})
          ORDER BY ur.user_id ASC, r.id ASC
        `,
        userIds
      )

      for (const row of rolesResult[0]?.values || []) {
        const userId = Number(row[0])
        const list = rolesByUser.get(userId) || []
        list.push({ roleKey: String(row[1] || ''), roleName: String(row[2] || '') })
        rolesByUser.set(userId, list)
      }
    }

    const users = userRows.map(row => normalizeUserRow(row, rolesByUser.get(Number(row[0])) || []))
    res.json({
      users,
      pagination: { page, pageSize, total },
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/rbac/users/:id/roles', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' })
    }

    const currentUserId = Number(req.user?.id)
    if (Number.isFinite(currentUserId) && currentUserId === userId) {
      return res.status(400).json({ error: '超级管理员不能修改自己的角色' })
    }

    const roleKeys = Array.isArray(req.body?.roleKeys)
      ? req.body.roleKeys.map(String).map(s => s.trim()).filter(Boolean)
      : []
    if (!roleKeys.length) {
      return res.status(400).json({ error: 'roleKeys is required' })
    }

    const db = await getDatabase()
    const uniqueRoleKeys = [...new Set(roleKeys)]
    const placeholders = uniqueRoleKeys.map(() => '?').join(',')
    const rolesResult = db.exec(
      `SELECT id, role_key FROM roles WHERE role_key IN (${placeholders})`,
      uniqueRoleKeys
    )
    const roleIds = (rolesResult[0]?.values || []).map(row => ({ id: Number(row[0]), roleKey: String(row[1] || '') }))
    const found = new Set(roleIds.map(item => item.roleKey))
    const missing = uniqueRoleKeys.filter(key => !found.has(key))
    if (missing.length) {
      return res.status(400).json({ error: 'Unknown roleKeys', missing })
    }

    db.run('DELETE FROM user_roles WHERE user_id = ?', [userId])
    for (const item of roleIds) {
      db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, item.id])
    }
    saveDatabase()

    res.json({ userId, roleKeys: uniqueRoleKeys })
  } catch (error) {
    console.error('Update user roles error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/rbac/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' })
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(body, key)
    const hasUsername = hasOwn('username')
    const hasEmail = hasOwn('email')
    const hasInviteEnabled = hasOwn('inviteEnabled')

    if (!hasUsername && !hasEmail && !hasInviteEnabled) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const db = await getDatabase()
    const updates = []
    const params = []

    if (hasUsername) {
      const username = String(body.username ?? '').trim()
      if (!username) return res.status(400).json({ error: 'username is required' })
      const duplicate = db.exec('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ? LIMIT 1', [username, userId])
      if (duplicate[0]?.values?.length) {
        return res.status(409).json({ error: 'username already exists' })
      }
      updates.push('username = ?')
      params.push(username)
    }

    if (hasEmail) {
      const email = normalizeEmail(body.email)
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: 'Invalid email' })
      }
      const duplicate = db.exec('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ? LIMIT 1', [email, userId])
      if (duplicate[0]?.values?.length) {
        return res.status(409).json({ error: 'email already exists' })
      }
      updates.push('email = ?')
      params.push(email)
    }

    if (hasInviteEnabled) {
      const parsed = parseBool(body.inviteEnabled, true)
      updates.push('invite_enabled = ?')
      params.push(parsed ? 1 : 0)
    }

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, userId])
    saveDatabase()

    const user = getUserWithRoles(db, userId)
    res.json({ user })
  } catch (error) {
    console.error('Update user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/rbac/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' })
    }

    const currentUserId = Number(req.user?.id)
    if (Number.isFinite(currentUserId) && currentUserId === userId) {
      return res.status(400).json({ error: '不能删除当前登录用户' })
    }

    const db = await getDatabase()
    const userResult = db.exec('SELECT username FROM users WHERE id = ? LIMIT 1', [userId])
    const username = userResult[0]?.values?.length ? String(userResult[0].values[0][0] || '') : ''
    if (!username) {
      return res.status(404).json({ error: 'User not found' })
    }
    if (username === 'admin') {
      return res.status(403).json({ error: '不能删除系统默认管理员' })
    }

    db.run('DELETE FROM user_roles WHERE user_id = ?', [userId])
    db.run('UPDATE users SET invited_by_user_id = NULL WHERE invited_by_user_id = ?', [userId])
    db.run('DELETE FROM users WHERE id = ?', [userId])
    saveDatabase()

    res.json({ message: 'deleted' })
  } catch (error) {
    console.error('Delete user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/channels', async (req, res) => {
  try {
    const db = await getDatabase()
    const { list } = await getChannels(db, { forceRefresh: true })
    res.json({ channels: list })
  } catch (error) {
    console.error('[Admin] get channels error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/channels', async (req, res) => {
  try {
    const key = normalizeChannelKey(req.body?.key ?? req.body?.channelKey, '')
    if (!key || !CHANNEL_KEY_REGEX.test(key)) {
      return res.status(400).json({ error: '渠道 key 不合法（仅允许 2-32 位小写字母/数字/连字符）' })
    }

    const name = String(req.body?.name ?? '').trim()
    if (!name) {
      return res.status(400).json({ error: '请输入渠道名称' })
    }

    const redeemMode = normalizeChannelRedeemMode(req.body?.redeemMode ?? req.body?.redeem_mode, 'code')
    let providerType = normalizeChannelProviderType(
      req.body?.providerType ?? req.body?.provider_type,
      redeemMode === 'external-card' ? 'platform-upstream' : 'local'
    )
    if (redeemMode !== 'external-card') {
      providerType = 'local'
    } else if (providerType === 'local') {
      providerType = 'platform-upstream'
    }

    const allowCommonFallback = parseBool(req.body?.allowCommonFallback ?? req.body?.allow_common_fallback, false)
    const isActive = parseBool(req.body?.isActive ?? req.body?.is_active, true)
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder ?? req.body?.sort_order))
      ? Number(req.body?.sortOrder ?? req.body?.sort_order)
      : 0

    const db = await getDatabase()
    const exists = db.exec('SELECT id FROM channels WHERE key = ? LIMIT 1', [key])
    if (exists[0]?.values?.length) {
      return res.status(409).json({ error: '渠道已存在' })
    }

    db.run(
      `
        INSERT INTO channels (
          key, name, redeem_mode, provider_type, allow_common_fallback, allow_downstream_sale, is_active, is_builtin, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))
      `,
      [key, name, redeemMode, providerType, allowCommonFallback ? 1 : 0, isActive ? 1 : 0, sortOrder]
    )
    saveDatabase()
    invalidateChannelsCache()

    const channel = await getChannelByKey(db, key, { forceRefresh: true })
    res.status(201).json({ channel })
  } catch (error) {
    console.error('[Admin] create channel error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/channels/:key', async (req, res) => {
  try {
    const key = normalizeChannelKey(req.params.key, '')
    if (!key || !CHANNEL_KEY_REGEX.test(key)) {
      return res.status(400).json({ error: '渠道 key 不合法' })
    }

    const db = await getDatabase()
    const existingResult = db.exec(
      `
        SELECT key, name, redeem_mode, provider_type, allow_common_fallback, allow_downstream_sale, is_active, is_builtin, sort_order
        FROM channels
        WHERE key = ?
        LIMIT 1
      `,
      [key]
    )
    const existingRow = existingResult[0]?.values?.[0]
    if (!existingRow) {
      return res.status(404).json({ error: '渠道不存在' })
    }

    const updates = []
    const params = []

    if (req.body?.name !== undefined) {
      const name = String(req.body.name ?? '').trim()
      if (!name) return res.status(400).json({ error: '渠道名称不能为空' })
      updates.push('name = ?')
      params.push(name)
    }

    if (req.body?.redeemMode !== undefined || req.body?.redeem_mode !== undefined) {
      const redeemMode = normalizeChannelRedeemMode(req.body?.redeemMode ?? req.body?.redeem_mode, String(existingRow[2] || 'code'))
      updates.push('redeem_mode = ?')
      params.push(redeemMode)
    }

    if (req.body?.providerType !== undefined || req.body?.provider_type !== undefined) {
      const providerType = normalizeChannelProviderType(req.body?.providerType ?? req.body?.provider_type, String(existingRow[3] || 'local'))
      updates.push('provider_type = ?')
      params.push(providerType)
    }

    if (req.body?.allowCommonFallback !== undefined || req.body?.allow_common_fallback !== undefined) {
      const allowCommonFallback = parseBool(req.body?.allowCommonFallback ?? req.body?.allow_common_fallback, false)
      updates.push('allow_common_fallback = ?')
      params.push(allowCommonFallback ? 1 : 0)
    }

    if (req.body?.isActive !== undefined || req.body?.is_active !== undefined) {
      const isActive = parseBool(req.body?.isActive ?? req.body?.is_active, true)
      updates.push('is_active = ?')
      params.push(isActive ? 1 : 0)
    }

    if (req.body?.sortOrder !== undefined || req.body?.sort_order !== undefined) {
      const sortOrder = Number.isFinite(Number(req.body?.sortOrder ?? req.body?.sort_order))
        ? Number(req.body?.sortOrder ?? req.body?.sort_order)
        : 0
      updates.push('sort_order = ?')
      params.push(sortOrder)
    }

    if (!updates.length) {
      const channel = await getChannelByKey(db, key, { forceRefresh: true })
      return res.json({ channel })
    }

    db.run(
      `
        UPDATE channels
        SET ${updates.join(', ')},
            updated_at = DATETIME('now', 'localtime')
        WHERE key = ?
      `,
      [...params, key]
    )
    saveDatabase()
    invalidateChannelsCache()

    const channel = await getChannelByKey(db, key, { forceRefresh: true })
    res.json({ channel })
  } catch (error) {
    console.error('[Admin] update channel error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/channels/:key', async (req, res) => {
  try {
    const key = normalizeChannelKey(req.params.key, '')
    if (!key || !CHANNEL_KEY_REGEX.test(key)) {
      return res.status(400).json({ error: '渠道 key 不合法' })
    }

    const db = await getDatabase()
    const result = db.exec('SELECT is_builtin FROM channels WHERE key = ? LIMIT 1', [key])
    const row = result[0]?.values?.[0]
    if (!row) {
      return res.status(404).json({ error: '渠道不存在' })
    }
    if (Number(row[0] || 0) === 1) {
      return res.status(400).json({ error: '内置渠道不可删除' })
    }

    db.run('DELETE FROM channels WHERE key = ?', [key])
    saveDatabase()
    invalidateChannelsCache()
    res.json({ ok: true })
  } catch (error) {
    console.error('[Admin] delete channel error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
