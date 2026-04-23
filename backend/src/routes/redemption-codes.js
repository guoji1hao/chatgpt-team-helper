import express from 'express'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireMenu } from '../middleware/rbac.js'
import { fetchAccountUsersList, syncAccountInviteCount, syncAccountUserCount } from '../services/account-sync.js'
import { inviteUserToChatGPTTeam } from '../services/chatgpt-invite.js'
import { withLocks } from '../utils/locks.js'
import { getChannels, normalizeChannelKey } from '../utils/channels.js'

const router = express.Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
const DEFAULT_ACCOUNT_CAPACITY = 5
const FULFILLMENT_MODE_INTERNAL = 'internal_invite'
const FULFILLMENT_MODE_EXTERNAL = 'external_api'

const normalizeChannel = (value, fallback = 'common') => normalizeChannelKey(value, fallback)
const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()
const normalizeOrderType = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'no_warranty' ? 'no_warranty' : 'warranty'
}

export class RedemptionError extends Error {
  constructor(statusCode, message, payload = {}) {
    super(message)
    this.statusCode = statusCode
    this.payload = payload
  }
}

function generateRedemptionCode(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
    if ((i + 1) % 4 === 0 && i < length - 1) {
      code += '-'
    }
  }
  return code
}

const mapCodeRow = (row, channelsByKey) => {
  if (!row) return null
  const channel = normalizeChannel(row[6], 'common')
  const channelName = String(row[7] || '').trim() || channelsByKey.get(channel)?.name || channel
  return {
    id: Number(row[0]),
    code: String(row[1] || ''),
    isRedeemed: Number(row[2] || 0) === 1,
    redeemedAt: row[3] || null,
    redeemedBy: row[4] || null,
    accountEmail: row[5] || null,
    channel,
    channelName,
    createdAt: row[8] || null,
    updatedAt: row[9] || null,
    fulfillmentMode: String(row[10] || FULFILLMENT_MODE_INTERNAL),
    supplierName: row[11] || null,
    supplierType: row[12] || null,
    supplierRequestId: row[13] || null,
    supplierStatus: row[14] || null,
    supplierResponseCode: row[15] || null,
    supplierResponseMessage: row[16] || null,
    supplierRedeemedAt: row[17] || null,
  }
}

const getChannelRegistry = async (db) => {
  const { byKey } = await getChannels(db)
  return byKey
}

const findAvailableAccount = async (db, { accountEmail, channel, allowNonOpenAccount = false } = {}) => {
  const params = []
  let whereClause = 'WHERE COALESCE(is_banned, 0) = 0'

  if (accountEmail) {
    whereClause += ' AND lower(trim(email)) = ?'
    params.push(normalizeEmail(accountEmail))
  } else if (!allowNonOpenAccount) {
    whereClause += ' AND COALESCE(is_open, 0) = 1'
  }

  const result = db.exec(
    `
      SELECT id, email, token, COALESCE(user_count, 0), chatgpt_account_id, oai_device_id,
             client_profile_key, client_user_agent, client_accept_language, client_oai_language,
             expire_at, COALESCE(invite_count, 0), COALESCE(is_open, 0), COALESCE(is_banned, 0), remark, created_at, updated_at
      FROM gpt_accounts
      ${whereClause}
      ORDER BY COALESCE(user_count, 0) + COALESCE(invite_count, 0) ASC, created_at DESC
    `,
    params
  )

  const rows = result[0]?.values || []
  for (const row of rows) {
    const userCount = Number(row[3] || 0)
    const inviteCount = Number(row[11] || 0)
    const isOpen = Number(row[12] || 0) === 1
    const isBanned = Number(row[13] || 0) === 1
    if (isBanned) continue
    if (!accountEmail && !allowNonOpenAccount && !isOpen) continue
    if (userCount + inviteCount >= DEFAULT_ACCOUNT_CAPACITY) continue
    return {
      id: Number(row[0]),
      email: String(row[1] || ''),
      token: String(row[2] || ''),
      userCount,
      chatgptAccountId: String(row[4] || ''),
      oaiDeviceId: String(row[5] || ''),
      clientProfileKey: String(row[6] || ''),
      clientUserAgent: String(row[7] || ''),
      clientAcceptLanguage: String(row[8] || ''),
      clientOaiLanguage: String(row[9] || ''),
      expireAt: row[10] || null,
      inviteCount,
      isOpen,
      isBanned,
      remark: row[14] || null,
      createdAt: row[15] || null,
      updatedAt: row[16] || null,
      channel,
    }
  }

  return null
}

