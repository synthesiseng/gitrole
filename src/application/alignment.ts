/*
 * Shared alignment primitives consumed by stable status summaries and diagnosis flows.
 */
import { matchesIdentity, type Role } from '../domain/role.js';
import type { DoctorResult, RepoPolicyEvaluation, StatusResult } from './contracts.js';
import type { ObservedState } from './observed-state.js';

const httpsAlignedMessage = 'origin uses HTTPS; SSH auth verification does not apply';
const httpsNoIdentityPinMessage = 'origin uses HTTPS and no identity pin is configured';
const httpsNoRepoPinMessage = 'origin uses HTTPS and no repo pin is configured';

export type HttpsAuthReason = 'aligned' | 'no-identity-pin' | 'no-repo-pin' | 'mismatch';

export interface HttpsAuthDescription {
  auth: 'na' | 'warn';
  reason: HttpsAuthReason;
  message: string;
}

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

export function findPinnedRole(
  roles: Role[],
  repoPolicy?: { defaultRole: string }
): Role | undefined {
  if (!repoPolicy) {
    return undefined;
  }

  return roles.find((candidate) => candidate.name === repoPolicy.defaultRole);
}

/**
 * HTTPS auth is `na` only when a repo pin allows the active role and that role
 * has a githubUser. Missing that pin warns. A pin that does not allow the active
 * role warns, and names the github user when it differs from the pin.
 */
export function describeHttpsAuth(input: {
  role?: Role;
  repoPolicy?: RepoPolicyEvaluation;
  pinnedRole?: Role;
}): HttpsAuthDescription {
  const { role, repoPolicy } = input;
  const pinnedGithubUser =
    input.pinnedRole?.githubUser ??
    (role && repoPolicy && role.name === repoPolicy.defaultRole ? role.githubUser : undefined);
  const policyAllows = Boolean(repoPolicy && repoPolicy.status !== 'notAllowed');

  if (policyAllows && role?.githubUser) {
    return {
      auth: 'na',
      reason: 'aligned',
      message: httpsAlignedMessage
    };
  }

  if (repoPolicy?.status === 'notAllowed') {
    if (role?.githubUser && pinnedGithubUser && role.githubUser !== pinnedGithubUser) {
      return {
        auth: 'warn',
        reason: 'mismatch',
        message: `origin uses HTTPS; github user ${role.githubUser} does not match pin ${pinnedGithubUser}`
      };
    }

    return {
      auth: 'warn',
      reason: 'mismatch',
      message: `origin uses HTTPS; active identity does not match pinned role ${repoPolicy.defaultRole}`
    };
  }

  if (!role?.githubUser) {
    return {
      auth: 'warn',
      reason: 'no-identity-pin',
      message: httpsNoIdentityPinMessage
    };
  }

  return {
    auth: 'warn',
    reason: 'no-repo-pin',
    message: httpsNoRepoPinMessage
  };
}

export function formatHttpsPushAuth(description: HttpsAuthDescription): string {
  switch (description.reason) {
    case 'aligned':
      return 'HTTPS (SSH auth not applicable)';
    case 'mismatch':
      return 'HTTPS (github user does not match pin)';
    case 'no-identity-pin':
      return 'HTTPS (no identity pin)';
    case 'no-repo-pin':
      return 'HTTPS (no repo pin)';
  }
}

export function summarizeAlignment(input: {
  role?: Role;
  observedState: ObservedState;
  repoPolicy?: RepoPolicyEvaluation;
  pinnedRole?: Role;
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

  if (commitEnvDisagrees(observedState)) {
    return 'warn';
  }

  if (
    observedState.repository.isInsideWorkTree &&
    observedState.repository.hasCommits === false &&
    observedState.scope.effective !== 'local'
  ) {
    return 'warn';
  }

  return 'ok';
}

function commitEnvDisagrees(observedState: ObservedState): boolean {
  const authorName = observedState.commitIdentity.fullName.value;
  const authorEmail = observedState.commitIdentity.email.value;
  const committerName = observedState.commitEnv?.committerName;
  const committerEmail = observedState.commitEnv?.committerEmail;

  if (committerEmail && committerEmail !== authorEmail) {
    return true;
  }

  if (committerName && committerName !== authorName) {
    return true;
  }

  return false;
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
  repoPolicy?: RepoPolicyEvaluation;
  pinnedRole?: Role;
}): StatusResult['auth'] {
  const { observedState, role } = input;

  if (!observedState.repository.isInsideWorkTree || !observedState.repository.remote) {
    return 'na';
  }

  // SSH auth cannot be probed on HTTPS. Quiet na is only the pinned match.
  if (observedState.repository.remote.protocol === 'https') {
    return describeHttpsAuth({
      role,
      repoPolicy: input.repoPolicy,
      pinnedRole: input.pinnedRole
    }).auth;
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
