/*
 * Locked status --short lines. Field order is part of the contract.
 */
export const statusShortFieldOrder = [
  'role',
  'scope',
  'override',
  'commit',
  'remote',
  'auth',
  'policy',
  'overall'
] as const;

export const statusShortBaseline = {
  id: 'status-short-baseline',
  line: 'role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned'
} as const;

export const httpsPinAligned = {
  id: 'https-pin-aligned',
  line: 'role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned'
} as const;

export const sshAuthMismatch = {
  id: 'ssh-auth-mismatch',
  line: 'role=work scope=global override=false commit=warn remote=ok auth=warn policy=na overall=warning'
} as const;

export const sshAuthMatch = {
  id: 'ssh-auth-match',
  line: 'role=work scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned'
} as const;

export const statusShortPolicyWarn = {
  id: 'status-short-policy-warn',
  line: 'role=client-acme scope=local override=true commit=ok remote=ok auth=ok policy=warn overall=warning'
} as const;

export const statusShortPolicyOk = {
  id: 'status-short-policy-ok',
  line: 'role=work scope=local override=true commit=ok remote=ok auth=ok policy=ok overall=aligned'
} as const;
