/*
 * Implements repository diagnosis and post-switch alignment checks.
 */
import { isReservedRoleName, type Role } from '../../domain/role.js';
import { describeHttpsAuth, findMatchingRole, findPinnedRole } from '../alignment.js';
import {
  getDoctorOverall,
  DoctorCheck,
  DoctorDependencies,
  DoctorResult,
  RoleAlignmentResult,
  UseRoleDependencies
} from '../contracts.js';
import { collectObservedState, type ObservedState } from '../observed-state.js';
import { evaluateRepoPolicy, loadOptionalRepoPolicy } from '../repo-policy.js';

/**
 * Diagnoses the active commit identity and push path for the current repository.
 *
 * @remarks
 * This use case answers two practical questions:
 *
 * 1. Who will this commit say it is from?
 * 2. Who will GitHub think I am when I push over SSH?
 */
export async function doctor(
  dependencies: DoctorDependencies
): Promise<DoctorResult> {
  const [roles, observedState, repoPolicy] = await Promise.all([
    dependencies.roleStore.list(),
    collectObservedState(dependencies),
    loadOptionalRepoPolicy(dependencies.repository)
  ]);
  const role = findMatchingRole(roles, observedState.commitIdentity);
  const evaluatedRepoPolicy = repoPolicy ? evaluateRepoPolicy(repoPolicy, role?.name) : undefined;
  const checks = buildDoctorChecks({
    role,
    roles,
    observedState,
    repoPolicy: evaluatedRepoPolicy,
    pinnedRole: findPinnedRole(roles, evaluatedRepoPolicy)
  });

  return {
    role,
    overall: getDoctorOverall({ checks }),
    commitIdentity: observedState.commitIdentity,
    configuredIdentity: observedState.configuredIdentity,
    scope: observedState.scope,
    repository: observedState.repository,
    sshAuth: observedState.sshAuth,
    repoPolicy: evaluatedRepoPolicy,
    checks
  };
}

export async function maybeAssessRoleAlignment(
  dependencies: UseRoleDependencies,
  role: Role
): Promise<RoleAlignmentResult | undefined> {
  if (!dependencies.repository || !dependencies.sshAuthProbe) {
    return undefined;
  }

  return assessRoleAlignment(
    {
      gitConfig: dependencies.gitConfig,
      repository: dependencies.repository,
      sshAuthProbe: dependencies.sshAuthProbe
    },
    role
  );
}

export async function assessRoleAlignment(
  dependencies: Pick<DoctorDependencies, 'gitConfig' | 'repository' | 'sshAuthProbe'>,
  role: Role
): Promise<RoleAlignmentResult> {
  const observedState = await collectObservedState(dependencies);

  return {
    role,
    commitIdentity: observedState.commitIdentity,
    scope: observedState.scope,
    repository: observedState.repository,
    sshAuth: observedState.sshAuth,
    checks: buildRoleAlignmentChecks({ role, observedState })
  };
}

function buildReservedRoleNameChecks(roles: Role[]): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const role of roles) {
    if (!isReservedRoleName(role.name)) {
      continue;
    }

    checks.push({
      status: 'warn',
      label: 'role',
      message: `saved role "${role.name}" is reserved for the status and prompt sentinel`
    });
    checks.push({
      status: 'info',
      label: 'fix',
      message: `rename saved role "${role.name}" (${role.fullName} <${role.email}>): gitrole add <name> --name "${role.fullName}" --email "${role.email}", then gitrole remove ${role.name}`
    });
  }

  return checks;
}

