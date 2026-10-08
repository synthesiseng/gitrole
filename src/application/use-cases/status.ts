/*
 * Produces the compact status summary shown by the CLI.
 */
import {
  describeHttpsAuth,
  findMatchingRole,
  findPinnedRole,
  formatHttpsPushAuth,
  summarizeAlignment, summarizeSshMessage,
  type HttpsAuthDescription
} from '../alignment.js';
import { UNMATCHED_ROLE_NAME } from '../../domain/role.js';
import type { DoctorDependencies, DoctorResult, NonMergeCommit, StatusResult } from '../contracts.js';
import { collectObservedState, type ObservedState } from '../observed-state.js';
import { evaluateRepoPolicy, loadOptionalRepoPolicy } from '../repo-policy.js';

export interface StatusOptions {
  /**
   * Skip the live SSH githubUser probe.
   * SSH `auth` is `na`. HTTPS pin checks still use the saved role and `.gitrole`.
   */
  offline?: boolean;
}

/**
 * Returns a compact alignment summary for the current environment.
 */
export async function getStatus(
  dependencies: DoctorDependencies,
  options: StatusOptions = {}
): Promise<StatusResult> {
  const offline = options.offline === true;
  const verification = await collectStatusContext(dependencies, offline);
  const { observedState, role, repoPolicy, pinnedRole, lastNonMergeCommit } = verification;
  const commitIdentity = formatCommitIdentity(observedState.commitIdentity);
  const httpsAuth =
    observedState.repository.remote?.protocol === 'https'
      ? describeHttpsAuth({ role, repoPolicy, pinnedRole })
      : undefined;
  const summary = summarizeAlignment({
    role,
    observedState,
    repoPolicy,
    pinnedRole,
    offline
  });

  return {
    roleName: role?.name ?? UNMATCHED_ROLE_NAME,
    commitIdentity,
    pushAuth: formatPushAuth(role, observedState, httpsAuth, offline),
    scope: observedState.scope.effective,
    localOverride: observedState.scope.hasLocalOverride,
    lastNonMergeCommit,
    historyNote: formatHistoryNote(observedState.commitIdentity, lastNonMergeCommit),
    envNote: formatEnvNote(observedState),
    overall: summary.overall,
    commit: summary.commit,
    remote: summary.remote,
    auth: summary.auth,
    policy: summary.policy,
    repoPolicy
  };
}

async function collectStatusContext(
  dependencies: DoctorDependencies,
  offline: boolean
): Promise<{
  observedState: ObservedState;
  role?: DoctorResult['role'];
  repoPolicy?: StatusResult['repoPolicy'];
  pinnedRole?: DoctorResult['role'];
  lastNonMergeCommit?: NonMergeCommit;
}> {
  const [roles, observedState, repoPolicySource, lastNonMergeCommit] = await Promise.all([
    dependencies.roleStore.list(),
    collectObservedState(dependencies, { probeSsh: !offline }),
    loadOptionalRepoPolicy(dependencies.repository),
    dependencies.repository.getLatestNonMergeCommit()
  ]);
  const role = findMatchingRole(roles, observedState.commitIdentity);
  const repoPolicy = repoPolicySource ? evaluateRepoPolicy(repoPolicySource, role?.name) : undefined;

  return {
    observedState,
    role,
    repoPolicy,
    pinnedRole: findPinnedRole(roles, repoPolicy),
    lastNonMergeCommit
  };
}

function formatCommitIdentity(identity: DoctorResult['commitIdentity']): string | undefined {
  if (!identity.fullName.value || !identity.email.value) {
    return undefined;
  }

  return `${identity.fullName.value} <${identity.email.value}>`;
}

function formatPushAuth(
  role: DoctorResult['role'],
  observedState: {
    repository: DoctorResult['repository'];
    sshAuth?: DoctorResult['sshAuth'];
  },
  httpsAuth?: HttpsAuthDescription,
  offline = false
): string | undefined {
  if (observedState.repository.push) {
    const push = observedState.repository.push;
    if (push.targets.length === 1 && push.targets[0].remote.protocol === 'https' && httpsAuth) return formatHttpsPushAuth(httpsAuth);
    if (push.message || !push.targets.length) return push.message ?? 'push destination unverified';
    return push.targets.map(({ remote, sshAuth, message }) =>
      sshAuth?.ok && sshAuth.githubUser ? `${sshAuth.githubUser} via ${remote.host}` :
      `${remote.name} ${remote.url} (${offline && remote.protocol === 'ssh' ? 'SSH authentication skipped (--offline); local checks only. An online check may connect and run configured SSH commands or change SSH state.' : message ?? (sshAuth?.message ? summarizeSshMessage(sshAuth.message) : 'authentication unverified')})`
    ).join('; ');
  }
  if (observedState.sshAuth?.githubUser) {
    return `${observedState.sshAuth.githubUser} via ${observedState.sshAuth.host}`;
  }

  if (observedState.repository.remote?.protocol === 'https') {
    return httpsAuth ? formatHttpsPushAuth(httpsAuth) : 'HTTPS (SSH auth not applicable)';
  }

  if (role?.githubUser && role?.githubHost) {
    return `${role.githubUser} via ${role.githubHost}`;
  }

  if (role?.githubUser) {
    return role.githubUser;
  }

  if (role?.githubHost) {
    return role.githubHost;
  }

  return undefined;
}

function formatHistoryNote(
  commitIdentity: DoctorResult['commitIdentity'],
  lastNonMergeCommit?: NonMergeCommit
): string | undefined {
  const effectiveIdentity = formatCommitIdentity(commitIdentity);

  if (!effectiveIdentity || !lastNonMergeCommit) {
    return undefined;
  }

  const isMismatch =
    commitIdentity.fullName.value !== lastNonMergeCommit.authorName ||
    commitIdentity.email.value !== lastNonMergeCommit.authorEmail;

  if (!isMismatch) {
    return undefined;
  }

  return `last non-merge commit used ${lastNonMergeCommit.authorName} <${lastNonMergeCommit.authorEmail}>`;
}

function formatEnvNote(observedState: ObservedState): string | undefined {
  const notes: string[] = [];

  if (observedState.commitEnv.authorEmail) {
    notes.push(`GIT_AUTHOR_EMAIL ${observedState.commitEnv.authorEmail}`);
  }

  if (observedState.commitEnv.authorName) {
    notes.push(`GIT_AUTHOR_NAME ${observedState.commitEnv.authorName}`);
  }

  if (observedState.commitEnv.committerEmail) {
    notes.push(`GIT_COMMITTER_EMAIL ${observedState.commitEnv.committerEmail}`);
  }

  if (observedState.commitEnv.committerName) {
    notes.push(`GIT_COMMITTER_NAME ${observedState.commitEnv.committerName}`);
  }

  return notes.length > 0 ? notes.join(', ') : undefined;
}
