import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import { redeemCodeInternal, RedemptionError } from '../routes/redemption-codes.js'
import { getDatabase } from '../database/init.js'
import { userHasRoleKey } from './rbac.js'
import { getTelegramSettings } from '../utils/telegram-settings.js'
import { withLocks } from '../utils/locks.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

const buildCommandRegex = (command) => new RegExp(`^\/${command}(?:@[\w_]+)?\b`, 'i')

const COMMAND_REGEX = {
  start: buildCommandRegex('start'),
  help: buildCommandRegex('help'),
  stock: buildCommandRegex('stock'),
  redeem: buildCommandRegex('redeem'),
  randomActivate: buildCommandRegex('random_activate'),
  activate: buildCommandRegex('activate'),
}

const parseAllowedUserIds = (value) =>
  String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)

const normalizeIdentifier = (value) => String(value ?? '').trim()
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const resolveInternalApiBaseUrl = () => {
  const configured = String(process.env.TELEGRAM_INTERNAL_API_BASE_URL || '').trim().replace(/\/+$/, '')
  const port = process.env.PORT || 3000
  const fallback = `http://127.0.0.1:${port}`
  const base = configured || fallback
  return base.endsWith('/api') ? base : `${base}/api`
}

const findUserByTelegramId = (db, telegramId) => {
  const normalized = normalizeIdentifier(telegramId)
  if (!normalized) return null
  const result = db.exec(
    'SELECT id, username, email, telegram_id FROM users WHERE telegram_id = ? LIMIT 1',
    [normalized]
  )
  if (!result[0]?.values?.length) {
    return null
  }
  const row = result[0].values[0]
  return { id: row[0], username: row[1], email: row[2], telegramId: row[3] }
}

const resolveSuperAdminUserByTelegramId = async (telegramUserId) => {
  const normalizedTelegramId = normalizeIdentifier(telegramUserId)
  if (!normalizedTelegramId) return null
  const db = await getDatabase()
  const user = findUserByTelegramId(db, normalizedTelegramId)
  if (!user) return null
  const isSuperAdmin = await userHasRoleKey(user.id, 'super_admin', db)
  return isSuperAdmin ? user : null
}

const getStockSummary = async (internalApi) => {
  const response = await internalApi.get('/gpt-accounts', { params: { page: 1, pageSize: 200 } })
  if (response.status !== 200) {
    throw new Error(response.data?.error ? String(response.data.error) : `HTTP ${response.status}`)
  }

  const accounts = Array.isArray(response.data?.accounts) ? response.data.accounts : []
  const openAccounts = accounts.filter(account => Boolean(account?.isOpen) && !Boolean(account?.isBanned))
  const availableCodes = openAccounts.reduce((sum, account) => {
    const usedSeats = Number(account?.userCount || 0)
    const pendingInvites = Number(account?.inviteCount || 0)
    const remaining = Math.max(0, 5 - usedSeats - pendingInvites)
    return sum + remaining
  }, 0)

  return {
    totalAccounts: accounts.length,
    openAccounts: openAccounts.length,
    availableCodes,
  }
}

const safeJsonParse = (value) => {
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const readStreamText = (stream, maxBytes = 8192) =>
  new Promise((resolve, reject) => {
    let buffer = ''
    let size = 0

    const cleanup = () => {
      stream.removeAllListeners('data')
      stream.removeAllListeners('end')
      stream.removeAllListeners('error')
    }

    stream.on('data', chunk => {
      const text = chunk.toString('utf8')
      size += Buffer.byteLength(text)
      if (size <= maxBytes) {
        buffer += text
      }
      if (size >= maxBytes) {
        cleanup()
        stream.destroy()
        resolve(buffer.trim())
      }
    })

    stream.on('end', () => {
      cleanup()
      resolve(buffer.trim())
    })

    stream.on('error', error => {
      cleanup()
      reject(error)
    })
  })

const parseSseStream = (stream, onEvent) =>
  new Promise((resolve, reject) => {
    let buffer = ''
    let eventName = 'message'
    let dataBuffer = ''
    let pendingError = null

    const dispatchEvent = () => {
      if (!dataBuffer) {
        eventName = 'message'
        return
      }
      const payload = dataBuffer.endsWith('\n') ? dataBuffer.slice(0, -1) : dataBuffer
      const event = { event: eventName || 'message', data: payload }
      dataBuffer = ''
      eventName = 'message'
      Promise.resolve(onEvent(event)).catch(error => {
        pendingError = error
        stream.destroy(error)
      })
    }

    const cleanup = () => {
      stream.removeAllListeners('data')
      stream.removeAllListeners('end')
      stream.removeAllListeners('error')
      stream.removeAllListeners('close')
    }

    stream.on('data', chunk => {
      buffer += chunk.toString('utf8')
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        let line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.endsWith('\r')) {
          line = line.slice(0, -1)
        }
        if (!line) {
          dispatchEvent()
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataBuffer += `${line.slice(5).trimStart()}\n`
        }
        index = buffer.indexOf('\n')
      }
    })

    stream.on('end', () => {
      dispatchEvent()
      cleanup()
      if (pendingError) reject(pendingError)
      else resolve()
    })

    stream.on('close', () => {
      cleanup()
      if (pendingError) reject(pendingError)
      else resolve()
    })

    stream.on('error', error => {
      cleanup()
      reject(error)
    })
  })

