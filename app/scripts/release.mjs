// Builds a release that installed apps can update to, and lays out the files to publish.
//
//   node scripts/release.mjs --url https://updates.example.com/mytranslate/ [--notes "Có gì mới"] [--config <json>]
//
// --url is the folder the files will be published at; the app looks for `<url>latest.json`.
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

let url = arg('--url') ?? process.env.MYTRANSLATE_RELEASE_URL
if (!url) {
  console.error('usage: node scripts/release.mjs --url <folder URL> [--notes "..."]')
  process.exit(2)
}
if (!url.endsWith('/')) url += '/'
const notes = arg('--notes') ?? ''
const extraConfig = arg('--config')

const conf = JSON.parse(readFileSync(join(app, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const version = extraConfig ? (JSON.parse(extraConfig).version ?? conf.version) : conf.version

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

console.log(`Building MyTranslate ${version}, updates from ${url}latest.json`)
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
const msi = pick('msi', '.msi')
for (const [dir, f] of [['nsis', setup], ['nsis', `${setup}.sig`], ['msi', msi]]) copyFileSync(join(bundle, dir, f), join(out, f))

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
console.log(`\nPublish the content of ${join(app, 'release')} at ${url}:`)
console.log(`  latest.json\n  ${version}/${setup}\n  ${version}/${msi}`)
