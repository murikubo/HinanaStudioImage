const { spawnSync } = require('node:child_process');
const path = require('node:path');

function verify(appPath) {
  const result = spawnSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `macOS bundle signature verification failed: ${appPath}\n${result.stderr || result.error?.message || ''}`,
    );
  }
  console.log(`Verified complete macOS bundle signature: ${appPath}`);
}

// Run after electron-builder has signed the final app, before it creates the DMG.
module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  verify(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
};
if (require.main === module) {
  if (!process.argv[2])
    throw new Error('Usage: node scripts/verify-mac-signature.cjs /path/to/App.app');
  verify(path.resolve(process.argv[2]));
}
