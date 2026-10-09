/** Plain stderr diagnostics for the local guard; never executable user text. */
import type { CommitCheckResult } from '../application/check-commit.js';

function display(value: string | undefined): string {
  // JSON quoting escapes terminal controls and bounds potentially large identity values.
  return JSON.stringify(value === undefined ? '(unset)' : value.slice(0, 512)).replace(/[\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function renderCommitCheck(result: CommitCheckResult, hookOwnsBypass = false): string {
  if (result.exitCode === 0) return '';
  const lines = result.reasons.map((reason) => `gitrole check commit: ${reason.slice(0, 1024)}${reason.length > 1024 ? '… (truncated; inspect .gitrole and saved role data)' : ''}`);
  if (result.exitCode === 1) lines.push('Inspect and repair the named Git or data input and its read permissions, then rerun gitrole check commit. The check has not verified this commit.');
  if (result.identity) {
    for (const kind of ['author', 'committer'] as const) {
      const identity = result.identity[kind];
      lines.push(`${kind}: name=${display(identity.fullName.value)} (${identity.fullName.source}), email=${display(identity.email.value)} (${identity.email.source})`);
    }
    if (result.suggestedRole && result.suggestedRole.length <= 128) {
      lines.push(`If this is the intended role, apply it with: gitrole use '${result.suggestedRole}' --local`);
    } else if (result.suggestedRole) {
      lines.push('The suggested role name is too long to display safely. Consult gitrole list, then use the complete intended role name with gitrole use <name> --local.');
    }
    lines.push('Review the effective author and committer above. Environment overrides and Git-prepared authors (--author, amend or reused commits) may also need correction; changing local config alone may not fix them.');
  }
  if (!hookOwnsBypass) lines.push('git commit --no-verify bypasses this pre-commit hook and all other pre-commit checks (and commit-msg). It does not correct identity. Use it only if you deliberately accept that bypass.');
  return lines.join('\n');
}
