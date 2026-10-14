// Builds a release that installed apps can update to, and lays out the files to publish.
//
//   node scripts/release.mjs [--channel staging] [--url <folder URL>] [--notes "Có gì mới"] [--config <json>] [--publish]
//
// --url is the folder the files will be published at; the app looks for `<url>latest.json`. It defaults to the
// team's Cloudflare R2 bucket. --publish uploads the files there with wrangler (run `npx wrangler login` once).
// --channel staging builds "MyTranslate Staging" (tauri.staging.conf.json), which installs beside the stable app,
// keeps its own data and updates from `staging/` in the bucket. Its version is the stable one with
// `-staging.<number of commits>`, so each staging build updates the one before. Only the NSIS installer is built:
// an MSI cannot carry a pre-release version.
// The updater private key is read from TAURI_SIGNING_PRIVATE_KEY, or from %USERPROFILE%\.tauri\mytranslate-updater.key.
// Output: release/<version>/ with the installers, their signatures and latest.json. Publish the whole folder
// content at --url (the version folder keeps old releases apart).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

// Public address of the R2 bucket below; installed apps look for `latest.json` here.
const R2_URL = 'https://pub-69dc6a2e1f5e440cba0e4352a80177f8.r2.dev/'
const R2_ACCOUNT = 'c74342fd8c0005fcf5e2ec19a612d485'
const R2_BUCKET = 'mytranslate-releases'

const channel = arg('--channel') ?? 'stable'
if (channel !== 'stable' && channel !== 'staging') {
  console.error('--channel is stable or staging')
  process.exit(2)
}
const staging = channel === 'staging'
// Where the channel lives in the bucket: the stable release at the top, staging in its own folder.
const prefix = staging ? 'staging/' : ''
const channelUrl = `${R2_URL}${prefix}`

let url = arg('--url') ?? process.env.MYTRANSLATE_RELEASE_URL ?? channelUrl
if (!url.endsWith('/')) url += '/'
const publish = args.includes('--publish')
if (publish && url !== channelUrl) {
  console.error(`--publish uploads to the R2 bucket, so --url must be ${channelUrl}`)
  process.exit(2)
}
const notes = arg('--notes') ?? ''

const readJson = (file) => JSON.parse(readFileSync(join(app, 'src-tauri', file), 'utf8'))
const conf = readJson('tauri.conf.json')
let config = arg('--config') ? JSON.parse(arg('--config')) : null
if (staging) {
  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim()
  const { $schema, ...overlay } = readJson('tauri.staging.conf.json')
  config = { ...overlay, version: `${conf.version}-staging.${commits}`, ...config }
}
const extraConfig = config ? JSON.stringify(config) : undefined
const version = config?.version ?? conf.version
const productName = config?.productName ?? conf.productName

const env = { ...process.env, MYTRANSLATE_UPDATE_URL: `${url}latest.json` }
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyFile = join(homedir(), '.tauri', 'mytranslate-updater.key')
  if (!existsSync(keyFile)) {
    console.error(`No updater key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyFile} (npx tauri signer generate)`)
    process.exit(2)
  }
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, 'utf8').trim()
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''

console.log(`Building ${productName} ${version}, updates from ${url}latest.json`)
// Passed as a file, so the JSON never goes through a shell.
const configFile = join(app, 'release', 'build-config.json')
if (extraConfig) {
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, extraConfig)
}
const cli = join(app, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const build = [cli, 'build', ...(extraConfig ? ['--config', configFile] : [])]
execFileSync(process.execPath, build, { cwd: app, env, stdio: 'inherit' })

const bundle = join(app, 'src-tauri', 'target', 'release', 'bundle')
const out = join(app, 'release', version)
mkdirSync(out, { recursive: true })
const pick = (dir, suffix) => {
  const f = readdirSync(join(bundle, dir)).find((n) => n.includes(`_${version}_`) && n.endsWith(suffix))
  if (!f) throw new Error(`no ${suffix} for ${version} in ${dir}`)
  return f
}
const setup = pick('nsis', '-setup.exe')
const msi = staging ? null : pick('msi', '.msi')
const files = [['nsis', setup], ['nsis', `${setup}.sig`], ...(msi ? [['msi', msi]] : [])]
for (const [dir, f] of files) copyFileSync(join(bundle, dir, f), join(out, f))

// The NSIS installer is what the updater runs: per user, no administrator rights needed.
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(join(bundle, 'nsis', `${setup}.sig`), 'utf8').trim(),
      url: `${url}${version}/${encodeURIComponent(setup)}`,
    },
  },
}
writeFileSync(join(app, 'release', 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
if (!publish) {
  console.log(`\nPublish the content of ${join(app, 'release')} at ${url}:`)
  console.log(`  latest.json\n  ${version}/${setup}${msi ? `\n  ${version}/${msi}` : ''}`)
  process.exit(0)
}

// The installers go up first and latest.json last, so an app never sees a release that is still uploading.
const wranglerEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT }
const put = (key, file, contentType, extra = []) => {
  console.log(`Uploading ${key}`)
  const cmd = ['wrangler', 'r2', 'object', 'put', `${R2_BUCKET}/${key}`, '--file', file, '--remote']
  cmd.push('--content-type', contentType, ...extra)
  // Runs npx's script with this Node directly: npx itself is a .cmd on Windows, which needs a shell.
  const npx = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  execFileSync(process.execPath, [npx, '--yes', ...cmd], { cwd: app, env: wranglerEnv, stdio: 'inherit' })
}
for (const f of [setup, msi].filter(Boolean)) put(`${prefix}${version}/${f}`, join(out, f), 'application/octet-stream')
put(`${prefix}latest.json`, join(app, 'release', 'latest.json'), 'application/json', ['--cache-control', 'no-cache'])
console.log(`\nPublished ${version}: ${url}latest.json`)
