/*
 * Rewrites repository remotes to match the selected role's GitHub SSH host.
 */
import { validateRoleName } from '../../domain/role.js';
import { type RemoteUseDependencies, type RemoteUseResult } from '../contracts.js';
import { ProfileNotFoundError } from './role.js';

export class RoleMissingGithubHostError extends Error {
  constructor(name: string) {
    super(`role "${name}" does not define githubHost`);
    this.name = 'RoleMissingGithubHostError';
  }
}

export class OriginRemoteNotConfiguredError extends Error {
  constructor() {
    super('origin remote is not configured');
    this.name = 'OriginRemoteNotConfiguredError';
  }
}

export class UnsupportedRemoteRewriteError extends Error {
  constructor() {
    super('origin remote could not be rewritten because its owner/repository could not be determined');
    this.name = 'UnsupportedRemoteRewriteError';
  }
}

/**
 * Rewrites the `origin` remote to use the selected role's SSH host alias while
 * preserving the observed repository owner and name.
 *
 * @throws
 * {@link ProfileNotFoundError} when the named role does not exist.
 *
 * @throws
 * {@link RoleMissingGithubHostError} when the role does not define a GitHub host alias.
 *
 * @throws
 * {@link OriginRemoteNotConfiguredError} when the repository has no `origin`.
 *
 * @throws
 * {@link UnsupportedRemoteRewriteError} when the current remote cannot be parsed.
 */
export async function useRemoteForRole(
  dependencies: RemoteUseDependencies,
  name: string
): Promise<RemoteUseResult> {
  const roleName = validateRoleName(name);
  const role = await dependencies.roleStore.get(roleName);

  if (!role) {
    throw new ProfileNotFoundError(roleName);
  }

  if (!role.githubHost) {
    throw new RoleMissingGithubHostError(roleName);
  }

  const previousUrl = await dependencies.repository.getOriginUrl();

  if (!previousUrl) {
    throw new OriginRemoteNotConfiguredError();
  }

  const remote = await dependencies.repository.getOriginRemote();

  if (!remote || !remote.owner || !remote.repository) {
    throw new UnsupportedRemoteRewriteError();
  }

  const nextUrl = `git@${role.githubHost}:${remote.owner}/${remote.repository}.git`;

  if (previousUrl !== nextUrl) {
    await dependencies.repository.setOriginUrl(nextUrl);
  }

  return {
    role,
    previousUrl,
    nextUrl
  };
}
