export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/+$/, '');
  const configuredOrigin = process.env.WEB_ORIGIN?.replace(/\/+$/, '');

  if (configuredOrigin && normalizedOrigin === configuredOrigin) {
    return true;
  }

  return /^https?:\/\/localhost:\d+$/i.test(normalizedOrigin)
    || /^https?:\/\/127\.0\.0\.1:\d+$/i.test(normalizedOrigin)
    || /^https?:\/\/\[::1\]:\d+$/i.test(normalizedOrigin);
}