function buildDoctorChecks(input: {
  role?: Role;
  roles: Role[];
  observedState: ObservedState;
  repoPolicy?: DoctorResult['repoPolicy'];
  pinnedRole?: Role;
}): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const { observedState } = input;

  if (input.role) {
    checks.push({
      status: 'ok',
      label: 'role',
      message: `commit identity matches saved role ${input.role.name}`
    });
  } else {
    checks.push({
      status: 'warn',
      label: 'role',
      message: 'active commit identity does not match any saved role'
    });

    checks.push({
      status: 'info',
      label: 'fix',
      message:
        input.roles.length > 0
          ? 'add a role for the active commit identity or switch to the intended saved role before committing'
          : 'add a saved role for the active commit identity before committing'
    });
  }

  checks.push(...buildReservedRoleNameChecks(input.roles));

  if (
    !observedState.commitIdentity.fullName.value ||
    !observedState.commitIdentity.email.value
  ) {
    checks.push({
      status: 'warn',
      label: 'commit',
      message: 'user.name or user.email is not fully configured'
    });
  }

  checks.push(...buildCommitEnvChecks(observedState, input.role));

  if (observedState.scope.effective === 'mixed') {
    checks.push({
      status: 'warn',
      label: 'scope',
      message: 'effective commit identity mixes local and global Git config sources'
    });
  }

  if (!observedState.repository.isInsideWorkTree) {
    checks.push({
      status: 'warn',
      label: 'repo',
      message: 'not inside a Git repository; remote push identity could not be diagnosed'
    });

    return checks;
  }

  if (observedState.repository.hasCommits === false) {
    checks.push({
      status: 'warn',
      label: 'history',
      message: 'repository has no commits yet; the first push will fail until HEAD exists'
    });

    if (observedState.scope.effective !== 'local') {
      checks.push({
        status: 'warn',
        label: 'commit',
        message: 'no local role before the first commit; the next commit will use the global identity'
      });
    }
  }

  if (!observedState.repository.remote) {
    checks.push({
      status: 'warn',
      label: 'remote',
      message: 'origin remote is not configured'
    });

    return checks;
  }

  checks.push({
    status: 'info',
    label: 'remote',
    message: `origin uses ${observedState.repository.remote.protocol} at ${observedState.repository.remote.url}`
  });

  if (observedState.sshAuth?.ok && observedState.sshAuth.githubUser) {
    const commitIdentity = formatCommitIdentity(observedState.commitIdentity);
    const shouldReportIdentityDivergence =
      !input.role ||
      (input.role.githubUser !== undefined &&
        observedState.sshAuth.githubUser !== input.role.githubUser);

    if (commitIdentity && shouldReportIdentityDivergence) {
      checks.push({
        status: 'warn',
        label: 'identity',
        message: `commit identity is ${commitIdentity} but SSH auth resolves to ${observedState.sshAuth.githubUser}`
      });
    }
  }

  if (!input.role) {
    if (observedState.repository.remote.protocol === 'https') {
      checks.push(buildHttpsAuthCheck(input));
    }

    if (input.repoPolicy) {
      checks.push(buildRepoPolicyCheck(input.repoPolicy));
    }

    return checks;
  }

  checks.push(
    ...buildRoleAlignmentChecks({
      role: input.role,
      observedState,
      repoPolicy: input.repoPolicy,
      pinnedRole: input.pinnedRole,
      enforceHttpsPin: true
    })
  );

  if (input.repoPolicy) {
    checks.push(buildRepoPolicyCheck(input.repoPolicy));
  }

  return checks;
}

function buildRoleAlignmentChecks(input: {
  role: Role;
  observedState: ObservedState;
  repoPolicy?: DoctorResult['repoPolicy'];
  pinnedRole?: Role;
  enforceHttpsPin?: boolean;
}): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const { role, observedState } = input;

  if (observedState.scope.effective === 'mixed') {
    checks.push({
      status: 'warn',
      label: 'scope',
      message: `selected role ${role.name} is split across local and global config sources`
    });
  } else if (observedState.scope.effective === 'local' || observedState.scope.effective === 'global') {
    checks.push({
      status: 'ok',
      label: 'scope',
      message: `selected role ${role.name} is applied via ${observedState.scope.effective} config`
    });
  }

  if (
    observedState.commitIdentity.fullName.value !== role.fullName ||
    observedState.commitIdentity.email.value !== role.email
  ) {
    checks.push({
      status: 'warn',
      label: 'commit',
      message: `effective commit identity does not match selected role ${role.name}`
    });
  } else {
    checks.push({
      status: 'ok',
      label: 'commit',
      message: `effective commit identity matches selected role ${role.name}`
    });
  }

  if (!observedState.repository.isInsideWorkTree) {
    checks.push({
      status: 'warn',
      label: 'repo',
      message: 'not inside a Git repository; remote alignment could not be checked'
    });
    return dedupeChecks(checks);
  }

  if (!observedState.repository.remote) {
    checks.push({
      status: 'warn',
      label: 'remote',
      message: 'origin remote is not configured'
    });
    return dedupeChecks(checks);
  }

  if (role.githubHost && observedState.repository.remote.host) {
    checks.push({
      status: role.githubHost === observedState.repository.remote.host ? 'ok' : 'warn',
      label: 'host',
      message:
        role.githubHost === observedState.repository.remote.host
          ? `remote host matches role githubHost ${role.githubHost}`
          : `remote host ${observedState.repository.remote.host} does not match role githubHost ${role.githubHost}`
    });
  }

  if (observedState.repository.remote.protocol === 'https') {
    checks.push(
      input.enforceHttpsPin
        ? buildHttpsAuthCheck(input)
        : {
            status: 'info',
            label: 'auth',
            message: 'origin uses HTTPS; SSH auth verification does not apply'
          }
    );
    return dedupeChecks(checks);
  }

  if (!observedState.sshAuth) {
    checks.push({
      status: 'warn',
      label: 'auth',
      message: 'SSH auth could not be probed for the current remote host'
    });
    return dedupeChecks(checks);
  }

  if (!observedState.sshAuth.ok) {
    checks.push({
      status: 'warn',
      label: 'auth',
      message: observedState.sshAuth.message ?? 'SSH auth identity could not be determined'
    });
    return dedupeChecks(checks);
  }

  if (role.githubUser) {
    checks.push({
      status: observedState.sshAuth.githubUser === role.githubUser ? 'ok' : 'warn',
      label: 'auth',
      message:
        observedState.sshAuth.githubUser === role.githubUser
          ? `SSH auth matches role githubUser ${role.githubUser}`
          : `SSH auth resolved to ${observedState.sshAuth.githubUser}, expected ${role.githubUser}`
    });
  } else if (observedState.sshAuth.githubUser) {
    checks.push({
      status: 'info',
      label: 'auth',
      message: `SSH auth resolved to ${observedState.sshAuth.githubUser}`
    });
  }

  return dedupeChecks(checks);
}

