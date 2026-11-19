/**
 * Returns the URL path without its query string. Query strings may carry
 * sensitive values, so neither the request context nor error bodies keep them.
 */
export function getRequestPath(originalUrl: string): string {
  const queryStart = originalUrl.indexOf('?');
  return queryStart === -1 ? originalUrl : originalUrl.slice(0, queryStart);
}
