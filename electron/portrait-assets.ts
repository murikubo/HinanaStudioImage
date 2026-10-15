import { app, protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hinana-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
export function registerPortraitAssets() {
  protocol.handle('hinana-asset', (request) => {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      url.hostname !== 'portrait' ||
      !/^(?:face_landmarker\.task|pose_landmarker_lite\.task|wasm\/vision_wasm_(?:module_|nosimd_)?internal\.(?:js|wasm))$/.test(
        name,
      )
    )
      return new Response('Not found', { status: 404 });
    const root = path.join(__dirname, '..', app.isPackaged ? 'dist' : 'public', 'portrait');
    return net.fetch(pathToFileURL(path.join(root, name)).href).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set(
        'Content-Type',
        name.endsWith('.js')
          ? 'application/javascript'
          : name.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
      );
      return new Response(response.body, { status: response.status, headers });
    });
  });
}
