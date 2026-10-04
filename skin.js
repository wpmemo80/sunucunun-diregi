// Steve cildini (skin) indirir, Bedrock login paketinin istediği formata çevirir
// ve bir sonraki açılışta tekrar indirmemek için cache/ klasörüne kaydeder.
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const CACHE_DIR = path.join(__dirname, 'cache')
const CACHE_FILE = path.join(CACHE_DIR, 'steve-skin.json')

// 64x64 Steve skin PNG kaynakları (ilki başarısız olursa diğerleri denenir)
const STEVE_URLS = [
  'https://mc-heads.net/skin/steve',
  'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/entity/steve.png'
]

// Klasik (persona olmayan) Bedrock ciltlerinin geometri yamasası.
// geometry.humanoid.custom oyunun içindedir, ek geometri verisi gerekmez.
const CLASSIC_PATCH = Buffer.from(JSON.stringify({
  geometry: {
    default: 'geometry.humanoid.custom',
    animated_face: 'geometry.humanoid.customAnimated'
  }
})).toString('base64')

async function downloadPng () {
  let lastError
  for (const url of STEVE_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const png = PNG.sync.read(buf) // pngjs -> RGBA ham veri (Bedrock'in istediği format)
      if (png.width < 64 || png.height < 32) throw new Error(`Geçersiz cilt boyutu ${png.width}x${png.height}`)
      return png
    } catch (err) {
      lastError = err
      console.warn(`[cilt] ${url} indirilemedi: ${err.message}`)
    }
  }
  throw lastError || new Error('Cilt indirilemedi')
}

function toSkinPayload (png) {
  return {
    SkinId: 'steve-classic-64x64',
    SkinResourcePatch: CLASSIC_PATCH,
    SkinImageWidth: png.width,
    SkinImageHeight: png.height,
    SkinData: png.data.toString('base64'), // ham RGBA piksel verisi
    SkinColor: '#ffb37b62',
    ArmSize: 'wide',
    PersonaSkin: false,
    PersonaPieces: [],
    PieceTintColors: [],
    PremiumSkin: false,
    CapeOnClassicSkin: false,
    CapeData: '',
    CapeId: '',
    CapeImageWidth: 0,
    CapeImageHeight: 0,
    SkinAnimationData: '',
    AnimatedImageData: [],
    SkinGeometryData: '',
    SkinGeometryDataEngineVersion: false
  }
}

function readCache () {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (data && data.SkinData) return data
  } catch (_) { /* cache yok/bozuk, yeniden indir */ }
  return null
}

/** Steve cildini döndürür (indirme/güncelleme gerekirse cache yapar). */
async function getSteveSkin () {
  try {
    const png = await downloadPng()
    const payload = toSkinPayload(png)
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload))
    console.log(`[cilt] Steve cildi hazır (${png.width}x${png.height})`)
    return payload
  } catch (err) {
    const cached = readCache()
    if (cached) {
      console.warn(`[cilt] İndirme başarısız, önbellekteki Steve cildi kullanılıyor (${err.message})`)
      return cached
    }
    console.warn(`[cilt] Steve cildi alınamadı, varsayılan cilt kullanılacak (${err.message})`)
    return null
  }
}

module.exports = { getSteveSkin }
