/*
 * Produces the compact status summary shown by the CLI.
 */
import {
  describeHttpsAuth,
  findMatchingRole,
  findPinnedRole,
  formatHttpsPushAuth,
  summarizeAlignment,
  type HttpsAuthDescription
} from '../alignment.js';
import type { DoctorDependencies, DoctorResult, NonMergeCommit, StatusResult } from '../contracts.js';
import { collectObservedState, type ObservedState } from '../observed-state.js';
import { evaluateRepoPolicy, loadOptionalRepoPolicy } from '../repo-policy.js';

/**
 * Returns a compact alignment summary for the current environment.
 */
export async function getStatus(
  dependencies: DoctorDependencies
): Promise<StatusResult> {
  const verification = await collectStatusContext(dependencies);
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
    pinnedRole
  });

  return {
    roleName: role?.name ?? 'no-role',
    commitIdentity,
    pushAuth: formatPushAuth(role, observedState, httpsAuth),
    scope: observedState.scope.effective,
    localOverride: observedState.scope.hasLocalOverride,
    lastNonMergeCommit,
    historyNote: formatHistoryNote(observedState.commitIdentity, lastNonMergeCommit),
    overall: summary.overall,
    commit: summary.commit,
    remote: summary.remote,
    auth: summary.auth,
    policy: summary.policy,
    repoPolicy
  };
}

async function collectStatusContext(
  dependencies: DoctorDependencies
): Promise<{
  observedState: ObservedState;
  role?: DoctorResult['role'];
  repoPolicy?: StatusResult['repoPolicy'];
  pinnedRole?: DoctorResult['role'];
  lastNonMergeCommit?: NonMergeCommit;
}> {
  const [roles, observedState, repoPolicySource, lastNonMergeCommit] = await Promise.all([
    dependencies.roleStore.list(),
    collectObservedState(dependencies),
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
  httpsAuth?: HttpsAuthDescription
): string | undefined {
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
