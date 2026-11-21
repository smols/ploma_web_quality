export function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    if (originHost === hostname) return true;
    const configuredOrigin = process.env.APP_PUBLIC_ORIGIN;
    if (!configuredOrigin) return false;
    return new URL(origin).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}
