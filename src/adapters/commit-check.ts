/** Read-only local inputs for the commit guard, independent of push observation. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { CommitInputError, type CommitCheckInput } from '../application/check-commit.js';
import { validateRepoPolicy } from '../application/repo-policy.js';
import { SystemGitConfig } from './git-config.js';
import { parseStoredRoles, resolveRolesFilePath } from './role-store.js';

const execute = promisify(execFile);

/** No remote resolution, history traversal, lazy fetch or filesystem-monitor execution. */
export async function loadCommitInputs(): Promise<CommitCheckInput> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  const binary = env.GITROLE_GIT_BIN || 'git';
  const run = (args: string[]) => execute(binary, args, { env });
  // Validation only: do not buffer index entries or config values that we never use.
  const validate = (args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Git input validation failed')));
  });
  const roles = await stage('saved roles could not be read; check roles.json syntax, field types and file access', async () => {
    const source = await readOptionalRegularFile(resolveRolesFilePath(env));
    return source === undefined ? [] : parseStoredRoles(JSON.parse(source)).roles;
  });
  await stage('Git configuration could not be read', () => validate(['config', '--includes', '--null', '--list']));
  let inside: string;
  try { inside = (await run(['rev-parse', '--is-inside-work-tree'])).stdout.trim(); } catch (error) {
    if ((error as { code?: number }).code === 128 && /not a git repository/.test(String((error as { stderr?: string }).stderr)) &&
      !env.GIT_DIR && !env.GIT_WORK_TREE && !(await hasRepositoryMarker(process.cwd()))) return { roles, context: 'outside' };
    throw new CommitInputError('Git repository context could not be read; inspect .git and HEAD');
  }
  if (inside !== 'true') {
    const bare = await stage('Git repository context could not be read', () => run(['rev-parse', '--is-bare-repository']));
    return { roles, context: bare.stdout.trim() === 'true' ? 'bare' : 'outside' };
  }
  const top = await stage('Git working-tree root could not be read', () => run(['rev-parse', '--show-toplevel']));
  const root = top.stdout.replace(/\n$/, '');
  if (!root) throw new CommitInputError('Git working-tree root is missing');
  const [identity, policy, hasCommits] = await Promise.all([
    stage('effective author and committer could not be read from Git', () => new SystemGitConfig({ binaryPath: binary }).getEffectiveIdentity(env)),
    stage('.gitrole policy could not be read; check its syntax, fields and file access', async () => {
      const source = await readOptionalRegularFile(path.join(root, '.gitrole'));
      return source === undefined ? undefined : validateRepoPolicy(JSON.parse(source));
    }),
    stage('Git HEAD or index could not be read; repair the repository before committing', async () => {
      await validate(['-c', 'core.fsmonitor=false', 'ls-files', '--stage']);
      let oid: string;
      try { oid = (await run(['rev-parse', '--verify', '--quiet', 'HEAD'])).stdout.trim(); } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
        const ref = (await run(['symbolic-ref', '-q', 'HEAD'])).stdout.trim();
        if (!ref.startsWith('refs/heads/')) throw new Error('invalid unborn reference');
        await run(['check-ref-format', ref]);
        try { await run(['show-ref', '--verify', '--quiet', ref]); } catch (missing) {
          if ((missing as { code?: number }).code === 1) return false;
          throw missing;
        }
        throw new Error('HEAD could not resolve an existing reference');
      }
      if (!/^[a-f0-9]{40,64}$/.test(oid) || (await run(['cat-file', '-t', oid])).stdout.trim() !== 'commit') throw new Error('HEAD is not a readable commit');
      return true;
    })
  ]);
  return { roles, context: 'worktree', identity, policy, hasCommits };
}

async function stage<T>(message: string, read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch { throw new CommitInputError(message); }
}

async function hasRepositoryMarker(directory: string): Promise<boolean> {
  for (let current = directory;; current = path.dirname(current)) {
    try { await lstat(path.join(current, '.git')); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
    }
    if (path.dirname(current) === current) return false;
  }
}

/** Missing is optional; dangling links and unreadable/nonregular sources are errors. */
async function readOptionalRegularFile(filename: string): Promise<string | undefined> {
  try { await lstat(filename); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // ENOENT may hide a dangling directory symlink. Do not turn that into absence.
    for (let current = path.dirname(filename);; current = path.dirname(current)) {
      try { const metadata = await lstat(current); if (metadata.isSymbolicLink()) await stat(current); }
      catch (ancestorError) {
        if ((ancestorError as NodeJS.ErrnoException).code !== 'ENOENT') throw ancestorError;
        try { await lstat(current); } catch { if (path.dirname(current) === current) break; continue; }
        throw ancestorError;
      }
      if (path.dirname(current) === current) break;
    }
    return undefined;
  }
  if (!(await stat(filename)).isFile()) throw new Error('not a regular file');
  const file = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error('not a regular file');
    const source = await file.readFile('utf8');
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('file changed during read');
    return source;
  } finally { await file.close(); }
}