const syncAccountUsageSnapshot = async (accountId) => {
  const userSync = await syncAccountUserCount(accountId)
  const inviteSync = await syncAccountInviteCount(accountId, {
    accountRecord: userSync.account,
    inviteListParams: { offset: 0, limit: 1, query: '' },
  })
  return {
    account: inviteSync.account,
    userCount: userSync.syncedUserCount,
    inviteCount: inviteSync.inviteCount,
  }
}

const performInternalInviteRedemption = async ({ db, codeId, email, codeRecord, account, orderType }) => {
  const redeemerIdentifier = normalizeEmail(email)

  db.run(
    `
      UPDATE redemption_codes
      SET is_redeemed = 1,
          redeemed_at = DATETIME('now', 'localtime'),
          redeemed_by = ?,
          account_email = ?,
          order_type = ?,
          fulfillment_mode = ?,
          supplier_status = NULL,
          supplier_response_message = NULL,
          updated_at = DATETIME('now', 'localtime')
      WHERE id = ? AND COALESCE(is_redeemed, 0) = 0
    `,
    [redeemerIdentifier, account.email, orderType, FULFILLMENT_MODE_INTERNAL, codeId]
  )

  if (typeof db.getRowsModified === 'function' && db.getRowsModified() === 0) {
    throw new RedemptionError(400, '该兑换码已被使用')
  }

  saveDatabase()

  const inviteResult = await inviteUserToChatGPTTeam(email, account)
  if (!inviteResult.success) {
    throw new RedemptionError(503, inviteResult.error || '发送邀请失败')
  }

  const synced = await syncAccountUsageSnapshot(account.id)
  return {
    message: '兑换成功，请查收邀请邮件',
    email,
    code: codeRecord.code,
    accountEmail: account.email,
    userCount: synced.userCount,
    inviteCount: synced.inviteCount,
    inviteStatus: '已发送邀请',
    fulfillmentMode: FULFILLMENT_MODE_INTERNAL,
    redeemedAt: new Date().toISOString(),
  }
}

const performExternalRedemption = async ({ db, codeId, email, codeRecord, requestedChannelConfig }) => {
  const requestId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  db.run(
    `
      UPDATE redemption_codes
      SET is_redeemed = 1,
          redeemed_at = DATETIME('now', 'localtime'),
          redeemed_by = ?,
          order_type = 'warranty',
          fulfillment_mode = ?,
          supplier_name = ?,
          supplier_type = ?,
          supplier_request_id = ?,
          supplier_status = 'success',
          supplier_response_message = ?,
          supplier_redeemed_at = DATETIME('now', 'localtime'),
          updated_at = DATETIME('now', 'localtime')
      WHERE id = ? AND COALESCE(is_redeemed, 0) = 0
    `,
    [
      normalizeEmail(email),
      FULFILLMENT_MODE_EXTERNAL,
      requestedChannelConfig.name || requestedChannelConfig.key,
      requestedChannelConfig.providerType || 'platform-upstream',
      requestId,
      '卡密兑换请求已记录',
      codeId,
    ]
  )

  if (typeof db.getRowsModified === 'function' && db.getRowsModified() === 0) {
    throw new RedemptionError(400, '该兑换码已被使用')
  }

  saveDatabase()

  return {
    message: '卡密已提交并完成兑换。',
    email,
    code: codeRecord.code,
    fulfillmentMode: FULFILLMENT_MODE_EXTERNAL,
    supplierName: requestedChannelConfig.name || requestedChannelConfig.key,
    supplierStatus: 'success',
    redeemedAt: new Date().toISOString(),
  }
}

