/*
 * Renders human-readable CLI output for saved roles, status, and diagnosis results.
 */
import os from 'node:os';

import chalk from 'chalk';

import type {
  CurrentRoleResult,
  DoctorResult,
  ImportCurrentRoleResult,
  ListRolesResult,
  PinRepoPolicyResult,
  RemoteUseResult,
  StatusResult,
  UseRoleResult
} from '../application/contracts.js';
import type { Role } from '../domain/role.js';

export function renderSavedRole(role: Role): string {
  const lines = [
    `${chalk.green('saved')} ${chalk.bold(role.name)}`,
    formatDetail('commit', formatIdentityPair(role))
  ];

  if (role.sshKeyPath) {
    lines.push(formatDetail('ssh', formatPath(role.sshKeyPath)));
  }

  const pushAuth = formatPushAuth(role.githubUser, role.githubHost);

  if (pushAuth) {
    lines.push(formatDetail('push', pushAuth));
  }

  return lines.join('\n');
}

export function renderUsedRole(result: UseRoleResult): string {
  const lines = [
    `${chalk.green('switched to')} ${chalk.bold(result.role.name)}`,
    formatDetail('scope', result.scope),
    formatDetail('commit', formatIdentityPair(result.role))
  ];

  if (result.ssh) {
    const status = result.ssh.ok ? ` (${chalk.green('loaded')})` : '';
    lines.push(formatDetail('ssh', `${formatPath(result.ssh.path)}${status}`));
  }

  const pushAuth = formatPushAuth(result.role.githubUser, result.role.githubHost);

  if (pushAuth) {
    lines.push(formatDetail('push', pushAuth));
  }

  return lines.join('\n');
}

export function renderCurrentRole(result: CurrentRoleResult): string {
  if (result.role) {
    const lines = [
      `${chalk.green('current role')} ${chalk.bold(result.role.name)}`,
      formatDetail('commit', formatIdentityPair(result.role))
    ];

    if (result.role.sshKeyPath) {
      lines.push(formatDetail('ssh', formatPath(result.role.sshKeyPath)));
    }

    const pushAuth = formatPushAuth(result.role.githubUser, result.role.githubHost);

    if (pushAuth) {
      lines.push(formatDetail('push', pushAuth));
    }

    return lines.join('\n');
  }

  return [
    chalk.yellow('no matching role'),
    formatDetail('commit', formatIdentityPair(result.identity))
  ].join('\n');
}

export function renderImportedCurrentRole(result: ImportCurrentRoleResult): string {
  return [
    `${chalk.green('imported current identity as')} ${chalk.bold(result.role.name)}`,
    formatDetail('commit', formatIdentityPair(result.role)),
    formatDetail('scope', result.scope)
  ].join('\n');
}

export function renderRoleList(result: ListRolesResult): string {
  if (result.roles.length === 0) {
    return chalk.dim('no saved roles');
  }

  return result.roles
    .map((role) => {
      const marker = role.name === result.activeRoleName ? chalk.green('*') : ' ';
      const ssh = role.sshKeyPath ? ` ${chalk.dim(formatPath(role.sshKeyPath))}` : '';
      const githubUser = role.githubUser ? ` ${chalk.dim(`gh:${role.githubUser}`)}` : '';
      const githubHost = role.githubHost ? ` ${chalk.dim(`host:${role.githubHost}`)}` : '';

      return `${marker} ${chalk.bold(role.name)} ${chalk.dim(
        `${role.fullName} <${role.email}>`
      )}${ssh}${githubUser}${githubHost}`;
    })
    .join('\n');
}

export function renderRemovedRole(role: Role): string {
  return `${chalk.green('removed')} ${chalk.bold(role.name)}`;
}

export function renderError(message: string): string {
  return `${chalk.red('error:')} ${message}`;
}

export function renderRepoNote(): string {
  return [
    `${chalk.cyan('repo note:')} alignment issues detected`,
    `  ${chalk.cyan('run:')} gitrole status`
  ].join('\n');
}

export function renderSshNote(message: string): string {
  return `${chalk.cyan('ssh note:')} ${message}`;
}

