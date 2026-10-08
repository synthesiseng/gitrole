/*
 * Captures the current git, repository, and SSH observations used by diagnosis flows.
 */
import type {
  DiagnosedValue,
  DoctorDependencies,
  DoctorResult,
  IdentityScopeResult,
  SshAuthProbeResult
} from './contracts.js';

export interface CommitEnvOverrides {
  authorName?: string;
  authorEmail?: string;
  committerName?: string;
  committerEmail?: string;
}

export interface ObservedState {
  commitIdentity: DoctorResult['commitIdentity'];
  configuredIdentity: DoctorResult['configuredIdentity'];
  commitEnv: CommitEnvOverrides;
  committerIdentity?: DoctorResult['commitIdentity'];
  scope: IdentityScopeResult;
  repository: DoctorResult['repository'];
  sshAuth?: SshAuthProbeResult;
}

export interface CollectObservedStateOptions {
  /**
   * When false, skip the live SSH githubUser probe.
   * Defaults to probing SSH remotes.
   */
  probeSsh?: boolean;
}

export async function collectObservedState(
  dependencies: Pick<DoctorDependencies, 'gitConfig' | 'repository' | 'sshAuthProbe' | 'env'>,
  options: CollectObservedStateOptions = {}
): Promise<ObservedState> {
  const [
    globalName,
    globalEmail,
    localName,
    localEmail,
    isInsideWorkTree,
    hasCommits,
    topLevelPath,
    currentBranch,
    upstreamBranch,
    fetchRemote
  ] = await Promise.all([
    dependencies.gitConfig.getGlobalUserName(),
    dependencies.gitConfig.getGlobalUserEmail(),
    dependencies.repository.getLocalUserName(),
    dependencies.repository.getLocalUserEmail(),
    dependencies.repository.isInsideWorkTree(),
    dependencies.repository.hasCommits(),
    dependencies.repository.getTopLevelPath(),
    dependencies.repository.getCurrentBranch(),
    dependencies.repository.getUpstreamBranch(),
    dependencies.repository.getOriginRemote()
  ]);

  const probeSsh = options.probeSsh !== false;
  const destination = isInsideWorkTree && dependencies.repository.getPushDestination
    ? await dependencies.repository.getPushDestination(dependencies.env)
    : { targets: [], transport: { supported: false }, message: 'default push destination could not be observed' };
  const targets = await Promise.all(destination.targets.map(async (remote) => {
    if (!probeSsh) return { remote };
    if (remote.protocol === 'https') return { remote };
    if (remote.protocol !== 'ssh' || !remote.host) return { remote, message: 'push transport is unsupported; authentication is unverified. Review the selected push URL and that transport with the setup owner; changing transports just to clear a warning does not verify an account.' };
    if (!destination.transport.supported) return { remote, message: destination.transport.message ?? 'SSH transport is unverified' };
    const sshAuth = await dependencies.sshAuthProbe.probeGithubUser(remote.host, {
      user: remote.user, port: remote.port, path: remote.path, env: dependencies.env
    });
    return { remote, sshAuth };
  }));
  const remote = targets[0]?.remote;
  // Legacy singular result is present only for a singular SSH push target.
  const sshAuth = targets.length === 1 ? targets[0].sshAuth : undefined;
  const configuredCommitIdentity = {
    fullName: diagnoseValue(localName, globalName),
    email: diagnoseValue(localEmail, globalEmail)
  };
  const commitEnv = readCommitEnvOverrides(dependencies.env ?? process.env);
  const effectiveIdentity = await dependencies.gitConfig.getEffectiveIdentity?.(dependencies.env);
  const commitIdentity = effectiveIdentity?.author ?? applyAuthorEnv(configuredCommitIdentity, commitEnv);

  return {
    commitIdentity,
    committerIdentity: effectiveIdentity?.committer,
    configuredIdentity: {
      local: {
        fullName: localName,
        email: localEmail
      },
      global: {
        fullName: globalName,
        email: globalEmail
      }
    },
    commitEnv,
    scope: effectiveIdentity?.scope ?? detectIdentityScope(configuredCommitIdentity),
    repository: {
      isInsideWorkTree,
      hasCommits: isInsideWorkTree ? hasCommits : undefined,
      topLevelPath,
      currentBranch,
      upstreamBranch,
      remote,
      fetchRemote,
      push: { remoteName: destination.remoteName, message: destination.message, targets }
    },
    sshAuth
  };
}

export function readCommitEnvOverrides(env: NodeJS.ProcessEnv): CommitEnvOverrides {
  return {
    authorName: readEnvValue(env, 'GIT_AUTHOR_NAME'),
    authorEmail: readEnvValue(env, 'GIT_AUTHOR_EMAIL'),
    committerName: readEnvValue(env, 'GIT_COMMITTER_NAME'),
    committerEmail: readEnvValue(env, 'GIT_COMMITTER_EMAIL')
  };
}

function applyAuthorEnv(
  configured: DoctorResult['commitIdentity'],
  commitEnv: CommitEnvOverrides
): DoctorResult['commitIdentity'] {
  return {
    fullName: commitEnv.authorName
      ? { value: commitEnv.authorName, source: 'env' }
      : configured.fullName,
    email: commitEnv.authorEmail
      ? { value: commitEnv.authorEmail, source: 'env' }
      : configured.email
  };
}

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function diagnoseValue(localValue?: string, globalValue?: string): DiagnosedValue {
  if (localValue) {
    return {
      value: localValue,
      source: 'local'
    };
  }

  if (globalValue) {
    return {
      value: globalValue,
      source: 'global'
    };
  }

  return {
    source: 'unset'
  };
}

function detectIdentityScope(identity: DoctorResult['commitIdentity']): IdentityScopeResult {
  const sources = [identity.fullName.source, identity.email.source];

  if (sources.every((source) => source === 'unset')) {
    return {
      effective: 'unset',
      hasLocalOverride: false
    };
  }

  const hasLocalOverride = sources.includes('local');

  if (sources.every((source) => source === 'local')) {
    return {
      effective: 'local',
      hasLocalOverride
    };
  }

  if (sources.every((source) => source === 'global')) {
    return {
      effective: 'global',
      hasLocalOverride
    };
  }

  return {
    effective: 'mixed',
    hasLocalOverride
  };
}
