import { handleRequest } from '../danmu_api/worker.js';

// Keep the platform Request body/method intact; GET/HEAD have no body.
// Private request URLs and authentication headers must never be logged.
export function buildEdgeRequest(request) {
  const baseUrl = 'https://localhost';
  const targetUrl = request.url.includes('node-functions/index.js') ? '/' : request.url;
  const fullUrl = new URL(targetUrl, baseUrl).toString();
  const clientIp = request.headers.get('eo-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  return { request: new Request(fullUrl, request), clientIp };
}

export const onRequest = async ({ request, env }) => {
  let input;
  try { input = buildEdgeRequest(request); }
  catch { return new Response('Invalid URL', { status: 400 }); }
  return handleRequest(input.request, env, 'edgeone', input.clientIp);
};
