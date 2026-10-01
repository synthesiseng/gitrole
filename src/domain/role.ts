/*
 * Defines the role model and identity matching helpers used across gitrole.
 */
export interface Role {
  name: string;
  fullName: string;
  email: string;
  sshKeyPath?: string;
  githubUser?: string;
  githubHost?: string;
}

export interface GitIdentity {
  fullName?: string;
  email?: string;
}

const roleNamePattern = /^[a-z0-9_-]+$/;

/**
 * `role=` value written when no saved role matches the commit identity.
 *
 * The prompt segment prints this token as-is. It is not a name users can save.
 */
export const UNMATCHED_ROLE_NAME = 'no-role';

export class InvalidRoleNameError extends Error {
  constructor(input: string, message?: string) {
    super(message ?? `invalid role name "${input}"; use lowercase letters, numbers, "-" or "_"`);
    this.name = 'InvalidRoleNameError';
  }
}

export class ReservedRoleNameError extends InvalidRoleNameError {
  constructor(input: string) {
    super(
      input,
      `role name "${input}" is reserved for the status and prompt sentinel when no saved role matches; choose a different name`
    );
    this.name = 'ReservedRoleNameError';
  }
}

/** Reports a required identity field that cannot be applied safely. */
export class InvalidRoleIdentityError extends Error {
  constructor(field: 'full name' | 'email') {
    super(`role ${field} must not be empty or whitespace-only`);
    this.name = 'InvalidRoleIdentityError';
  }
}

/** Lists blank required identity fields, including whitespace-only values. */
export function getBlankRoleIdentityFields(role: Pick<Role, 'fullName' | 'email'>): Array<'full name' | 'email'> {
  const fields: Array<'full name' | 'email'> = [];
  if (!role.fullName.trim()) fields.push('full name');
  if (!role.email.trim()) fields.push('email');
  return fields;
}

/** Rejects blank identities before a role is saved or applied to Git config. */
export function validateRoleIdentity(role: Pick<Role, 'fullName' | 'email'>): void {
  const [field] = getBlankRoleIdentityFields(role);
  if (field) throw new InvalidRoleIdentityError(field);
}

/**
 * Returns true when `input` is the unmatched-role sentinel.
 */
export function isReservedRoleName(input: string): boolean {
  return input === UNMATCHED_ROLE_NAME;
}

function assertRoleNameShape(input: string): string {
  if (!input || input.trim() !== input || !roleNamePattern.test(input)) {
    throw new InvalidRoleNameError(input);
  }

  return input;
}

/**
 * Accepts a role name that can be created or selected.
 *
 * Rejects malformed names and {@link UNMATCHED_ROLE_NAME}.
 */
export function validateRoleName(input: string): string {
  const name = assertRoleNameShape(input);

  if (isReservedRoleName(name)) {
    throw new ReservedRoleNameError(name);
  }

  return name;
}

/**
 * Accepts a well-formed role token, including a legacy reserved name.
 *
 * Creating a role still goes through {@link validateRoleName}. Reading or
 * deleting a role that was saved before the name was reserved uses this so
 * doctor can flag it instead of treating the roles file as corrupt.
 */
export function parseStoredRoleName(input: string): string {
  return assertRoleNameShape(input);
}

function normalizeRoleFields(input: Role, name: string): Role {
  return {
    name,
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    sshKeyPath: input.sshKeyPath?.trim() || undefined,
    githubUser: input.githubUser?.trim() || undefined,
    githubHost: input.githubHost?.trim() || undefined
  };
}

/**
 * Normalizes persisted role input so comparisons and storage stay stable.
 *
 * Trims all string fields and removes empty optional values. The name must
 * be valid for a new or updated saved role. Required identity fields must be nonblank.
 */
export function normalizeRole(input: Role): Role {
  const role = normalizeRoleFields(input, validateRoleName(input.name));
  validateRoleIdentity(role);
  return role;
}

/**
 * Normalizes a role read from disk, including a legacy reserved name.
 *
 * Does not rename or drop the role, including legacy blank identities that doctor
 * must diagnose. Creation paths keep using {@link normalizeRole}.
 */
export function normalizeStoredRole(input: Role): Role {
  return normalizeRoleFields(input, parseStoredRoleName(input.name));
}

/**
 * Returns true only when both the configured Git name and email match exactly.
 *
 * `gitrole current` relies on this strict rule to avoid ambiguous role detection.
 */
export function matchesIdentity(role: Role, identity: GitIdentity): boolean {
  return role.fullName === identity.fullName && role.email === identity.email;
}