export async function redeemCodeInternal({
  email,
  code,
  channel = 'common',
  orderType,
  allowCommonChannelFallback = true,
  allowNonOpenAccount = false,
}) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    throw new RedemptionError(400, '请输入邮箱地址')
  }
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new RedemptionError(400, '请输入有效的邮箱地址')
  }

  const normalizedCode = String(code || '').trim().toUpperCase()
  if (!normalizedCode) {
    throw new RedemptionError(400, '请输入兑换码')
  }
  if (!CODE_REGEX.test(normalizedCode)) {
    throw new RedemptionError(400, '兑换码格式不正确（格式：XXXX-XXXX-XXXX）')
  }

  const requestedChannel = normalizeChannel(channel, 'common')
  const db = await getDatabase()
  const channelsByKey = await getChannelRegistry(db)
  const requestedChannelConfig = channelsByKey.get(requestedChannel)
  if (!requestedChannelConfig || !requestedChannelConfig.isActive) {
    throw new RedemptionError(403, '该渠道已停用')
  }

  const codeResult = db.exec(
    `
      SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
             channel, channel_name, created_at, updated_at,
             fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
             supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
      FROM redemption_codes
      WHERE code = ?
      LIMIT 1
    `,
    [normalizedCode]
  )

  if (!codeResult[0]?.values?.length) {
    throw new RedemptionError(404, '兑换码不存在或已失效')
  }

  const codeRecord = mapCodeRow(codeResult[0].values[0], channelsByKey)
  if (!codeRecord) {
    throw new RedemptionError(404, '兑换码不存在或已失效')
  }
  if (codeRecord.isRedeemed) {
    throw new RedemptionError(400, '该兑换码已被使用')
  }

  const isStoredCommonChannel = codeRecord.channel === 'common'
  const canFallback = allowCommonChannelFallback && isStoredCommonChannel && requestedChannel !== 'common' && requestedChannelConfig.allowCommonFallback
  if (codeRecord.channel !== requestedChannel && !canFallback) {
    throw new RedemptionError(403, '该兑换码仅能在对应渠道的兑换页使用')
  }

  const resolvedOrderType = normalizeOrderType(orderType || 'warranty')

  if (requestedChannelConfig.redeemMode === 'external-card') {
    const data = await performExternalRedemption({
      db,
      codeId: codeRecord.id,
      email: normalizedEmail,
      codeRecord,
      requestedChannelConfig,
    })
    return { data, metadata: { code: codeRecord.code, accountEmail: null } }
  }

  const account = await findAvailableAccount(db, {
    accountEmail: codeRecord.accountEmail || undefined,
    channel: requestedChannel,
    allowNonOpenAccount,
  })

  if (!account) {
    throw new RedemptionError(503, '暂无可用账号，请稍后再试或联系管理员')
  }

  const data = await performInternalInviteRedemption({
    db,
    codeId: codeRecord.id,
    email: normalizedEmail,
    codeRecord,
    account,
    orderType: resolvedOrderType,
  })
  return { data, metadata: { code: codeRecord.code, accountEmail: account.email } }
}

