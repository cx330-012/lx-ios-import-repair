const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const zlib = require('node:zlib')
const { stripTypeScriptTypes } = require('node:module')

const sourceRoot = path.resolve(process.argv[2] || 'work/fixed')
const pako = require(path.resolve(process.argv[3] || 'work/test-vendor/pako.cjs'))
const codecSource = fs.readFileSync(path.join(sourceRoot, 'src/utils/iosCompression.js'), 'utf8')
const codec = vm.runInNewContext(`(function () {
  ${codecSource.replace(/^import .*$/gm, '').replace(/^export /gm, '')}
  return { gzipBase64, ungzipBase64 }
})()`, { Buffer, gzip: pako.gzip, ungzip: pako.ungzip })

let passes = 0
function check(name, run) {
  return Promise.resolve().then(run).then(() => { passes++; console.log(`PASS ${name}`) })
}

const files = new Map()
const calls = []
const RNFS = {
  CachesDirectoryPath: '/sandbox/Library/Caches',
  DocumentDirectoryPath: '/sandbox/Documents',
  readFile: async (name, encoding = 'utf8') => {
    if (!files.has(name)) throw new Error('ENOENT')
    return files.get(name).toString(encoding)
  },
  writeFile: async (name, data, encoding = 'utf8') => { files.set(name, Buffer.from(data, encoding)) },
  readDir: async () => [
    { name: '备份.lxmc', path: '/sandbox/Documents/备份.lxmc', size: 128, mtime: new Date(1234), isFile: () => true, isDirectory: () => false },
    { name: '文件夹', path: '/sandbox/Documents/文件夹', size: 0, mtime: new Date(2345), isFile: () => false, isDirectory: () => true },
  ],
}
function loadFs(os, picker) {
  let source = fs.readFileSync(path.join(sourceRoot, 'src/utils/fs.ts'), 'utf8').replace(/\r\n/g, '\n')
  source = source.replace(/import type \{[\s\S]*?\} from 'react-native-file-system'\n/, '')
    .replace(/export type \{[\s\S]*?\}\n/, '')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  source = stripTypeScriptTypes(source)
  return vm.runInNewContext(`(function () {
    ${source}
    return { selectFile, gzipFile, unGzipFile, readDir }
  })()`, {
    Platform: { OS: os }, NativeModules: { LXDocumentPicker: picker }, RNFS,
    ...codec,
    require: name => {
      assert.equal(name, 'react-native-file-system')
      assert.equal(os, 'android', 'iOS must not require the Android-only module')
      return {
        Dirs: {},
        AndroidScoped: { openDocument: async options => { calls.push(['android-select', options]); return { data: '/android/file.js' } } },
        FileSystem: {
          gzipFile: async (...args) => { calls.push(['android-gzip', ...args]) },
          unGzipFile: async (...args) => { calls.push(['android-ungzip', ...args]) },
        },
      }
    },
  })
}

async function main() {
  const api = loadFs('ios', { openDocument: async directory => ({ data: `${directory}/unique/中文 音源.js` }) })
  const backup = Buffer.from(JSON.stringify({ type: 'playList_v2', data: [{ name: '中文 🎵', list: [] }] }))
  await check('iOS opens the native picker and preserves the selected filename', async () => {
    const result = await api.selectFile({ toPath: '/cache/tempFile', extTypes: ['js'] })
    assert.equal(result.data, '/cache/tempFile/unique/中文 音源.js')
  })
  await check('cancelling the picker returns null', async () => {
    const cancelled = loadFs('ios', { openDocument: async () => null })
    assert.equal(await cancelled.selectFile({}), null)
  })
  await check('missing native picker reports an actionable error', async () => {
    await assert.rejects(loadFs('ios').selectFile({}), /document picker is missing/)
  })
  await check('picker read failures propagate to the UI', async () => {
    const broken = loadFs('ios', { openDocument: async () => { throw new Error('File provider unavailable') } })
    await assert.rejects(broken.selectFile({}), /File provider unavailable/)
  })
  await check('gzip backup produced independently by zlib imports byte for byte', async () => {
    files.set('/backup.lxmc', zlib.gzipSync(backup))
    await api.unGzipFile('/backup.lxmc', '/unpacked.json')
    assert.deepEqual(files.get('/unpacked.json'), backup)
    assert.equal(JSON.parse(files.get('/unpacked.json')).data[0].name, '中文 🎵')
  })
  await check('iOS gzip export can be decompressed by zlib', async () => {
    files.set('/original.json', backup)
    await api.gzipFile('/original.json', '/export.lxmc')
    assert.deepEqual(zlib.gunzipSync(files.get('/export.lxmc')), backup)
  })
  await check('binary and empty data survive compression', () => {
    for (const raw of [Buffer.alloc(0), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]) {
      const encoded = codec.gzipBase64(raw.toString('base64'))
      assert.deepEqual(zlib.gunzipSync(Buffer.from(encoded, 'base64')), raw)
      assert.equal(codec.ungzipBase64(encoded), raw.toString('base64'))
    }
  })
  await check('corrupt backup rejects without overwriting the destination', async () => {
    files.set('/corrupt.lxmc', Buffer.from('not a gzip stream'))
    files.set('/preserve.json', backup)
    await assert.rejects(api.unGzipFile('/corrupt.lxmc', '/preserve.json'), /Unable to decompress backup/)
    assert.deepEqual(files.get('/preserve.json'), backup)
  })
  await check('RNFS methods are converted into boolean file/directory flags', async () => {
    const entries = await api.readDir('/sandbox/Documents')
    assert.equal(entries[0].isFile, true)
    assert.equal(entries[0].isDirectory, false)
    assert.equal(entries[0].lastModified, 1234)
    assert.equal(entries[1].isDirectory, true)
    assert.equal(entries[1].isFile, false)
  })
  await check('Android picker and compression still delegate to the original module', async () => {
    const android = loadFs('android')
    assert.equal((await android.selectFile({ extTypes: ['js'] })).data, '/android/file.js')
    await android.gzipFile('a', 'b')
    await android.unGzipFile('b', 'a')
    assert.deepEqual(calls.map(c => c[0]), ['android-select', 'android-gzip', 'android-ungzip'])
  })
  console.log(`${passes} checks passed. UIKit presentation and device imports require a macOS build and iPhone test.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
