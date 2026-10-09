/*
 * Shared alignment primitives consumed by stable status summaries and diagnosis flows.
 */
import { matchesIdentity, type Role } from '../domain/role.js';
import type { DoctorCheck, DoctorResult, RepoPolicyEvaluation, StatusResult } from './contracts.js';
import type { ObservedState } from './observed-state.js';

const httpsAlignedMessage = 'push destination uses HTTPS; SSH auth verification does not apply';
const httpsNoIdentityPinMessage = 'push destination uses HTTPS and no identity pin is configured';
const httpsNoRepoPinMessage = 'push destination uses HTTPS and no repo pin is configured';

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
        message: `push destination uses HTTPS; github user ${role.githubUser} does not match pin ${pinnedGithubUser}`
      };
    }

    return {
      auth: 'warn',
      reason: 'mismatch',
      message: `push destination uses HTTPS; active identity does not match pinned role ${repoPolicy.defaultRole}`
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
  /**
   * Skip live SSH auth. HTTPS pin checks still run from local role and policy data.
   */
  offline?: boolean;
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
  offline?: boolean;
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

  if (!input.offline && hasIdentityDivergence(role, observedState)) {
    return 'warn';
  }

  if (commitEnvDisagrees(observedState)) {
    return 'warn';
  }

  if (
    observedState.repository.isInsideWorkTree &&
    observedState.repository.hasCommits === false &&
    !observedState.scope.hasLocalOverride
  ) {
    return 'warn';
  }

  return 'ok';
}

function commitEnvDisagrees(observedState: ObservedState): boolean {
  const authorName = observedState.commitIdentity.fullName.value;
  const authorEmail = observedState.commitIdentity.email.value;
  const committerName = observedState.committerIdentity?.fullName.value ?? observedState.commitEnv?.committerName;
  const committerEmail = observedState.committerIdentity?.email.value ?? observedState.commitEnv?.committerEmail;

  if (observedState.committerIdentity && (!committerName || !committerEmail)) return true;

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

  const push = observedState.repository.push;
  if (!push || push.message || push.targets.length === 0) return 'warn';
  if (push.targets.some(({ remote }) => remote.protocol === 'unknown' ||
    (role?.githubHost && remote.host && remote.host !== role.githubHost))) return 'warn';
  return 'ok';
}

function getAuthStatus(input: {
  role?: Role;
  observedState: ObservedState;
  repoPolicy?: RepoPolicyEvaluation;
  pinnedRole?: Role;
  offline?: boolean;
}): StatusResult['auth'] {
  const { observedState, role } = input;
  if (!observedState.repository.isInsideWorkTree) return 'na';
  const push = observedState.repository.push;
  if (!push || push.message || push.targets.length === 0) return input.offline ? 'na' : 'warn';
  // A local HTTPS pin is not observed authentication for a second push endpoint.
  if (!input.offline && push.targets.some(({ remote }) => remote.protocol === 'ssh') &&
    push.targets.some(({ remote }) => remote.protocol === 'https')) return 'warn';
  let hasSsh = false;
  for (const target of push.targets) {
    if (target.message) return 'warn';
    if (target.remote.protocol === 'https') {
      if (describeHttpsAuth({ role, repoPolicy: input.repoPolicy, pinnedRole: input.pinnedRole }).auth === 'warn') return 'warn';
    } else if (target.remote.protocol === 'ssh') {
      if (input.offline) continue;
      hasSsh = true;
      if (!target.sshAuth?.ok || !target.sshAuth.githubUser || (role?.githubUser && target.sshAuth.githubUser !== role.githubUser)) return 'warn';
    } else if (!input.offline) return 'warn';
  }
  return hasSsh ? 'ok' : 'na';
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
  return Boolean(role.githubUser && observedState.commitIdentity.fullName.value && observedState.commitIdentity.email.value &&
    observedState.repository.push?.targets.some((target) => target.sshAuth?.ok && target.sshAuth.githubUser !== role.githubUser));
}

