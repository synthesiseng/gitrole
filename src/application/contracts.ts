/*
 * Collects the shared application contracts and result shapes used across gitrole.
 */
import type { GitIdentity, Role } from '../domain/role.js';
import type { RemoteInfo, RemoteProtocol } from '../adapters/git-repository.js';

export type { RemoteInfo, RemoteProtocol } from '../adapters/git-repository.js';

export interface UseRoleResult {
  role: Role;
  scope: UseScope;
  ssh?: SshLoadResult & { path: string };
  alignment?: RoleAlignmentResult;
}

export interface CurrentRoleResult {
  identity: GitIdentity;
  scope: 'global' | 'local';
  role?: Role;
}

export interface ListRolesResult {
  roles: Role[];
  activeRoleName?: string;
}

export interface ImportCurrentRoleResult {
  role: Role;
  scope: 'global' | 'local';
}

export interface DiagnosedValue {
  value?: string;
  source: 'local' | 'global' | 'env' | 'unset';
}

export type UseScope = 'global' | 'local';
export type EffectiveConfigScope = UseScope | 'mixed' | 'unset';

/**
 * Describes where the effective commit identity is coming from.
 *
 * @remarks
 * `effective` reports the aggregate source for the current name/email pair.
 * `hasLocalOverride` is true when either field is currently sourced from
 * repository-local config.
 */
export interface IdentityScopeResult {
  effective: EffectiveConfigScope;
  hasLocalOverride: boolean;
}

export interface DoctorCheck {
  status: 'ok' | 'warn' | 'info';
  label: string;
  message: string;
}

export type OverallStatus = 'aligned' | 'warning' | 'error';
export type RepoPolicyStatus = 'default' | 'allowed' | 'notAllowed';

export interface NonMergeCommit {
  sha: string;
  authorName: string;
  authorEmail: string;
  subject: string;
}

export interface RepoPolicy {
  version: 1;
  defaultRole: string;
  allowedRoles: string[];
}

export interface RepoPolicyEvaluation extends RepoPolicy {
  effectiveRole?: string;
  status: RepoPolicyStatus;
}

export interface PinRepoPolicyResult {
  role: Role;
  repoPolicy: RepoPolicy;
}

export interface DoctorResult {
  role?: Role;
  overall: OverallStatus;
  commitIdentity: {
    fullName: DiagnosedValue;
    email: DiagnosedValue;
  };
  configuredIdentity: {
    local: GitIdentity;
    global: GitIdentity;
  };
  scope: IdentityScopeResult;
  repository: {
    isInsideWorkTree: boolean;
    hasCommits?: boolean;
    topLevelPath?: string;
    currentBranch?: string;
    upstreamBranch?: string;
    remote?: RemoteInfo;
  };
  sshAuth?: SshAuthProbeResult;
  repoPolicy?: RepoPolicyEvaluation;
  checks: DoctorCheck[];
}

export interface RoleAlignmentResult {
  role: Role;
  repository: DoctorResult['repository'];
  commitIdentity: DoctorResult['commitIdentity'];
  scope: IdentityScopeResult;
  sshAuth?: SshAuthProbeResult;
  checks: DoctorCheck[];
}

export interface RemoteUseResult {
  role: Role;
  previousUrl: string;
  nextUrl: string;
}

export interface StatusResult {
  roleName: string;
  commitIdentity?: string;
  pushAuth?: string;
  scope: EffectiveConfigScope;
  localOverride: boolean;
  lastNonMergeCommit?: NonMergeCommit;
  historyNote?: string;
  envNote?: string;
  overall: 'aligned' | 'warning';
  commit: 'ok' | 'warn' | 'na';
  remote: 'ok' | 'warn' | 'na';
  auth: 'ok' | 'warn' | 'na';
  policy: 'ok' | 'warn' | 'na';
  repoPolicy?: RepoPolicyEvaluation;
}

export interface RoleStore {
  list(): Promise<Role[]>;
  get(name: string): Promise<Role | undefined>;
  save(role: Role): Promise<void>;
  remove(name: string): Promise<boolean>;
}

export interface GitConfig {
  getGlobalUserName(): Promise<string | undefined>;
  getGlobalUserEmail(): Promise<string | undefined>;
  setGlobalUserName(name: string): Promise<void>;
  setGlobalUserEmail(email: string): Promise<void>;
}

export interface SshLoadResult {
  ok: boolean;
  message?: string;
}

export interface SshAgent {
  loadKey(path: string): Promise<SshLoadResult>;
}

export interface GitRepository {
  isInsideWorkTree(): Promise<boolean>;
  hasCommits(): Promise<boolean>;
  getLatestNonMergeCommit(): Promise<NonMergeCommit | undefined>;
  getTopLevelPath(): Promise<string | undefined>;
  getCurrentBranch(): Promise<string | undefined>;
  getUpstreamBranch(): Promise<string | undefined>;
  getOriginUrl(): Promise<string | undefined>;
  getOriginRemote(): Promise<RemoteInfo | undefined>;
  setOriginUrl(url: string): Promise<void>;
  getLocalUserName(): Promise<string | undefined>;
  getLocalUserEmail(): Promise<string | undefined>;
  setLocalUserName(name: string): Promise<void>;
  setLocalUserEmail(email: string): Promise<void>;
}

export interface SshAuthProbeResult {
  ok: boolean;
  host: string;
  githubUser?: string;
  message?: string;
}

export interface SshAuthProbe {
  probeGithubUser(host: string): Promise<SshAuthProbeResult>;
}

export interface AppDependencies {
  roleStore: RoleStore;
  gitConfig: GitConfig;
  sshAgent: SshAgent;
}

export interface CurrentRoleDependencies extends AppDependencies {
  repository?: Pick<GitRepository, 'getLocalUserName' | 'getLocalUserEmail'>;
}

export interface UseRoleDependencies extends AppDependencies {
  repository?: GitRepository;
  sshAuthProbe?: SshAuthProbe;
}

export interface DoctorDependencies {
  roleStore: RoleStore;
  gitConfig: GitConfig;
  repository: GitRepository;
  sshAuthProbe: SshAuthProbe;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveRepoPolicyDependencies {
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>;
}

export interface PinRepoPolicyDependencies {
  roleStore: RoleStore;
  repository: Pick<GitRepository, 'isInsideWorkTree' | 'getTopLevelPath'>;
}

export interface RemoteUseDependencies {
  roleStore: RoleStore;
  repository: GitRepository;
}

/**
 * Controls whether a role switch applies to global Git config or the current
 * repository's local config.
 */
export interface UseRoleOptions {
  scope?: UseScope;
}

export function getDoctorOverall(
  result: Pick<DoctorResult, 'checks'>
): Exclude<OverallStatus, 'error'> {
  return result.checks.some((check) => check.status === 'warn') ? 'warning' : 'aligned';
}
