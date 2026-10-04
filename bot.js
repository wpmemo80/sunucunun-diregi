// Aternos Bedrock sunucusunu açık tutan bot
// İsim: "Sunucunun direği" | Cilt: Steve
const { createClient, ping } = require('bedrock-protocol')
const { getSteveSkin } = require('./skin')
const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

// Ortam değişkenleri (CI/bulut kurulumları için) config değerlerini ezer
const env = k => (process.env[k] !== undefined && process.env[k] !== '') ? process.env[k] : undefined
const RAKNET_BACKEND = env('RAKNET_BACKEND') || config.raknetBackend || undefined
const SKIP_PING = env('SKIP_PING') !== undefined ? env('SKIP_PING') === '1' : Boolean(config.skipPing)
const RUN_SECONDS = Number(env('BOT_RUN_SECONDS') || 0)
const USE_RAKNET_WORKERS = env('USE_RAKNET_WORKERS') !== undefined
  ? env('USE_RAKNET_WORKERS') === '1'
  : undefined

let stopping = false
let client = null
let antiAfkTimer = null

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('tr-TR')}]`, ...a)

function stopAntiAfk () {
  if (antiAfkTimer) {
    clearInterval(antiAfkTimer)
    antiAfkTimer = null
  }
}

// Sunucunun "boşta" diye atmasını engellemek için arada bir kol sallama hareketi gönderir.
function startAntiAfk (cl) {
  stopAntiAfk()
  if (!config.antiAfkSeconds || config.antiAfkSeconds <= 0) return
  antiAfkTimer = setInterval(() => {
    try {
      const id = cl.entityId ?? 0n
      cl.write('player_action', {
        runtime_entity_id: typeof id === 'bigint' ? id : BigInt(id || 0),
        action: 'swing_arm',
        position: { x: 0, y: 0, z: 0 },
        result_position: { x: 0, y: 0, z: 0 },
        face: 0
      })
    } catch (err) {
      log('Anti-AFK paketi gönderilemedi:', err.message)
      stopAntiAfk()
    }
  }, config.antiAfkSeconds * 1000)
}

/** Tek bir oturum açar, bağlantı kopana kadar bekler. true = sunucuya girebildi. */
function runSession (skin) {
  return new Promise(resolve => {
    let spawned = false
    const target = `${config.host}:${config.port}`

    const cl = createClient({
      host: config.host,
      port: config.port,
      username: config.offline ? config.username : (config.msaAccount || config.username),
      version: config.version,      // 1.21.43.01 -> protokol 748 -> minecraft-data: 1.21.42
      offline: config.offline,      // true: isimle giriş (Xbox yok), false: Microsoft hesabıyla giriş
      connectTimeout: config.connectTimeout,
      viewDistance: config.viewDistance,
      autoInitPlayer: true,
      // Native RakNet modülü Linux'ta derlenemeyse JS sürümüne düş (bulut kurulumu için)
      ...(RAKNET_BACKEND ? { raknetBackend: RAKNET_BACKEND } : {}),
      // Bulutta sürüm zaten config'de belirtildiği için keşif ping'i gereksiz
      skipPing: SKIP_PING,
      // Microsoft giriş token'ları burada saklanır (sonraki açılışta kod istemez)
      profilesFolder: path.join(__dirname, 'cache', 'msa'),
      onMsaCode: data => {
        log('┌──────── Microsoft girişi ────────┐')
        log('│ Kod : ' + data.user_code)
        log('│ Gir : ' + (data.verification_uri || 'https://www.microsoft.com/link'))
        log('└──────────────────────────────────┘')
        log('Kod 15 dakika geçerlidir. Bir kez girdikten sonra hatırlanır.')
      },
      ...(skin ? { skinData: skin } : {})
    })
    client = cl

    cl.on('session', profile => log(`Oturum: "${profile.name}" (XUID: ${profile.xuid})`))

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      stopAntiAfk()
      resolve(spawned)
    }

    cl.on('error', err => log(`HATA (${target}):`, err.message))
    cl.on('kick', pkt => {
      const msg = pkt?.message || '(sebep yok)'
      log('Sunucu seni attı:', msg)
      if (msg.includes('notAuthenticated') && config.offline) {
        log('>>> Sunucu Xbox kimlik doğrulaması ZORUNLU tutuyor.')
        log('>>> İki seçeneğin var:')
        log('>>>  1) Aternos panelinde server.properties içinde "xbox-auth=false" yap,')
        log('>>>     sonra config.json içindeki "offline": true kalsın (isim "Sunucunun direği" olur).')
        log('>>>  2) config.json içinde "offline": false yapıp botu yeniden başlat,')
        log('>>>     ekrandaki kodu microsoft.com/link adresinden onayla (isim = hesabın gamertag\'i olur).')
      }
      if (msg.includes('notAuthenticated') && !config.offline) {
        log('>>> Microsoft girişi reddedildi. cache\\msa klasörünü silip yeniden deneyebilirsin.')
      }
    })
    cl.on('spawn', () => {
      spawned = true
      log(`Sunucuya girdin! (${target}) İsim: "${cl.username}" | Cilt: Steve`)
      log(`Sunucuda kalınca bağlantı açık tutuluyor... (anti-AFK: ${config.antiAfkSeconds}sn)`)
      startAntiAfk(cl)
    })

    if (config.logChat) {
      cl.on('text_packet', pkt => {
        if (!pkt) return
        if (pkt.type === 'chat') log(`<${pkt.source}> ${pkt.message}`)
        else if (pkt.type === 'system' || pkt.type === 'raw' || pkt.type === 'translation') {
          if (pkt.message && !/^\s*$/.test(pkt.message)) log('Sunucu:', pkt.message)
        }
      })
    }

    cl.on('disconnect', pkt => {
      if (pkt && !pkt.hide_disconnect_reason) log('Sunucudan ayrılma isteği:', pkt.message)
    })

    cl.on('close', () => {
      log(spawned ? 'Bağlantı kapandı, yeniden bağlanılacak...' : 'Bağlantı kurulamadı/kapandı.')
      finish()
    })

    // Bizi bekletmeden çıkarsak diye (Ctrl+C)
    cl.once('close', () => { client = null })
  })
}

function backoffDelay (attempt) {
  const min = config.reconnectMinMs || 5000
  const max = config.reconnectMaxMs || 60000
  return Math.min(min * Math.pow(2, attempt - 1), max)
}

async function main () {
  log('=== Aternos açık tutma botu başlıyor ===')
  log(`Sunucu: ${config.host}:${config.port} | Sürüm: ${config.version} | İsim: "${config.username}"`)

  const skin = await getSteveSkin()

  // Sunucu şu an ayakta mı, hızlıca görelim (native RakNet gerektirir, yoksa atlarız)
  let canPing = !SKIP_PING
  if (canPing) {
    try { require('raknet-native') } catch (_) {
      canPing = false
      log("Durum ping'i atlanıyor: native RakNet modülü yok (JS modülü kullanılacak)")
    }
  }
  if (canPing) {
    try {
      const ad = await ping({ host: config.host, port: config.port, timeout: 5000 })
      log(`Sunucu ayakta: "${ad.motd}" | ${ad.playersOnline}/${ad.playersMax} oyuncu | sürüm ${ad.version}`)
    } catch (err) {
      log(`Şu an sunucuya ulaşılamıyor (${err.message}). Sunucu açılana kadar denenecek...`)
    }
  }

  // Belirli süre modu (CI/bulut: her çalıştırma X saniye sonra temiz kapanır)
  if (RUN_SECONDS > 0) {
    log(`Süreli mod: ${RUN_SECONDS} saniye sonra kapatılacak.`)
    setTimeout(() => {
      log(`Süre doldu (${RUN_SECONDS}s) — bot kapatılıyor.`)
      shutdown()
    }, RUN_SECONDS * 1000)
  }

  let attempt = 0
  while (!stopping) {
    attempt++
    let spawned = false
    try {
      spawned = await runSession(skin)
    } catch (err) {
      log('Beklenmeyen hata:', err.message)
    }
    if (stopping) break
    if (spawned) attempt = 0

    const delay = backoffDelay(Math.max(attempt, 1))
    log(`${Math.round(delay / 1000)} saniye sonra yeniden denenecek (deneme #${attempt})...`)
    await sleep(delay)
  }
  log('Bot durduruldu. Görüşürüz!')
}

function shutdown () {
  if (stopping) return
  stopping = true
  log('Durduruluyor...')
  stopAntiAfk()
  try {
    if (client && !client._closed) client.disconnect('Sunucunun direği ayrılıyor')
  } catch (_) { /* yoksay */ }
  setTimeout(() => process.exit(0), 1500)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(err => {
  console.error('Bot başlatılamadı:', err)
  process.exit(1)
})
