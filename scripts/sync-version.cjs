const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw Error('Use a numeric major.minor.patch release version.');
const androidPath = path.join(root, 'android/app/build.gradle');
const android = fs.readFileSync(androidPath, 'utf8');
const previous = android.match(/versionName "([^"]+)"/)[1];
const code = Number(android.match(/versionCode (\d+)/)[1]) + (previous !== version ? 1 : 0);
fs.writeFileSync(
  androidPath,
  android
    .replace(/versionName "[^"]+"/, `versionName "${version}"`)
    .replace(/versionCode \d+/, `versionCode ${code}`),
);
const iosPath = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
const ios = fs.readFileSync(iosPath, 'utf8');
const oldIOS = ios.match(/MARKETING_VERSION = ([^;]+);/)[1];
const build =
  Number(ios.match(/CURRENT_PROJECT_VERSION = (\d+);/)[1]) + (oldIOS !== version ? 1 : 0);
fs.writeFileSync(
  iosPath,
  ios
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${build};`),
);
console.log(`Version ${version}; Android build ${code}, iOS build ${build}`);
