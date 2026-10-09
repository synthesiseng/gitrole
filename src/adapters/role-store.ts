/*
 * Persists named roles to the user's config directory as normalized JSON data.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeRole, normalizeStoredRole, type Role } from '../domain/role.js';

interface StoredRoles {
  roles: Role[];
}

const invalidSavedRoleDataMessage =
  'saved role data is invalid; fix or recreate the roles file';

export interface RoleStoreOptions {
  configFilePath?: string;
  /** Leave absent role storage untouched for an explicit read-only lookup. */
  createIfMissing?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class InvalidSavedRoleDataError extends Error {
  constructor() {
    super(invalidSavedRoleDataMessage);
    this.name = 'InvalidSavedRoleDataError';
  }
}

export class FileRoleStore {
  private readonly configFilePath: string;
  private readonly createIfMissing: boolean;

  constructor(options: RoleStoreOptions = {}) {
    this.createIfMissing = options.createIfMissing !== false;
    this.configFilePath =
      options.configFilePath ?? resolveRolesFilePath(options.env ?? process.env);
  }

  async list(): Promise<Role[]> {
    const data = await this.readData();

    return data.roles;
  }

  async get(name: string): Promise<Role | undefined> {
    const roles = await this.list();

    return roles.find((role) => role.name === name);
  }

  async save(role: Role): Promise<void> {
    const normalizedRole = normalizeRole(role);
    const data = await this.readData();
    const existingIndex = data.roles.findIndex(
      (candidate) => candidate.name === normalizedRole.name
    );

    if (existingIndex >= 0) {
      data.roles[existingIndex] = normalizedRole;
    } else {
      data.roles.push(normalizedRole);
    }

    await this.writeData(data);
  }

  async remove(name: string): Promise<boolean> {
    const data = await this.readData();
    const nextRoles = data.roles.filter((role) => role.name !== name);
    const changed = nextRoles.length !== data.roles.length;

    if (!changed) {
      return false;
    }

    await this.writeData({ roles: nextRoles });

    return true;
  }

  private async readData(): Promise<StoredRoles> {
    if (this.createIfMissing) await this.ensureFile();
    let raw: string;
    try { raw = await readFile(this.configFilePath, 'utf8'); } catch (error) {
      if (!this.createIfMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return { roles: [] };
      throw error;
    }
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InvalidSavedRoleDataError();
    }

    return parseStoredRoles(parsed);
  }

  private async writeData(data: StoredRoles): Promise<void> {
    const directory = path.dirname(this.configFilePath);
    const tempFilePath = path.join(
      directory,
      `.roles.json.tmp-${process.pid}-${Date.now()}`
    );

    await mkdir(directory, { recursive: true });
    await writeFile(tempFilePath, `${JSON.stringify({ roles: data.roles }, null, 2)}\n`, 'utf8');
    await rename(tempFilePath, this.configFilePath);
  }

  private async ensureFile(): Promise<void> {
    await mkdir(path.dirname(this.configFilePath), { recursive: true });

    try {
      await readFile(this.configFilePath, 'utf8');
    } catch (error) {
      const readError = error as NodeJS.ErrnoException;

      if (readError.code !== 'ENOENT') {
        throw error;
      }

      await this.writeData({ roles: [] });
    }
  }
}

export function resolveRolesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome =
    env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), '.config');

  return path.join(configHome, 'gitrole', 'roles.json');
}

function parseStoredRoles(input: unknown): StoredRoles {
  if (!isRecord(input) || !Array.isArray(input.roles)) {
    throw new InvalidSavedRoleDataError();
  }

  return {
    roles: input.roles.map((role) => parseStoredRole(role))
  };
}

function parseStoredRole(input: unknown): Role {
  if (!isRecord(input)) {
    throw new InvalidSavedRoleDataError();
  }

  const role: Role = {
    name: readRequiredString(input, 'name'),
    fullName: readRequiredString(input, 'fullName'),
    email: readRequiredString(input, 'email'),
    sshKeyPath: readOptionalString(input, 'sshKeyPath'),
    githubUser: readOptionalString(input, 'githubUser'),
    githubHost: readOptionalString(input, 'githubHost')
  };

  try {
    return normalizeStoredRole(role);
  } catch {
    throw new InvalidSavedRoleDataError();
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];

  if (typeof value !== 'string') {
    throw new InvalidSavedRoleDataError();
  }

  return value;
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const value = input[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new InvalidSavedRoleDataError();
  }

  return value;
}