router.get('/', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const db = await getDatabase()
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const search = String(req.query.search || '').trim().toLowerCase()
    const status = String(req.query.status || 'all').trim().toLowerCase()

    const conditions = []
    const params = []

    if (search) {
      const keyword = `%${search}%`
      conditions.push('(LOWER(code) LIKE ? OR LOWER(COALESCE(account_email, \'\')) LIKE ? OR LOWER(COALESCE(redeemed_by, \'\')) LIKE ?)')
      params.push(keyword, keyword, keyword)
    }

    if (status === 'unused') {
      conditions.push('COALESCE(is_redeemed, 0) = 0')
    } else if (status === 'redeemed') {
      conditions.push('COALESCE(is_redeemed, 0) = 1')
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const countResult = db.exec(`SELECT COUNT(*) FROM redemption_codes ${whereClause}`, params)
    const total = Number(countResult[0]?.values?.[0]?.[0] || 0)

    const offset = (page - 1) * pageSize
    const channelsByKey = await getChannelRegistry(db)
    const dataResult = db.exec(
      `
        SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
               channel, channel_name, created_at, updated_at,
               fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
               supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
        FROM redemption_codes
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    )

    const codes = (dataResult[0]?.values || []).map(row => mapCodeRow(row, channelsByKey)).filter(Boolean)
    res.json({
      codes,
      pagination: { page, pageSize, total },
    })
  } catch (error) {
    console.error('List redemption codes error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/:id/reinvite', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid code id' })
    }

    const db = await getDatabase()
    const result = db.exec(
      `
        SELECT id, code, redeemed_by, account_email, fulfillment_mode
        FROM redemption_codes
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    )
    const row = result[0]?.values?.[0]
    if (!row) {
      return res.status(404).json({ error: '兑换码不存在' })
    }

    if (String(row[4] || '') === FULFILLMENT_MODE_EXTERNAL) {
      return res.status(400).json({ error: '外部卡密不支持重新邀请' })
    }

    const email = normalizeEmail(row[2])
    const accountEmail = normalizeEmail(row[3])
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: '原兑换邮箱不存在或无效' })
    }

    const account = await findAvailableAccount(db, { accountEmail, allowNonOpenAccount: true })
    if (!account) {
      return res.status(503).json({ error: '绑定账号不可用，无法重新邀请' })
    }

    const inviteResult = await inviteUserToChatGPTTeam(email, account)
    if (!inviteResult.success) {
      return res.status(503).json({ error: inviteResult.error || '重新邀请失败' })
    }

    res.json({ message: '重新邀请已发送' })
  } catch (error) {
    console.error('Reinvite redemption code error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/:id/upstream-check', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid code id' })
    }

    const db = await getDatabase()
    const channelsByKey = await getChannelRegistry(db)
    const result = db.exec(
      `
        SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
               channel, channel_name, created_at, updated_at,
               fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
               supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
        FROM redemption_codes
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    )
    const row = result[0]?.values?.[0]
    if (!row) {
      return res.status(404).json({ error: '兑换码不存在' })
    }

    const code = mapCodeRow(row, channelsByKey)
    res.json({
      message: '上游状态检查完成',
      result: {
        ok: true,
        status: code?.supplierStatus || 'success',
        providerType: code?.supplierType || null,
        supplierName: code?.supplierName || null,
        supplierRequestId: code?.supplierRequestId || null,
        message: code?.supplierResponseMessage || '卡密状态正常',
      },
      code,
    })
  } catch (error) {
    console.error('Check upstream code error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/batch', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const count = Math.min(1000, Math.max(1, Number(req.body?.count) || 0))
    const accountEmail = normalizeEmail(req.body?.accountEmail)
    const channel = normalizeChannel(req.body?.channel, 'common')

    if (!count) {
      return res.status(400).json({ error: '数量必须在 1-1000 之间' })
    }
    if (!accountEmail) {
      return res.status(400).json({ error: '请选择所属账号' })
    }

    const db = await getDatabase()
    const accountResult = db.exec(
      `
        SELECT id, COALESCE(user_count, 0), COALESCE(invite_count, 0)
        FROM gpt_accounts
        WHERE lower(trim(email)) = ?
        LIMIT 1
      `,
      [accountEmail]
    )
    const accountRow = accountResult[0]?.values?.[0]
    if (!accountRow) {
      return res.status(404).json({ error: '账号不存在' })
    }

    const currentUserCount = Number(accountRow[1] || 0)
    const inviteCount = Number(accountRow[2] || 0)
    const unusedCodesResult = db.exec(
      `SELECT COUNT(*) FROM redemption_codes WHERE lower(trim(account_email)) = ? AND COALESCE(is_redeemed, 0) = 0`,
      [accountEmail]
    )
    const unusedCodesCount = Number(unusedCodesResult[0]?.values?.[0]?.[0] || 0)
    const availableSlots = Math.max(0, DEFAULT_ACCOUNT_CAPACITY - currentUserCount - inviteCount - unusedCodesCount)

    if (availableSlots <= 0) {
      return res.status(409).json({ error: '该账号已无可用名额生成兑换码' })
    }

    const actualCount = Math.min(count, availableSlots)
    const createdCodes = []

    for (let i = 0; i < actualCount; i += 1) {
      let code = generateRedemptionCode()
      let attempts = 0
      while (attempts < 10) {
        try {
          db.run(
            `
              INSERT INTO redemption_codes (code, account_email, channel, channel_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))
            `,
            [code, accountEmail, channel, channel]
          )
          createdCodes.push(code)
          break
        } catch (error) {
          code = generateRedemptionCode()
          attempts += 1
          if (attempts >= 10) throw error
        }
      }
    }

    saveDatabase()

    const channelsByKey = await getChannelRegistry(db)
    const codesResult = db.exec(
      `
        SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
               channel, channel_name, created_at, updated_at,
               fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
               supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
        FROM redemption_codes
        WHERE lower(trim(account_email)) = ? AND channel = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [accountEmail, channel, actualCount]
    )

    res.json({
      message: actualCount < count ? `仅创建 ${actualCount} 个兑换码（账号余量不足）` : '兑换码创建成功',
      codes: (codesResult[0]?.values || []).map(row => mapCodeRow(row, channelsByKey)).filter(Boolean),
      failed: Math.max(0, count - actualCount),
    })
  } catch (error) {
    console.error('Batch create redemption codes error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/import-external', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const channel = normalizeChannel(req.body?.channel, '')
    const codesText = String(req.body?.codesText || '').trim()
    if (!channel) {
      return res.status(400).json({ error: '请选择 external-card 渠道' })
    }
    if (!codesText) {
      return res.status(400).json({ error: '请输入要导入的卡密' })
    }

    const db = await getDatabase()
    const channelsByKey = await getChannelRegistry(db)
    const channelConfig = channelsByKey.get(channel)
    if (!channelConfig || channelConfig.redeemMode !== 'external-card') {
      return res.status(400).json({ error: '所选渠道不是 external-card' })
    }

    const codes = codesText
      .split(/[\n,;]+/)
      .map(item => String(item || '').trim().toUpperCase())
      .filter(Boolean)

    const inserted = []
    const duplicates = []
    for (const code of codes) {
      try {
        db.run(
          `
            INSERT INTO redemption_codes (code, channel, channel_name, fulfillment_mode, supplier_name, supplier_type, supplier_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', DATETIME('now', 'localtime'), DATETIME('now', 'localtime'))
          `,
          [code, channel, channelConfig.name, FULFILLMENT_MODE_EXTERNAL, channelConfig.name, channelConfig.providerType]
        )
        inserted.push(code)
      } catch {
        duplicates.push(code)
      }
    }
    saveDatabase()

    const result = inserted.length
      ? db.exec(
          `
            SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
                   channel, channel_name, created_at, updated_at,
                   fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
                   supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
            FROM redemption_codes
            WHERE code IN (${inserted.map(() => '?').join(',')})
            ORDER BY id DESC
          `,
          inserted
        )
      : []

    res.json({
      message: `成功导入 ${inserted.length} 个外部卡密`,
      imported: inserted.length,
      duplicates: duplicates.length,
      duplicateCodes: duplicates,
      codes: (result[0]?.values || []).map(row => mapCodeRow(row, channelsByKey)).filter(Boolean),
    })
  } catch (error) {
    console.error('Import external codes error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.delete('/:id', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid code id' })
    }
    const db = await getDatabase()
    db.run('DELETE FROM redemption_codes WHERE id = ?', [id])
    saveDatabase()
    res.json({ ok: true })
  } catch (error) {
    console.error('Delete redemption code error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.patch('/:id/channel', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const channel = normalizeChannel(req.body?.channel, '')
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid code id' })
    }
    if (!channel) {
      return res.status(400).json({ error: '请选择渠道' })
    }

    const db = await getDatabase()
    const channelsByKey = await getChannelRegistry(db)
    const channelConfig = channelsByKey.get(channel)
    if (!channelConfig) {
      return res.status(404).json({ error: '渠道不存在' })
    }

    db.run(
      `
        UPDATE redemption_codes
        SET channel = ?, channel_name = ?, updated_at = DATETIME('now', 'localtime')
        WHERE id = ?
      `,
      [channel, channelConfig.name || channel, id]
    )
    saveDatabase()

    const result = db.exec(
      `
        SELECT id, code, is_redeemed, redeemed_at, redeemed_by, account_email,
               channel, channel_name, created_at, updated_at,
               fulfillment_mode, supplier_name, supplier_type, supplier_request_id,
               supplier_status, supplier_response_code, supplier_response_message, supplier_redeemed_at
        FROM redemption_codes
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    )

    res.json({ message: '渠道已更新', code: mapCodeRow(result[0]?.values?.[0], channelsByKey) })
  } catch (error) {
    console.error('Update redemption code channel error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/batch-delete', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(id => Number.isFinite(id) && id > 0) : []
    if (!ids.length) {
      return res.status(400).json({ error: '请提供要删除的兑换码ID数组' })
    }

    const db = await getDatabase()
    db.run(`DELETE FROM redemption_codes WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    saveDatabase()
    res.json({ message: `成功删除 ${ids.length} 个兑换码` })
  } catch (error) {
    console.error('Batch delete redemption codes error:', error)
    res.status(500).json({ error: '内部服务器错误' })
  }
})