export function renderRemoteUse(result: RemoteUseResult): string {
  return [
    `${chalk.green('updated remote')} ${chalk.bold('origin')} ${chalk.dim(`for ${result.role.name}`)}`,
    formatDetail('from', result.previousUrl),
    formatDetail('to', result.nextUrl)
  ].join('\n');
}

export function renderPinnedRepoPolicy(result: PinRepoPolicyResult): string {
  return [
    `${chalk.green('pinned role')} ${chalk.bold(result.role.name)}`,
    formatDetail('file', '.gitrole'),
    formatDetail('default', result.repoPolicy.defaultRole),
    formatDetail('allowed', result.repoPolicy.allowedRoles.join(', '))
  ].join('\n');
}

export function renderStatus(result: StatusResult): string {
  const summary =
    result.overall === 'aligned' ? chalk.green(result.overall) : chalk.yellow(result.overall);
  const roleLabel =
    result.roleName === 'no-role' ? chalk.yellow('no matching role') : chalk.bold(result.roleName);

  const lines = [`${roleLabel}  ${summary}`];

  lines.push(formatDetail('commit', result.commitIdentity ?? chalk.dim('unset')));

  if (result.envNote) {
    lines.push(formatDetail('env', result.envNote));
  }

  if (result.pushAuth) {
    lines.push(formatDetail('push', result.pushAuth));
  }

  lines.push(formatDetail('scope', formatStatusScope(result)));

  if (result.historyNote) {
    lines.push(formatDetail('history', result.historyNote));
  } else if (!result.lastNonMergeCommit) {
    lines.push(formatDetail('history', 'no non-merge commits yet'));
  }

  if (result.repoPolicy) {
    lines.push(formatDetail('policy', formatRepoPolicyStatus(result.repoPolicy)));
  }

  return lines.join('\n');
}

export function renderShortStatus(result: StatusResult): string {
  // Field order is the status --short contract:
  // role scope override commit remote auth policy overall
  return [
    `role=${result.roleName}`,
    `scope=${result.scope}`,
    `override=${result.localOverride}`,
    `commit=${result.commit}`,
    `remote=${result.remote}`,
    `auth=${result.auth}`,
    `policy=${result.policy}`,
    `overall=${result.overall}`
  ].join(' ');
}

export function renderDoctor(result: DoctorResult, title = 'doctor'): string {
  const lines = [
    chalk.bold(title),
    formatDetail('role', result.role?.name ?? chalk.yellow('no matching role')),
    formatDetail('scope', result.scope.effective),
    formatDetail('local', result.scope.hasLocalOverride ? 'active' : 'inactive'),
    formatDetail('commit', formatDiagnosedIdentity(result.commitIdentity))
  ];

  const globalIdentity = formatIdentityPair(result.configuredIdentity.global);

  if (shouldRenderGlobalIdentity(result)) {
    lines.push(formatDetail('global', globalIdentity));
  }

  const expectedPushAuth = formatPushAuth(result.role?.githubUser, result.role?.githubHost);

  if (expectedPushAuth) {
    lines.push(formatDetail('push', expectedPushAuth));
  }

  if (result.repository.isInsideWorkTree) {
    lines.push(formatDetail('repo', result.repository.topLevelPath ?? 'current directory'));

    if (result.repository.currentBranch) {
      lines.push(formatDetail('branch', result.repository.currentBranch));
    }

    if (result.repository.hasCommits === false) {
      lines.push(formatDetail('history', chalk.yellow('no commits yet')));
    }

    if (result.repository.upstreamBranch) {
      lines.push(formatDetail('upstream', result.repository.upstreamBranch));
    }

    if (result.repository.remote) {
      lines.push(formatDetail('remote', result.repository.remote.url));

      if (result.repository.remote.host) {
        lines.push(formatDetail('rhost', result.repository.remote.host));
      }

      if (result.repository.remote.owner && result.repository.remote.repository) {
        lines.push(
          formatDetail(
            'rrepo',
            `${result.repository.remote.owner}/${result.repository.remote.repository}`
          )
        );
      }
    } else {
      lines.push(formatDetail('remote', chalk.yellow('origin not configured')));
    }
  } else {
    lines.push(formatDetail('repo', chalk.yellow('not a git repository')));
  }

  if (result.sshAuth?.githubUser) {
    lines.push(formatDetail('auth', `${result.sshAuth.githubUser} via ${result.sshAuth.host}`));
  } else if (result.sshAuth?.message) {
    lines.push(formatDetail('auth', chalk.yellow(result.sshAuth.message)));
  }

  if (result.repoPolicy) {
    lines.push(formatDetail('policy', `.gitrole (v${result.repoPolicy.version})`));
    lines.push(formatDetail('default', result.repoPolicy.defaultRole));
    lines.push(formatDetail('allowed', result.repoPolicy.allowedRoles.join(', ')));
  }

  lines.push('');
  lines.push(chalk.bold('checks'));
  lines.push(
    ...result.checks.map((check) => {
      const status =
        check.status === 'ok'
          ? chalk.green('ok')
          : check.status === 'warn'
            ? chalk.yellow('warn')
            : chalk.blue('info');

      return `  ${status} ${check.label.padEnd(6, ' ')} ${check.message}`;
    })
  );

  return lines.join('\n');
}

