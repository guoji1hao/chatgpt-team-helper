import express from 'express'
import { getTurnstileSettings } from '../utils/turnstile-settings.js'
import { getChannels } from '../utils/channels.js'

const router = express.Router()

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_LOCALE = 'zh-CN'

router.get('/runtime', async (req, res) => {
  try {
    const timezone = process.env.TZ || DEFAULT_TIMEZONE
    const locale = process.env.APP_LOCALE || DEFAULT_LOCALE
    const turnstileSettings = await getTurnstileSettings()
    const turnstileSiteKey = String(turnstileSettings.siteKey || '').trim()
    const { list: channelList } = await getChannels()
    const channels = (channelList || [])
      .filter(channel => channel?.isActive)
      .map(channel => ({
        key: channel.key,
        name: channel.name,
        redeemMode: channel.redeemMode,
        providerType: channel.providerType,
        allowCommonFallback: channel.allowCommonFallback,
        isActive: channel.isActive,
        isBuiltin: channel.isBuiltin,
        sortOrder: channel.sortOrder,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      }))

    res.json({
      timezone,
      locale,
      turnstileEnabled: Boolean(turnstileSettings.enabled),
      turnstileSiteKey: turnstileSiteKey || null,
      channels,
    })
  } catch (error) {
    console.error('[Config] runtime error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
