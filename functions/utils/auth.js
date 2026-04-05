const SESSION_COOKIE_NAME = 'k_vault_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000;

export function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function verifyBasicAuth(request, env) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;

  const [scheme, encoded] = authorization.split(' ');
  if (!encoded || scheme !== 'Basic') return null;

  try {
    const buffer = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(buffer).normalize();
    const index = decoded.indexOf(':');
    if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) return null;

    const user = decoded.substring(0, index);
    const pass = decoded.substring(index + 1);

    if (env.BASIC_USER === user && env.BASIC_PASS === pass) {
      return { user, authenticated: true };
    }
  } catch (e) {
    console.error('Basic auth decode error:', e);
  }
  return null;
}

export function getSessionFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME) return value;
  }
  return null;
}

export async function verifySession(sessionToken, env) {
  if (!sessionToken || !env.img_url) return false;
  try {
    const sessionData = await env.img_url.get(`session:${sessionToken}`, { type: 'json' });
    if (!sessionData) return false;
    if (Date.now() > sessionData.expiresAt) {
      await env.img_url.delete(`session:${sessionToken}`);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

export async function createSession(user, env) {
  const token = generateSessionToken();
  const sessionData = { user, createdAt: Date.now(), expiresAt: Date.now() + SESSION_DURATION };
  await env.img_url.put(`session:${token}`, JSON.stringify(sessionData), {
    expirationTtl: Math.floor(SESSION_DURATION / 1000)
  });
  return token;
}

export function isAuthRequired(env) {
  return env.BASIC_USER && env.BASIC_PASS;
}

export async function checkAuthentication(context) {
  const { request, env } = context;
  if (!isAuthRequired(env)) return { authenticated: true, reason: 'no-auth-required' };

  const sessionToken = getSessionFromCookie(request);
  if (sessionToken && await verifySession(sessionToken, env)) {
    return { authenticated: true, reason: 'session', token: sessionToken };
  }

  const basicAuth = verifyBasicAuth(request, env);
  if (basicAuth) return { authenticated: true, reason: 'basic-auth', user: basicAuth.user };

  return { authenticated: false };
}
