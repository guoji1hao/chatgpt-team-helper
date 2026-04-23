import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getDatabase, saveDatabase } from '../database/init.js'
import { sendVerificationCodeEmail } from '../services/email-service.js'
import { getEmailDomainWhitelist, isEmailDomainAllowed } from '../utils/email-domain-whitelist.js'
import { getAdminMenuTreeForAccessContext, getUserAccessContext } from '../services/rbac.js'
import { safeInsertPointsLedgerEntry } from '../utils/points-ledger.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
const JWT_ALGORITHM = 'HS256'
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_REGISTER_REWARD_POINTS = 2

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex')

const randomVerificationCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0')

const sendRegisterCode = async (db, email) => {
  const recent = db.exec(
    `
      SELECT 1
      FROM email_verification_codes
      WHERE email = ? AND purpose = 'register'
        AND created_at >= DATETIME('now', 'localtime', '-60 seconds')
      LIMIT 1
    `,
    [email]
  )
  if (recent[0]?.values?.length) {
    return { ok: false, status: 429, error: '验证码发送过于频繁，请稍后再试' }
  }

  const code = randomVerificationCode()
  const codeHash = sha256(code)

  db.run(
    `
      INSERT INTO email_verification_codes (email, purpose, code_hash, expires_at, created_at)
      VALUES (?, 'register', ?, DATETIME('now', 'localtime', '+10 minutes'), DATETIME('now', 'localtime'))
    `,
    [email, codeHash]
  )
  saveDatabase()

  const sent = await sendVerificationCodeEmail(email, code, { expiresMinutes: 10 })
  if (!sent) {
    return { ok: false, status: 500, error: '验证码发送失败，请检查 SMTP 配置' }
  }

  return { ok: true }
}

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const db = await getDatabase()
    const identifier = String(username).trim()
    const result = db.exec(
      'SELECT id, username, password, email, COALESCE(invite_enabled, 1) FROM users WHERE username = ? OR email = ? LIMIT 1',
      [identifier, identifier]
    )

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const user = {
      id: result[0].values[0][0],
      username: result[0].values[0][1],
      password: result[0].values[0][2],
      email: result[0].values[0][3],
      inviteEnabled: Number(result[0].values[0][4] ?? 1) !== 0,
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password)

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: JWT_ALGORITHM }
    )

    const access = await getUserAccessContext(user.id, db)
    const adminMenus = await getAdminMenuTreeForAccessContext(access, db)

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        inviteEnabled: user.inviteEnabled,
        roles: access.roles,
        menus: access.menus,
        adminMenus,
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/register/send-code', async (req, res) => {
  res.status(403).json({ error: '注册功能已关闭' })
})

router.post('/register', async (req, res) => {
  res.status(403).json({ error: '注册功能已关闭' })
})

export default router