function formatDetail(label: string, value: string): string {
  return `  ${chalk.cyan(label.padEnd(5, ' '))} ${value}`;
}

function formatPath(input: string): string {
  const home = os.homedir();

  if (input === home) {
    return '~';
  }

  if (input.startsWith(`${home}/`)) {
    return input.replace(home, '~');
  }

  return input;
}

function formatDiagnosedValue(input: {
  value?: string;
  source: 'local' | 'global' | 'env' | 'unset';
}): string {
  if (!input.value) {
    return chalk.dim(`not set (${input.source})`);
  }

  return `${input.value} ${chalk.dim(`(${input.source})`)}`;
}

function formatDiagnosedIdentity(identity: DoctorResult['commitIdentity']): string {
  return `${formatDiagnosedValue(identity.fullName)} <${formatDiagnosedValue(identity.email)}>`;
}

function formatStatusScope(result: StatusResult): string {
  if (result.localOverride && result.scope === 'local') {
    return 'local override';
  }

  if (result.localOverride && result.scope === 'mixed') {
    return 'mixed override';
  }

  return result.scope;
}

function shouldRenderGlobalIdentity(result: DoctorResult): boolean {
  if (!result.scope.hasLocalOverride) {
    return false;
  }

  return (
    result.configuredIdentity.global.fullName !== undefined ||
    result.configuredIdentity.global.email !== undefined
  ) && (
    result.configuredIdentity.global.fullName !== result.commitIdentity.fullName.value ||
    result.configuredIdentity.global.email !== result.commitIdentity.email.value
  );
}

function formatIdentityPair(identity: { fullName?: string; email?: string }): string {
  const fullName = identity.fullName ?? chalk.dim('not set');
  const email = identity.email ?? chalk.dim('not set');

  return `${fullName} <${email}>`;
}

function formatPushAuth(githubUser?: string, githubHost?: string): string | undefined {
  if (githubUser && githubHost) {
    return `${githubUser} via ${githubHost}`;
  }

  if (githubUser) {
    return githubUser;
  }

  if (githubHost) {
    return githubHost;
  }

  return undefined;
}

function formatRepoPolicyStatus(repoPolicy: NonNullable<StatusResult['repoPolicy']>): string {
  if (repoPolicy.status === 'default') {
    return `default role ${repoPolicy.defaultRole}`;
  }

  if (repoPolicy.status === 'allowed') {
    return `allowed role ${repoPolicy.effectiveRole} (default: ${repoPolicy.defaultRole})`;
  }

  return repoPolicy.effectiveRole
    ? `role ${repoPolicy.effectiveRole} is not allowed here (default: ${repoPolicy.defaultRole})`
    : `current identity does not match an allowed role here (default: ${repoPolicy.defaultRole})`;
}
