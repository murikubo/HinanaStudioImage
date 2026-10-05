const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const env = { ...process.env };
if (!env.JAVA_HOME && process.platform === 'darwin') {
  const java = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
  if (fs.existsSync(java)) env.JAVA_HOME = java;
}
if (!env.ANDROID_HOME && process.platform === 'darwin') {
  const sdk = path.join(os.homedir(), 'Library/Android/sdk');
  if (fs.existsSync(sdk)) env.ANDROID_HOME = sdk;
}
if (!env.DEVELOPER_DIR && fs.existsSync('/Applications/Xcode.app/Contents/Developer')) {
  env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
}
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (args.includes('--open-ios')) {
  if (process.platform !== 'darwin') throw Error('Xcode requires macOS.');
  run('open', ['ios/App/App.xcodeproj']);
} else if (args.includes('--open-android')) {
  if (process.platform === 'darwin') run('open', ['-a', 'Android Studio', 'android']);
  else run('studio', ['android']);
} else {
  if (!args.includes('--ios')) run(process.platform === 'win32' ? 'android\\gradlew.bat' : './android/gradlew', ['-p', 'android', 'assembleDebug']);
  if (!args.includes('--android') && process.platform === 'darwin') {
    run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'release/ios-native-simulator', '-clonedSourcePackagesDirPath', 'release/ios-packages', 'CODE_SIGNING_ALLOWED=NO', 'build']);
  }
}
