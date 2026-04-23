import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/user.js'
import gptAccountsRoutes from './routes/gpt-accounts.js'
import redemptionCodesRoutes from './routes/redemption-codes.js'
import openaiAccountsRoutes from './routes/openai-accounts.js'
import configRoutes from './routes/config.js'
import adminRoutes from './routes/admin.js'
import adminStatsRoutes from './routes/admin-stats.js'
import { initDatabase } from './database/init.js'
import { startOpenAccountsOvercapacitySweeper } from './services/open-accounts-sweeper.js'
import { startTelegramBot } from './services/telegram-bot.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const INSECURE_DEFAULT_JWT_SECRET = 'your-secret-key-change-this-in-production'

const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
if (isProduction) {
  const jwtSecret = String(process.env.JWT_SECRET || '').trim()
  if (!jwtSecret || jwtSecret === INSECURE_DEFAULT_JWT_SECRET) {
    console.error('[SECURITY] JWT_SECRET must be set to a strong random value in production')
    process.exit(1)
  }
}

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
  })
}

app.disable('x-powered-by')

const parseCorsOrigins = () => {
  const raw = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').trim()
  if (!raw) {
    return new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'])
  }
  return new Set(
    raw
      .split(/[\s,]+/)
      .map(origin => origin.trim())
      .filter(Boolean)
  )
}

const corsOrigins = parseCorsOrigins()
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      return callback(null, corsOrigins.has(origin))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: false,
    maxAge: 86400,
  })
)
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.set('etag', false)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  next()
})

initDatabase()
  .then(async () => {
    const dbPath = process.env.DATABASE_PATH || './db/database.sqlite'
    console.log(`Database initialized at: ${dbPath}`)

    startOpenAccountsOvercapacitySweeper()
    await startTelegramBot().catch(error => {
      console.error('[Telegram Bot] start failed:', error)
    })

    startServer()
  })
  .catch(error => {
    console.error('Failed to initialize database:', error)
    startServer()
  })

app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/gpt-accounts', gptAccountsRoutes)
app.use('/api/redemption-codes', redemptionCodesRoutes)
app.use('/api/openai-accounts', openaiAccountsRoutes)
app.use('/api/config', configRoutes)
app.use('/api/admin/stats', adminStatsRoutes)
app.use('/api/admin', adminRoutes)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})
