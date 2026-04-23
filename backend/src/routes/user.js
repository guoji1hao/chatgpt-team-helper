import express from 'express'
import bcrypt from 'bcryptjs'
import { getDatabase, saveDatabase } from '../database/init.js'
import { authenticateToken } from '../middleware/auth.js'
import { requireMenu, requireSuperAdmin } from '../middleware/rbac.js'
import { getAdminMenuTreeForAccessContext, getUserAccessContext } from '../services/rbac.js'
import { upsertSystemConfigValue } from '../utils/system-config.js'

const router = express.Router()
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const buildUserResponse = async (db, userId) => {
  const result = db.exec(
    'SELECT id, username, email, COALESCE(invite_enabled, 1) FROM users WHERE id = ? LIMIT 1',
    [userId]
  )
  if (!result[0]?.values?.length) return null

  const row = result[0].values[0]
  const access = await getUserAccessContext(userId, db)
  const adminMenus = await getAdminMenuTreeForAccessContext(access, db)

  return {
    id: Number(row[0]),
    username: String(row[1] || ''),
    email: String(row[2] || ''),
    inviteEnabled: Number(row[3] ?? 1) !== 0,
    roles: access.roles,
    menus: access.menus,
    adminMenus,
  }
}

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Access denied. No user provided.' })
    }

    const db = await getDatabase()
    const user = await buildUserResponse(db, userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(user)
  } catch (error) {
    console.error('Get user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/username', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Access denied. No user provided.' })
    }

    const username = String(req.body?.username ?? '').trim()
    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' })
    }
    if (username.length > 64) {
      return res.status(400).json({ error: '用户名过长' })
    }

    const db = await getDatabase()
    const duplicate = db.exec(
      'SELECT 1 FROM users WHERE lower(username) = lower(?) AND id != ? LIMIT 1',
      [username, userId]
    )
    if (duplicate[0]?.values?.length) {
      return res.status(409).json({ error: '用户名已存在' })
    }

    db.run('UPDATE users SET username = ? WHERE id = ?', [username, userId])
    saveDatabase()

    const user = await buildUserResponse(db, userId)
    res.json({
      message: '用户名已更新',
      user,
    })
  } catch (error) {
    console.error('Update username error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' })
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' })
    }

    const userId = Number(req.user?.id)
    const db = await getDatabase()
    const userResult = db.exec('SELECT password FROM users WHERE id = ? LIMIT 1', [userId])

    if (!userResult[0]?.values?.length) {
      return res.status(404).json({ error: 'User not found' })
    }

    const currentHash = String(userResult[0].values[0][0] || '')
    const isPasswordValid = bcrypt.compareSync(String(currentPassword), currentHash)
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    const hashedPassword = bcrypt.hashSync(String(newPassword), 10)
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId])
    saveDatabase()

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/api-key', authenticateToken, requireSuperAdmin, requireMenu('settings'), async (req, res) => {
  try {
    const db = await getDatabase()
    const result = db.exec('SELECT config_value FROM system_config WHERE config_key = ? LIMIT 1', ['auto_boarding_api_key'])

    if (!result[0]?.values?.length) {
      return res.json({ apiKey: null, configured: false })
    }

    res.json({ apiKey: String(result[0].values[0][0] || ''), configured: true })
  } catch (error) {
    console.error('Get API key error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/api-key', authenticateToken, requireSuperAdmin, requireMenu('settings'), async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim()
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' })
    }
    if (apiKey.length < 16) {
      return res.status(400).json({ error: 'API key must be at least 16 characters for security' })
    }

    const db = await getDatabase()
    upsertSystemConfigValue(db, 'auto_boarding_api_key', apiKey)
    saveDatabase()

    res.json({
      message: 'API key updated successfully',
      apiKey,
    })
  } catch (error) {
    console.error('Update API key error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