router.post('/admin/redeem', authenticateToken, requireMenu('redemption_codes'), async (req, res) => {
  try {
    const { code, email, channel, orderType, order_type: orderTypeLegacy } = req.body || {}
    const lockKey = String(code || '').trim()
    const result = await withLocks(lockKey ? [`redemption-code:${lockKey}`] : ['redemption-admin'], () => redeemCodeInternal({
      code,
      email,
      channel,
      orderType: orderType ?? orderTypeLegacy,
    }))
    res.json({ message: '兑换成功', data: result.data })
  } catch (error) {
    if (error instanceof RedemptionError) {
      return res.status(error.statusCode || 400).json({
        error: error.message,
        message: error.message,
        ...(error.payload || {}),
      })
    }
    console.error('Admin redeem error:', error)
    res.status(500).json({ error: '内部服务器错误', message: '服务器错误，请稍后重试' })
  }
})

router.post('/redeem', async (req, res) => {
  try {
    const { code, email, channel, orderType, order_type: orderTypeLegacy } = req.body || {}
    const lockKey = String(code || '').trim()
    const result = await withLocks(lockKey ? [`redemption-code:${lockKey}`] : ['redemption-public'], () => redeemCodeInternal({
      code,
      email,
      channel: normalizeChannel(channel, 'common'),
      orderType: orderType ?? orderTypeLegacy,
      allowCommonChannelFallback: true,
    }))
    res.json({ message: '兑换成功', data: result.data })
  } catch (error) {
    if (error instanceof RedemptionError) {
      return res.status(error.statusCode || 400).json({
        error: error.message,
        message: error.message,
        ...(error.payload || {}),
      })
    }
    console.error('Public redeem error:', error)
    res.status(500).json({ error: '内部服务器错误', message: '服务器错误，请稍后重试' })
  }
})

export default router
