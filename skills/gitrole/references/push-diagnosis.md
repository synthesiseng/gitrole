# Push and account diagnosis

## Pushes

Determine the intended push command and destination first. `check commit` does not check pushes. For the default push context, run:

```bash
gitrole status --short
```

The eight fields are `role scope override commit remote auth policy overall`. Read them by name; `overall` is the eighth field, after `policy`.

| Result | Action |
| --- | --- |
| Exit `0` and `overall=aligned` | Current default-destination identity checks align; this is not proof of refspec readiness, push permission or success. |
| Exit `2`, `overall=warning`, or `commit`, `remote`, `auth`, or `policy` is `warn` | Stop. Do not push. Report the command, exit and warning fields. |
| Exit `1`, missing/malformed fields, or any unexpected result | Stop. Do not push. Report the error; exit `1` leaves stdout empty. |

`na` means skipped or not applicable, not authenticated. `policy=na` can align without a policy file. HTTPS-only destinations warn unless an allowing pin and the active role's saved `githubUser` satisfy the local HTTPS expectation; even then `auth=na` does not inspect, select, or verify HTTPS credentials. Mixed SSH/HTTPS warns online. Custom SSH commands and incomplete or interactive authentication contexts remain unverified.

Status observes every Git-resolved default push URL, independently of fetch origin. It has no destination argument or target override option. Default status cannot approve an explicit remote, URL, refspec or other future push arguments. Inspect the actual destination configuration (including all push URLs and URL rewrites) and refspec intent separately; if the requested context is not covered, stop and explain the limitation rather than treating default alignment as verification. Never rewrite remotes merely to make the check pass.

Use `gitrole doctor --json` for structured push diagnosis where online inspection is appropriate. Online checks can invoke SSH and configured `Match exec`, proxies or DNS, with effects allowed by existing SSH settings. If online inspection is not appropriate, use `gitrole doctor --offline --json` and report authentication as unverified; offline diagnosis does not establish live push authentication. Neither mode guarantees a future push after arguments, configuration or environment change.


## Repair the actual destination only with approval

`gitrole remote set <role>` rewrites origin’s fetch URL to the saved `githubHost`, preserving the observed owner/repository. It does not select or switch the role, configure an SSH alias, or guarantee a change to the actual push destination. Explicit `pushurl`, a different default push remote, and Git URL rewrites can make origin irrelevant. Inspect all resolved push URLs and the intended push command before proposing a repair. Never rewrite remotes merely to make status pass.

Read [identity and policy](identity-and-policy.md) only when role or policy work is needed. After an approved repair, repeat the relevant diagnosis in the actual push context. Do not change credentials, SSH settings, GitHub sessions, hooks, or history autonomously.

## Interactive account tests belong to the human

If an interactive account check is needed, ask the user to run `gitrole auth test` in a terminal. Never invoke it automatically from this skill, a hook, or a prompt. It can execute configured SSH commands, contact the network, prompt, save credentials or update known hosts under existing SSH settings.

It reports the observed account and mismatch with the effective role's `githubUser`; mismatch exits `2`. Even exit `0` does not prove a future push or override a status warning. No history is stored.
