export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return handleCors(request);
  }

  try {
    const response = await context.next();
    return addCorsHeaders(response);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function handleCors(request) {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'OPTIONS, PROPFIND, MKCOL, PUT, GET, HEAD, DELETE, COPY, MOVE, LOCK, UNLOCK, POST');
  headers.set('Access-Control-Allow-Headers', 'Depth, Content-Type, Destination, Overwrite, Authorization, If, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since, Range, X-Requested-With');
  headers.set('Access-Control-Expose-Headers', 'DAV, Content-Length, Allow, ETag, Lock-Token');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

function addCorsHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'DAV, Content-Length, Allow, ETag, Lock-Token');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
