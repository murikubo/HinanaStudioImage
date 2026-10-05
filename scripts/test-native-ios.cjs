// Diagnostics create fixtures only in an isolated simulator, never a connected iPhone.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = { ...process.env };
if (!env.DEVELOPER_DIR && fs.existsSync('/Applications/Xcode.app/Contents/Developer'))
  env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
function run(args, optional = false) {
  const r = spawnSync('xcrun', ['simctl', ...args], { env, encoding: 'utf8', timeout: 180000 });
  if (r.error || (r.status !== 0 && !optional)) throw r.error || Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
const app = path.resolve(process.argv[2] || 'release/ios-native-simulator/Build/Products/Debug-iphonesimulator/App.app');
if (!fs.existsSync(app)) throw Error('Run npm run build:mobile -- --ios first.');
const runtimes = JSON.parse(run(['list', 'runtimes', '--json'])).runtimes
  .filter(r => r.isAvailable && r.identifier.includes('.iOS-'))
  .sort((a,b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
if (!runtimes.length) throw Error('Install an iOS simulator runtime in Xcode.');
const types = JSON.parse(run(['list', 'devicetypes', '--json'])).devicetypes;
const runtime = runtimes.at(-1);
const version = runtime.version.split('.').map(Number);
const packed = (version[0] << 16) + ((version[1] || 0) << 8) + (version[2] || 0);
const type = runtime.supportedDeviceTypes?.find(t => t.name.startsWith('iPhone')) ||
  types.find(t => t.name.startsWith('iPhone') && t.minRuntimeVersion <= packed && t.maxRuntimeVersion >= packed);
if (!type) throw Error('No compatible iPhone simulator device type is available.');
const device = run(['create', `HinanaNativeTests-${Date.now()}`, type.identifier, runtimes.at(-1).identifier]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    run(['boot', device]);
    run(['bootstatus', device, '-b']);
    run(['install', device, app]);
    run(['launch', device, 'studio.hinana.image', '--native-self-test', '--native-migration-self-test']);
    const container = run(['get_app_container', device, 'studio.hinana.image', 'data']);
    const directory = path.join(container, 'Library/Application Support/NativeImageLibrary');
    let results;
    for (let retry = 0; retry < 120; retry++) {
      const files = ['native-diagnostics.json', 'migration-diagnostics.json'];
      if (files.every(file => fs.existsSync(path.join(directory, file)))) {
        results = files.map(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
        break;
      }
      await delay(1000);
    }
    if (!results) throw Error('Native diagnostics timed out.');
    const [checks, migration] = results;
    const failures = checks.filter(c => c.pass !== true);
    if (failures.length || migration.pass !== true) throw Error(JSON.stringify({ failures, migration }, null, 2));
    console.log(`iOS native: ${checks.length} checks passed; legacy workspace migration passed.`);
  } finally {
    run(['shutdown', device], true);
    run(['delete', device], true);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
