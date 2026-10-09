/* Human output for explicitly requested SSH observations. */
import type { AuthTestEndpoint } from '../application/auth-test.js';

/** Render observed identity without promoting it into a push-verification verdict. */
export function renderAuthTest(endpoints: AuthTestEndpoint[]): string {
  return endpoints.map((endpoint, index) => {
    const { result } = endpoint;
    const expected = endpoint.expected ? JSON.stringify(endpoint.expected).slice(1, -1) : undefined;
    const account = result.outcome === 'mismatch'
      ? `Mismatch: observed ${result.account}, role expects ${expected}`
      : result.outcome === 'observed'
        ? `Authenticated as: ${result.account}\n${endpoint.expected ? `Role expects: ${expected}` : 'Role account expectation: not configured'}`
        : `Account: unobserved (${result.reason})`;
    return [
      `Destination: ${endpoint.destination ?? `endpoint ${index + 1} (not displayed)`}`,
      ...(endpoint.host ? [`Host: ${endpoint.host}`] : []), account,
      `Checked: ${endpoint.checked}`,
      'This connection does not guarantee the account or success of a future push.'
    ].join('\n');
  }).join('\n\n');
}
