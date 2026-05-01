const TARGET = 'https://api.store.friendly-pharmacist.com';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(context.request.url);
  const targetUrl = `${TARGET}${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('origin');
  headers.delete('referer');

  const init = { method: context.request.method, headers };
  if (!['GET', 'HEAD'].includes(context.request.method)) {
    init.body = context.request.body;
  }

  const res = await fetch(targetUrl, init);

  const responseHeaders = new Headers(res.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}
