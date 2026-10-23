import https from 'node:https';
import { isMain } from './is-main.js';

export async function healthcheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = https.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/healthz',
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

if (isMain(import.meta.url)) {
  const port = Number(process.env.HTTPS_PORT ?? 8443);
  process.exitCode =
    Number.isSafeInteger(port) && port > 0 && (await healthcheck(port)) ? 0 : 1;
}
