/* Explicit connection observations, kept separate from alignment verdicts. */
import type { RemoteInfo } from '../adapters/git-repository.js';
import type { CurrentRoleDependencies, GitRepository } from './contracts.js';
import { getCurrentRole } from './use-cases/role.js';

/** One connection outcome; an observed account is not a future-push guarantee. */
export type AuthObservation =
  | { outcome: 'observed'; account: string }
  | { outcome: 'unobserved'; reason: string }
  | { outcome: 'cancelled'; reason: string };

/** Explicit execution boundary; never used by automatic diagnosis. */
export interface AuthTester {
  observe(remote: RemoteInfo, signal: AbortSignal): Promise<AuthObservation>;
}

/** Endpoint-scoped human test result, with mismatch distinct from observation. */
export interface AuthTestEndpoint {
  destination?: string;
  host?: string;
  checked: string;
  expected?: string;
  result: AuthObservation | { outcome: 'mismatch'; account: string };
}

/** Reject ambiguous or potentially secret URLs before exposing them or starting SSH. */
export function isSafeAuthDestination(remote: RemoteInfo): boolean {
  if (/[\x00-\x20\x7f?#]/.test(remote.url)) return false;
  if (remote.url.includes('://')) {
    try {
      const url = new URL(remote.url);
      if (url.password || url.search || url.hash || (url.username && url.protocol !== 'ssh:')) return false;
    } catch { return false; }
  }
  return remote.protocol === 'ssh' && Boolean(remote.host && remote.path) &&
    /^[a-zA-Z0-9_.:[\]-]+$/.test(remote.host!) && !remote.host!.startsWith('-') &&
    (!remote.user || /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(remote.user)) &&
    !/[\x00-\x1f\x7f]/.test(remote.path!) &&
    (remote.port === undefined || (Number.isInteger(remote.port) && remote.port > 0 && remote.port <= 65535));
}

/** Test every resolved endpoint against the effective role's optional account expectation. */
export async function testAuthentication(
  dependencies: CurrentRoleDependencies & { repository: GitRepository; authTester: AuthTester },
  signal: AbortSignal
): Promise<{ endpoints: AuthTestEndpoint[]; exitCode: number }> {
  if (!await dependencies.repository.isInsideWorkTree()) throw new Error('Run gitrole auth test inside a Git worktree.');
  const current = await getCurrentRole(dependencies);
  const push = await dependencies.repository.getPushDestination?.();
  if (!push || push.message === 'no configured default push destination') throw new Error('No default push destination could be resolved.');
  if (push.message || !push.targets.length) return { endpoints: [{ checked: new Date().toISOString(), result: { outcome: 'unobserved', reason: 'default push destination is unsupported or unresolved' } }], exitCode: 2 };
  const endpoints: AuthTestEndpoint[] = [];
  for (const remote of push.targets) {
    const safe = isSafeAuthDestination(remote);
    const result: AuthObservation = signal.aborted
      ? { outcome: signal.reason === 'cancelled' ? 'cancelled' : 'unobserved', reason: signal.reason === 'cancelled' ? 'cancelled' : 'time budget exhausted' }
      : !safe ? { outcome: 'unobserved', reason: 'unsupported or unsafe destination' }
      : !push.transport.supported ? { outcome: 'unobserved', reason: 'unsupported SSH transport or command override' }
      : await dependencies.authTester.observe(remote, signal);
    const expected = current.role?.githubUser;
    endpoints.push({
      ...(safe ? { destination: remote.url, host: remote.host } : {}),
      checked: new Date().toISOString(), expected,
      result: result.outcome === 'observed' && expected && result.account !== expected
        ? { outcome: 'mismatch', account: result.account } : result
    });
  }
  return { endpoints, exitCode: endpoints.some(e => e.result.outcome === 'cancelled') ? 130 :
    endpoints.every(e => e.result.outcome === 'observed') ? 0 : 2 };
}
