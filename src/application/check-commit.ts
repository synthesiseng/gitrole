/** Local commit verdict; deliberately has no remote, authentication or history dependency. */
import { matchesIdentity, isReservedRoleName, type Role } from '../domain/role.js';
import type { EffectiveGitIdentity, RepoPolicy } from './contracts.js';
import { evaluateRepoPolicy } from './repo-policy.js';

export interface CommitCheckInput {
  roles: Role[];
  identity?: EffectiveGitIdentity;
  context: 'worktree' | 'outside' | 'bare';
  hasCommits?: boolean;
  policy?: RepoPolicy;
}

export interface CommitCheckResult {
  exitCode: 0 | 1 | 2;
  reasons: string[];
  identity?: EffectiveGitIdentity;
  suggestedRole?: string;
}

/** All required observations must succeed before mismatches are evaluated. */
export async function checkCommit(load: () => Promise<CommitCheckInput>): Promise<CommitCheckResult> {
  let input: CommitCheckInput;
  try { input = await load(); } catch (error) {
    return { exitCode: 1, reasons: [error instanceof CommitInputError ? error.message : 'required local commit inputs could not be read; inspect Git configuration and saved role data'] };
  }
  if (input.context !== 'worktree') {
    return { exitCode: 2, reasons: [input.context === 'bare' ? 'a bare repository cannot make a working-tree commit' : 'run this check inside a Git working tree'] };
  }
  const identity = input.identity;
  if (!identity) return { exitCode: 1, reasons: ['Git did not provide the required commit identity'] };
  const author = { fullName: identity.author.fullName.value, email: identity.author.email.value };
  const complete = Boolean(author.fullName?.trim() && author.email?.trim());
  const role = complete ? input.roles.find((candidate) => matchesIdentity(candidate, author)) : undefined;
  const reasons: string[] = [];
  if (!complete) reasons.push('effective author name and email must both be nonempty');
  if (!role) reasons.push('effective author does not fully match a saved role; save the intended identity as a role, or do not install the hook here');
  if (role && isReservedRoleName(role.name)) reasons.push('the matching saved role uses the reserved name no-role; save it under a different name');
  if (!identity.committer.fullName.value?.trim() || !identity.committer.email.value?.trim() ||
      identity.committer.fullName.value !== author.fullName || identity.committer.email.value !== author.email) {
    reasons.push('effective committer name and email must match the complete effective author identity');
  }
  if (identity.scope.effective === 'mixed') reasons.push('effective identity mixes Git configuration sources; apply the intended complete role consistently');
  if (input.hasCommits === false && !identity.scope.hasLocalOverride) reasons.push('set the intended role locally before the first commit');
  if (input.policy && evaluateRepoPolicy(input.policy, role?.name).status === 'notAllowed') reasons.push(`the effective role is not allowed by .gitrole; allowed roles: ${input.policy.allowedRoles.join(', ')}`);
  const preferred = input.policy ? input.roles.find((candidate) => candidate.name === input.policy?.defaultRole) : role;
  return { exitCode: reasons.length ? 2 : 0, reasons, identity,
    suggestedRole: preferred && !isReservedRoleName(preferred.name) && preferred.fullName.trim() && preferred.email.trim() ? preferred.name : undefined };
}

/** A safe stage-specific error, never raw process output or file contents. */
export class CommitInputError extends Error {}
