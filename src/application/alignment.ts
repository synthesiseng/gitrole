/*
 * Shared alignment primitives consumed by stable status summaries and diagnosis flows.
 */
import { matchesIdentity, type Role } from '../domain/role.js';
import type { DoctorResult, RepoPolicyEvaluation, StatusResult } from './contracts.js';
import type { ObservedState } from './observed-state.js';

export interface AlignmentSummary {
  overall: StatusResult['overall'];
  commit: StatusResult['commit'];
  remote: StatusResult['remote'];
  auth: StatusResult['auth'];
  policy: StatusResult['policy'];
}

export function findMatchingRole(
  roles: Role[],
  commitIdentity: DoctorResult['commitIdentity']
): Role | undefined {
  return roles.find((candidate) =>
    matchesIdentity(candidate, {
      fullName: commitIdentity.fullName.value,
      email: commitIdentity.email.value
    })
  );
}

export function summarizeAlignment(input: {
  role?: Role;
  observedState: ObservedState;
  repoPolicy?: RepoPolicyEvaluation;
}): AlignmentSummary {
  const commit = getCommitStatus(input);
  const remote = getRemoteStatus(input);
  const auth = getAuthStatus(input);
  const policy = getPolicyStatus(input.repoPolicy);
  const overall =
    !input.observedState.repository.isInsideWorkTree ||
    commit === 'warn' ||
    remote === 'warn' ||
    auth === 'warn' ||
    policy === 'warn'
      ? 'warning'
      : 'aligned';

  return {
    overall,
    commit,
    remote,
    auth,
    policy
  };
}

function getCommitStatus(input: {
  role?: Role;
  observedState: ObservedState;
}): StatusResult['commit'] {
  const { observedState, role } = input;

  if (
    !observedState.commitIdentity.fullName.value ||
    !observedState.commitIdentity.email.value ||
    observedState.scope.effective === 'mixed' ||
    !role
  ) {
    return 'warn';
  }

  if (hasIdentityDivergence(role, observedState)) {
    return 'warn';
  }

  return 'ok';
}

function getRemoteStatus(input: {
  role?: Role;
  observedState: ObservedState;
}): StatusResult['remote'] {
  const { observedState, role } = input;

  if (!observedState.repository.isInsideWorkTree) {
    return 'na';
  }

  if (!observedState.repository.remote || observedState.repository.hasCommits === false) {
    return 'warn';
  }

  if (
    role?.githubHost &&
    observedState.repository.remote.host &&
    observedState.repository.remote.host !== role.githubHost
  ) {
    return 'warn';
  }

  return 'ok';
}

function getAuthStatus(input: {
  role?: Role;
  observedState: ObservedState;
}): StatusResult['auth'] {
  const { observedState, role } = input;

  if (!observedState.repository.isInsideWorkTree || !observedState.repository.remote) {
    return 'na';
  }

  // SSH auth identity cannot be checked on HTTPS. That is not an actionable mismatch.
  if (observedState.repository.remote.protocol === 'https') {
    return 'na';
  }

  if (!observedState.sshAuth || !observedState.sshAuth.ok) {
    return 'warn';
  }

  if (role?.githubUser && observedState.sshAuth.githubUser !== role.githubUser) {
    return 'warn';
  }

  return 'ok';
}

function getPolicyStatus(repoPolicy?: RepoPolicyEvaluation): StatusResult['policy'] {
  if (!repoPolicy) {
    return 'na';
  }

  if (repoPolicy.status === 'notAllowed') {
    return 'warn';
  }

  return 'ok';
}

function hasIdentityDivergence(role: Role, observedState: ObservedState): boolean {
  return Boolean(
    observedState.sshAuth?.ok &&
      observedState.sshAuth.githubUser &&
      role.githubUser !== undefined &&
      observedState.sshAuth.githubUser !== role.githubUser &&
      observedState.commitIdentity.fullName.value &&
      observedState.commitIdentity.email.value
  );
}