/** Describes every default push endpoint using the same authentication rules as status. */
export function buildPushAlignmentChecks(input: {
  role?: Role;
  observedState: ObservedState;
  repoPolicy?: RepoPolicyEvaluation;
  pinnedRole?: Role;
  enforceHttpsPin?: boolean;
  offline?: boolean;
}): DoctorCheck[] {
  const { role, observedState } = input;
  const push = observedState.repository.push;
  if (!observedState.repository.isInsideWorkTree) return [];
  if (!push || push.message || !push.targets.length) return [{
    status: 'warn', label: 'remote', message: push?.message ?? 'default push destination could not be observed'
  }];
  const checks: DoctorCheck[] = [];
  if (!input.offline && push.targets.some(({ remote }) => remote.protocol === 'ssh') && push.targets.some(({ remote }) => remote.protocol === 'https')) {
    checks.push({ status: 'warn', label: 'auth', message: 'mixed SSH and HTTPS push destinations include unverified authentication' });
  }
  for (const target of push.targets) {
    const { remote, sshAuth } = target;
    const endpoint = push.targets.length > 1 ? ` [${remote.url}]` : '';
    checks.push({ status: 'info', label: 'remote', message: `default push remote ${remote.name} uses ${remote.protocol} at ${remote.url}` });
    if (role?.githubHost && remote.host) checks.push({
      status: role.githubHost === remote.host ? 'ok' : 'warn', label: 'host',
      message: (role.githubHost === remote.host ? `remote host matches role githubHost ${role.githubHost}` : `remote host ${remote.host} does not match role githubHost ${role.githubHost}`) + endpoint
    });
    if (remote.protocol === 'https') {
      const description = describeHttpsAuth(input);
      checks.push({ status: description.auth === 'warn' && input.enforceHttpsPin !== false ? 'warn' : 'info', label: 'auth', message: description.message + endpoint });
    } else if (input.offline) {
      checks.push(remote.protocol === 'ssh'
        ? { status: 'info', label: 'auth', message: 'SSH authentication skipped (--offline); local checks only. An online check may connect and run configured SSH commands or change SSH state.' + endpoint }
        : { status: 'warn', label: 'remote', message: 'push transport is unsupported; review the selected push URL' + endpoint });
    } else if (remote.protocol !== 'ssh' || target.message || !sshAuth?.ok || !sshAuth.githubUser) {
      checks.push({ status: 'warn', label: 'auth', message: (target.message ?? sshAuth?.message ?? 'SSH auth could not be probed for the current push target') + endpoint });
    } else {
      if (!role?.githubUser) {
        checks.push({
          status: 'info',
          label: 'auth',
          message: `SSH auth resolved to ${sshAuth.githubUser}` + endpoint
        });
      } else if (role.githubUser === sshAuth.githubUser) {
        checks.push({
          status: 'ok',
          label: 'auth',
          message: `SSH auth matches role githubUser ${role.githubUser}` + endpoint
        });
      } else {
        checks.push({
          status: 'warn',
          label: 'auth',
          message: `SSH auth resolved to ${sshAuth.githubUser}, expected ${role.githubUser}` + endpoint
        });
      }
      if ((!role || (role.githubUser && role.githubUser !== sshAuth.githubUser)) && observedState.commitIdentity.fullName.value && observedState.commitIdentity.email.value) {
        checks.push({ status: 'warn', label: 'identity', message: `commit identity is ${observedState.commitIdentity.fullName.value} <${observedState.commitIdentity.email.value}> but SSH auth resolves to ${sshAuth.githubUser}` + endpoint });
      }
    }
  }
  return checks;
}

/** Condenses a probe-owned reason message for human output, preserving the full message for JSON. */
export function summarizeSshMessage(message: string): string {
  const match = /^SSH account unverified:\n((?:- [^\n]+\n)+)\n([\s\S]*)$/.exec(message);
  if (!match) return message;
  const reasons = match[1].trimEnd().split('\n').map((line) => line.slice(2));
  const more = reasons.length > 1 ? ' (and other differences; see gitrole doctor --json).' : '';
  return `SSH account unverified: ${reasons[0]}${more} ${match[2]}`;
}