export async function startTelegramBot() {
  const settings = await getTelegramSettings(null, { forceRefresh: true })
  const token = String(settings.token || '').trim()

  if (!token) {
    console.log('[Telegram Bot] Bot Token 未配置，跳过启动')
    return null
  }

  const bot = new TelegramBot(token, { polling: true })
  const allowedUserIds = parseAllowedUserIds(settings.allowedUserIds || '')
  const restrictByUser = allowedUserIds.length > 0
  const allowedUserIdSet = new Set(allowedUserIds)
  const sessions = new Map()
  const internalApi = axios.create({
    baseURL: resolveInternalApiBaseUrl(),
    timeout: Math.max(1000, toInt(process.env.TELEGRAM_INTERNAL_API_TIMEOUT_MS, 12000)),
    validateStatus: () => true,
  })

  const randomActivateUrl = String(process.env.TELEGRAM_RANDOM_ACTIVATE_SSE_URL || '').trim()
  const randomActivateApiKey = String(process.env.TELEGRAM_RANDOM_ACTIVATE_API_KEY || '').trim()
  const randomActivateTimeoutMs = Math.max(1000, toInt(process.env.TELEGRAM_RANDOM_ACTIVATE_TIMEOUT_MS, 120000))
  const activateUrl = String(process.env.TELEGRAM_ACTIVATE_SSE_URL || '').trim()
  const activateApiKey = String(process.env.TELEGRAM_ACTIVATE_API_KEY || randomActivateApiKey).trim()
  const activateTimeoutMs = Math.max(1000, toInt(process.env.TELEGRAM_ACTIVATE_TIMEOUT_MS, randomActivateTimeoutMs))

  const ensureAuthorized = (msg, { requirePrivate = true } = {}) => {
    const chatId = msg.chat?.id
    const userId = msg.from?.id
    if (!chatId) return false

    if (restrictByUser && (!userId || !allowedUserIdSet.has(String(userId)))) {
      bot.sendMessage(chatId, '你没有权限使用这个机器人。')
      return false
    }

    if (requirePrivate && msg.chat?.type !== 'private') {
      bot.sendMessage(chatId, '为保护隐私，请在私聊中使用该命令。')
      return false
    }

    return true
  }

  const clearSession = (chatId) => {
    sessions.delete(chatId)
  }

  const buildHelpMessage = async (msg) => {
    const lines = [
      '你好！我可以帮你完成 ChatGPT Team 账号兑换。',
      '',
      '可用指令：',
      '• /stock - 查看当前可用库存',
      '• /redeem - 开始兑换',
      '• /help - 查看帮助说明',
    ]

    const superAdmin = await resolveSuperAdminUserByTelegramId(msg.from?.id)
    if (superAdmin) {
      lines.push('• /random_activate - 随机激活账号')
      lines.push('• /activate <checkout_url> [activate_code] - 指定激活账号')
    }
    return lines.join('\n')
  }

  const handleRedeemSubmission = async (chatId, email, code) => {
    try {
      await bot.sendChatAction(chatId, 'typing')
      const result = await withLocks([`redemption-code:${code}`], () => redeemCodeInternal({
        email,
        code,
        channel: 'common',
      }))
      const { data } = result || {}
      const lines = [
        '✅ 兑换成功！',
        `兑换邮箱：${email}`,
        data?.inviteStatus ? `邀请状态：${data.inviteStatus}` : null,
        '',
        data?.message || '请前往邮箱查收邀请邮件，如未收到请联系管理员。',
      ].filter(Boolean)
      await bot.sendMessage(chatId, lines.join('\n'))
    } catch (error) {
      const isKnownError = error instanceof RedemptionError
      const message = (isKnownError && error.message) || '服务器错误，请稍后重试或联系管理员。'
      await bot.sendMessage(chatId, `❌ 兑换失败：${message}`)
      if (!isKnownError) {
        console.error('[Telegram Bot] redeem failed', error)
      }
    } finally {
      clearSession(chatId)
    }
  }

  const runActivationCommand = async ({ chatId, url, apiKey, timeoutMs, method, body }) => {
    if (!url || !apiKey) {
      await bot.sendMessage(chatId, '未配置激活服务地址或 API Key。')
      return
    }

    let progressMessageId = null
    const updateProgressMessage = async (text) => {
      try {
        if (progressMessageId) {
          await bot.editMessageText(text, { chat_id: chatId, message_id: progressMessageId })
        } else {
          const message = await bot.sendMessage(chatId, text)
          progressMessageId = message.message_id
        }
      } catch {
        if (!progressMessageId) {
          const message = await bot.sendMessage(chatId, text)
          progressMessageId = message.message_id
        }
      }
    }

    try {
      await updateProgressMessage('⏳ 正在连接激活服务...')
      const response = await axios.request({
        url,
        method,
        data: body,
        timeout: timeoutMs,
        headers: {
          'x-api-key': apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        responseType: 'stream',
        validateStatus: () => true,
      })

      if (response.status < 200 || response.status >= 300) {
        const errorText = await readStreamText(response.data).catch(() => '')
        throw new Error(errorText || `HTTP ${response.status}`)
      }

      let resultInfo = null
      const stream = response.data
      const contentType = String(response.headers?.['content-type'] || '').toLowerCase()
      const isEventStream = contentType.includes('text/event-stream')

      if (!isEventStream) {
        const rawText = await readStreamText(stream, 65536).catch(() => '')
        resultInfo = safeJsonParse(rawText) || { success: false, message: rawText || '响应格式不支持' }
      } else {
        await parseSseStream(stream, async ({ event, data }) => {
          const payload = safeJsonParse(data) || {}
          if (event === 'progress' || event === 'message' || event === 'selected') {
            const text = payload?.message || payload?.step_name || '处理中...'
            await updateProgressMessage(`⏳ ${text}`)
            return
          }
          if (event === 'result' || event === 'done') {
            resultInfo = payload
            stream.destroy()
          }
        })
      }

      if (!resultInfo) {
        throw new Error('未收到最终结果，请稍后重试。')
      }

      if (!resultInfo.success) {
        const msgText = resultInfo.error || resultInfo.message || '未知错误'
        await updateProgressMessage(`❌ 激活失败：${msgText}`)
        return
      }

      const lines = [
        '✅ 激活成功',
        resultInfo.email ? `邮箱：${resultInfo.email}` : null,
        resultInfo.token_id != null ? `Token ID：${resultInfo.token_id}` : null,
        resultInfo.card?.code ? `卡密：${resultInfo.card.code}` : null,
        resultInfo.card?.message ? `状态：${resultInfo.card.message}` : null,
      ].filter(Boolean)
      await updateProgressMessage('✅ 激活已完成')
      await bot.sendMessage(chatId, lines.join('\n'))
    } catch (error) {
      await updateProgressMessage(`❌ 激活失败：${error?.message || String(error)}`)
    }
  }

  bot.onText(COMMAND_REGEX.start, async (msg) => {
    if (!ensureAuthorized(msg, { requirePrivate: false })) return
    const helpMessage = await buildHelpMessage(msg)
    bot.sendMessage(msg.chat.id, helpMessage)
  })

  bot.onText(COMMAND_REGEX.help, async (msg) => {
    if (!ensureAuthorized(msg, { requirePrivate: false })) return
    const helpMessage = await buildHelpMessage(msg)
    bot.sendMessage(msg.chat.id, helpMessage)
  })

  bot.onText(COMMAND_REGEX.stock, async (msg) => {
    if (!ensureAuthorized(msg, { requirePrivate: false })) return
    const chatId = msg.chat.id
    try {
      await bot.sendChatAction(chatId, 'typing')
      const summary = await getStockSummary(internalApi)
      const lines = [
        `📦 当前可用库存：${summary.availableCodes} 个`,
        `开放账号：${summary.openAccounts} 个`,
        `账号总数：${summary.totalAccounts} 个`,
      ]
      await bot.sendMessage(chatId, lines.join('\n'))
    } catch (error) {
      await bot.sendMessage(chatId, `❌ 查询库存失败：${error?.message || String(error)}`)
    }
  })

  bot.onText(COMMAND_REGEX.redeem, (msg) => {
    if (!ensureAuthorized(msg, { requirePrivate: true })) return
    clearSession(msg.chat.id)
    sessions.set(msg.chat.id, { stage: 'awaitingEmail' })
    bot.sendMessage(msg.chat.id, '请回复要接收邀请的邮箱地址（格式：name@example.com）。')
  })

  bot.onText(COMMAND_REGEX.randomActivate, async (msg) => {
    const chatId = msg.chat?.id
    if (!chatId) return
    if (!ensureAuthorized(msg, { requirePrivate: true })) return

    const superAdmin = await resolveSuperAdminUserByTelegramId(msg.from?.id)
    if (!superAdmin) {
      await bot.sendMessage(chatId, '你没有权限使用这个指令。')
      return
    }

    await runActivationCommand({
      chatId,
      url: randomActivateUrl,
      apiKey: randomActivateApiKey,
      timeoutMs: randomActivateTimeoutMs,
      method: 'GET',
    })
  })

  bot.onText(COMMAND_REGEX.activate, async (msg) => {
    const chatId = msg.chat?.id
    if (!chatId) return
    if (!ensureAuthorized(msg, { requirePrivate: true })) return

    const superAdmin = await resolveSuperAdminUserByTelegramId(msg.from?.id)
    if (!superAdmin) {
      await bot.sendMessage(chatId, '你没有权限使用这个指令。')
      return
    }

    const text = (msg.text || '').trim()
    const parts = text.split(/\s+/)
    const checkoutUrl = normalizeIdentifier(parts[1])
    const activateCode = normalizeIdentifier(parts[2])

    if (!checkoutUrl) {
      await bot.sendMessage(chatId, '用法：/activate <checkout_url> [activate_code]')
      return
    }

    await runActivationCommand({
      chatId,
      url: activateUrl,
      apiKey: activateApiKey,
      timeoutMs: activateTimeoutMs,
      method: 'POST',
      body: {
        checkout_url: checkoutUrl,
        ...(activateCode ? { activate_code: activateCode } : {}),
      },
    })
  })

  bot.on('message', async (msg) => {
    const text = (msg.text || '').trim()
    const chatId = msg.chat?.id
    if (!chatId || !text || text.startsWith('/')) return

    const session = sessions.get(chatId)
    if (!session) return
    if (!ensureAuthorized(msg, { requirePrivate: true })) return

    if (session.stage === 'awaitingEmail') {
      if (!EMAIL_REGEX.test(text)) {
        await bot.sendMessage(chatId, '邮箱格式不正确，请重新输入。')
        return
      }
      session.email = text
      session.stage = 'awaitingCode'
      await bot.sendMessage(chatId, '收到 ✅ 请继续回复兑换码（格式：XXXX-XXXX-XXXX）。')
      return
    }

    if (session.stage === 'awaitingCode') {
      const normalizedCode = text.toUpperCase().replace(/[^A-Z0-9-]/g, '').trim()
      if (!CODE_REGEX.test(normalizedCode)) {
        await bot.sendMessage(chatId, '兑换码格式不正确，请按 XXXX-XXXX-XXXX 的格式输入。')
        return
      }
      const email = session.email
      session.stage = 'processing'
      await handleRedeemSubmission(chatId, email, normalizedCode)
    }
  })

  bot.on('polling_error', error => {
    console.error('[Telegram Bot] Polling error:', error?.message || error)
  })

  bot
    .getMe()
    .then(info => {
      const username = info.username ? `@${info.username}` : info.first_name || ''
      console.log(`[Telegram Bot] 已启动 ${username}`)
    })
    .catch(() => {
      console.log('[Telegram Bot] 已启动')
    })

  return bot
}
