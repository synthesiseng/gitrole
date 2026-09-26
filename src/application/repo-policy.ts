/*
 * Loads and evaluates the repository-local .gitrole policy file.
 */
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { InvalidRoleNameError, validateRoleName } from '../domain/role.js';
import type {
  GitRepository,
  RepoPolicy,
  RepoPolicyEvaluation,
  RepoPolicyStatus
} from './contracts.js';

export const repoPolicyFilename = '.gitrole';

export class RepoPolicyRepositoryContextError extends Error {
  constructor() {
    super('not inside a git repository; resolve requires a repo context');
    this.name = 'RepoPolicyRepositoryContextError';
  }
}

export class RepoPolicyNotFoundError extends Error {
  constructor() {
    super(`repo policy file ${repoPolicyFilename} was not found in the repository root`);
    this.name = 'RepoPolicyNotFoundError';
  }
}

export class RepoPolicyAlreadyExistsError extends Error {
  constructor() {
    super(
      `${repoPolicyFilename} already exists in this repo; gitrole pin will not overwrite or merge existing repo policy`
    );
    this.name = 'RepoPolicyAlreadyExistsError';
  }
}

export class InvalidRepoPolicyError extends Error {
  constructor(reason: string) {
    super(`repo policy file ${repoPolicyFilename} is invalid: ${reason}`);
    this.name = 'InvalidRepoPolicyError';
  }
}

export async function resolveRepoPolicyPath(
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>
): Promise<string> {
  if (!(await repository.isInsideWorkTree())) {
    throw new RepoPolicyRepositoryContextError();
  }

  const topLevelPath = await repository.getTopLevelPath();

  if (!topLevelPath) {
    throw new RepoPolicyRepositoryContextError();
  }

  return path.join(topLevelPath, repoPolicyFilename);
}

export async function loadRepoPolicy(
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>
): Promise<RepoPolicy> {
  const targetPath = await resolveRepoPolicyPath(repository);
  return loadRepoPolicyFile(targetPath);
}

export async function saveRepoPolicy(
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>,
  repoPolicy: RepoPolicy
): Promise<void> {
  const targetPath = await resolveRepoPolicyPath(repository);
  const normalizedPolicy = validateRepoPolicy(repoPolicy);

  try {
    await writeFile(`${targetPath}`, `${JSON.stringify(normalizedPolicy, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error) {
    const writeError = error as NodeJS.ErrnoException;

    if (writeError.code === 'EEXIST') {
      throw new RepoPolicyAlreadyExistsError();
    }

    throw error;
  }
}

export async function loadOptionalRepoPolicy(
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>
): Promise<RepoPolicy | undefined> {
  if (!(await repository.isInsideWorkTree())) {
    return undefined;
  }

  const topLevelPath = await repository.getTopLevelPath();

  if (!topLevelPath) {
    return undefined;
  }

  try {
    return await loadRepoPolicyFile(path.join(topLevelPath, repoPolicyFilename));
  } catch (error) {
    if (error instanceof RepoPolicyNotFoundError) {
      return undefined;
    }

    throw error;
  }
}

export function evaluateRepoPolicy(
  repoPolicy: RepoPolicy,
  effectiveRole?: string
): RepoPolicyEvaluation {
  let status: RepoPolicyStatus;

  if (effectiveRole === repoPolicy.defaultRole) {
    status = 'default';
  } else if (effectiveRole && repoPolicy.allowedRoles.includes(effectiveRole)) {
    status = 'allowed';
  } else {
    status = 'notAllowed';
  }

  return {
    ...repoPolicy,
    effectiveRole,
    status
  };
}

async function loadRepoPolicyFile(targetPath: string): Promise<RepoPolicy> {
  let source: string;

  try {
    source = await readFile(targetPath, 'utf8');
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;

    if (readError.code === 'ENOENT') {
      throw new RepoPolicyNotFoundError();
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new InvalidRepoPolicyError('expected valid JSON');
  }

  return validateRepoPolicy(parsed);
}

function validateRepoPolicy(input: unknown): RepoPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidRepoPolicyError('expected a JSON object');
  }

  const version = Reflect.get(input, 'version');
  const defaultRole = readNonEmptyString(Reflect.get(input, 'defaultRole'));
  const allowedRoles = readAllowedRoles(Reflect.get(input, 'allowedRoles'));

  if (version !== 1) {
    throw new InvalidRepoPolicyError('version must be exactly 1');
  }

  if (!defaultRole) {
    throw new InvalidRepoPolicyError('defaultRole must be a non-empty string');
  }

  if (allowedRoles.length === 0) {
    throw new InvalidRepoPolicyError('allowedRoles must be a non-empty array of non-empty strings');
  }

  const validatedDefaultRole = requirePolicyRoleName(defaultRole, 'defaultRole');
  const validatedAllowedRoles = allowedRoles.map((roleName) =>
    requirePolicyRoleName(roleName, 'allowedRoles')
  );

  if (!validatedAllowedRoles.includes(validatedDefaultRole)) {
    throw new InvalidRepoPolicyError('defaultRole must appear in allowedRoles');
  }

  return {
    version: 1,
    defaultRole: validatedDefaultRole,
    allowedRoles: validatedAllowedRoles
  };
}

function requirePolicyRoleName(value: string, field: 'defaultRole' | 'allowedRoles'): string {
  try {
    return validateRoleName(value);
  } catch (error) {
    if (error instanceof InvalidRoleNameError) {
      throw new InvalidRepoPolicyError(`${field} ${error.message}`);
    }

    throw error;
  }
}

function readAllowedRoles(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => readNonEmptyString(value))
    .filter((value): value is string => Boolean(value));
}

function readNonEmptyString(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() === '') {
    return undefined;
  }

  return input;
}