function buildCommitEnvChecks(observedState: ObservedState, role?: Role): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const configuredEmail =
    observedState.configuredIdentity.local.email ?? observedState.configuredIdentity.global.email;
  const configuredName =
    observedState.configuredIdentity.local.fullName ?? observedState.configuredIdentity.global.fullName;
  const authorEmail = observedState.commitIdentity.email.value;
  const authorName = observedState.commitIdentity.fullName.value;
  const effectiveRoleMatches = Boolean(
    role && role.fullName === authorName && role.email === authorEmail
  );

  if (observedState.commitEnv.authorEmail) {
    const overridesConfigured = observedState.commitEnv.authorEmail !== configuredEmail;

    checks.push({
      status: overridesConfigured && !effectiveRoleMatches ? 'warn' : 'info',
      label: 'commit',
      message: overridesConfigured
        ? `GIT_AUTHOR_EMAIL ${observedState.commitEnv.authorEmail} overrides the configured commit email`
        : `GIT_AUTHOR_EMAIL ${observedState.commitEnv.authorEmail} sets the commit email`
    });
  }

  if (observedState.commitEnv.authorName && observedState.commitEnv.authorName !== configuredName) {
    checks.push({
      status: effectiveRoleMatches ? 'info' : 'warn',
      label: 'commit',
      message: `GIT_AUTHOR_NAME ${observedState.commitEnv.authorName} overrides the configured commit name`
    });
  }

  if (observedState.commitEnv.committerEmail && observedState.commitEnv.committerEmail !== authorEmail) {
    checks.push({
      status: 'warn',
      label: 'commit',
      message: `GIT_COMMITTER_EMAIL ${observedState.commitEnv.committerEmail} overrides the committer email`
    });
  }

  if (observedState.commitEnv.committerName && observedState.commitEnv.committerName !== authorName) {
    checks.push({
      status: 'warn',
      label: 'commit',
      message: `GIT_COMMITTER_NAME ${observedState.commitEnv.committerName} overrides the committer name`
    });
  }

  return checks;
}

function buildHttpsAuthCheck(input: {
  role?: Role;
  repoPolicy?: DoctorResult['repoPolicy'];
  pinnedRole?: Role;
}): DoctorCheck {
  const httpsAuth = describeHttpsAuth({
    role: input.role,
    repoPolicy: input.repoPolicy,
    pinnedRole: input.pinnedRole
  });

  return {
    status: httpsAuth.auth === 'na' ? 'info' : 'warn',
    label: 'auth',
    message: httpsAuth.message
  };
}

function dedupeChecks(checks: DoctorCheck[]): DoctorCheck[] {
  const seen = new Set<string>();

  return checks.filter((check) => {
    const key = `${check.status}:${check.label}:${check.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatCommitIdentity(identity: DoctorResult['commitIdentity']): string | undefined {
  if (!identity.fullName.value || !identity.email.value) {
    return undefined;
  }

  return `${identity.fullName.value} <${identity.email.value}>`;
}

function buildRepoPolicyCheck(repoPolicy: NonNullable<DoctorResult['repoPolicy']>): DoctorCheck {
  if (repoPolicy.status === 'default') {
    return {
      status: 'ok',
      label: 'policy',
      message: `effective role ${repoPolicy.defaultRole} matches repo defaultRole`
    };
  }

  if (repoPolicy.status === 'allowed') {
    return {
      status: 'info',
      label: 'policy',
      message: `effective role ${repoPolicy.effectiveRole} is allowed here, but repo defaultRole is ${repoPolicy.defaultRole}`
    };
  }

  return {
    status: 'warn',
    label: 'policy',
    message: repoPolicy.effectiveRole
      ? `effective role ${repoPolicy.effectiveRole} is not allowed here; allowedRoles are ${repoPolicy.allowedRoles.join(', ')}`
      : `effective role is not allowed here; allowedRoles are ${repoPolicy.allowedRoles.join(', ')}`
  };
}
