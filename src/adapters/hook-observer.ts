/* Read-only, bounded observation of Git's effective pre-commit hook for doctor. */
import { execFile } from 'node:child_process';
import { constants, type Stats } from 'node:fs';
import { access, lstat, open, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { DoctorCheck } from '../application/contracts.js';

const exec = promisify(execFile);
const MAX_BYTES = 64 * 1024;
const LEGACY_SHA256 = 'd2c77180b17596304e4cd902d3b70271e2dd79070402f3a8e96d40da77720da6';

type Snapshot = { path: string; stat: Stats };

function same(a: Stats, b: Stats): boolean {
  // Neighbor entries can change directory timestamps without changing this path.
  if (a.isDirectory() && b.isDirectory()) return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function displayPath(value: string): string {
  const rendered = JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return rendered.length <= 1024 ? rendered : `${rendered.slice(0, 1022)}…\"`;
}

function info(message: string): DoctorCheck {
  return { status: 'info', label: 'hook', message };
}

function unknown(reason: string): DoctorCheck {
  return info(`Could not inspect pre-commit hook; migration state unknown (${reason}). Review it manually.`);
}

/** Resolve every component, including parent symlinks, within one eight-link budget. */
async function resolveHook(input: string): Promise<{ target?: string; snapshots: Snapshot[]; linked: boolean }> {
  let pending = input.split(path.sep).filter(Boolean).map(value => ({ value, required: false }));
  let current = path.parse(input).root;
  let links = 0;
  const snapshots: Snapshot[] = [];
  while (pending.length) {
    const { value: component, required } = pending.shift()!;
    if (component === '.') continue;
    if (component === '..') { current = path.dirname(current); continue; }
    current = path.join(current, component);
    let stat: Stats;
    try { stat = await lstat(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) {
        return { snapshots, linked: links > 0 };
      }
      throw error;
    }
    snapshots.push({ path: current, stat });
    if (stat.isSymbolicLink()) {
      if (++links > 8) throw new Error('link limit');
      const target = await readlink(current);
      pending = [...target.split(path.sep).filter(Boolean).map(value => ({ value, required: true })), ...pending];
      current = path.isAbsolute(target) ? path.parse(target).root : path.dirname(current);
    } else if (pending.length && !stat.isDirectory()) {
      throw new Error('non-directory parent');
    }
  }
  return { target: current, snapshots, linked: links > 0 };
}

async function unchanged(snapshots: Snapshot[]): Promise<boolean> {
  for (const snapshot of snapshots) {
    if (!same(snapshot.stat, await lstat(snapshot.path))) return false;
  }
  return true;
}

/**
 * Inspect only the nominated regular file; never execute hooks or change setup.
 * Byte and symlink limits do not imply a wall-clock bound on stalled filesystems.
 */
export async function observeLegacyHook(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<DoctorCheck | undefined> {
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_OPTIONAL_LOCKS: '0' };
  const git = async (args: string[]) => (await exec(env.GITROLE_GIT_BIN ?? 'git', args, { cwd: options.cwd, env, maxBuffer: MAX_BYTES })).stdout;
  let nominated: string;
  try {
    const bare = await git(['rev-parse', '--is-bare-repository']);
    if (bare === 'true\n') return undefined;
    if (bare !== 'false\n') return unknown('repository context unavailable');
    // Absolute formatting dereferences symlinks, losing ownership and dangling-link evidence.
    const result = await git(['rev-parse', '--git-path', 'hooks/pre-commit']);
    const lexical = result.endsWith('\n') ? result.slice(0, -1) : result;
    if (!lexical || lexical.includes('\0')) return unknown('effective hook path unavailable');
    const cwd = options.cwd ?? process.cwd();
    nominated = path.isAbsolute(lexical) ? lexical : `${cwd}${path.sep}${lexical}`;
    if (!path.isAbsolute(nominated)) return unknown('effective hook path unavailable');
  } catch {
    return unknown('effective hook path unavailable');
  }

  try {
    const resolved = await resolveHook(nominated);
    if (!resolved.target) return (await unchanged(resolved.snapshots)) ? undefined : unknown('path changed during inspection');
    const absoluteResult = await git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-commit']);
    const absolute = absoluteResult.endsWith('\n') ? absoluteResult.slice(0, -1) : absoluteResult;
    if (absolute !== resolved.target) return unknown('effective hook path changed during inspection');
    const before = await lstat(resolved.target);
    if (!before.isFile()) return unknown('effective hook is not a regular file');
    if (before.size > MAX_BYTES) return unknown('hook exceeds 64 KiB inspection limit');
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
      return unknown('safe file opening unavailable');
    }
    const handle = await open(resolved.target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !same(before, opened) || !(await unchanged(resolved.snapshots))) {
        return unknown('path changed during inspection');
      }
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let count = 0;
      while (count < buffer.length) {
        const read = await handle.read(buffer, count, buffer.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > MAX_BYTES) return unknown('hook exceeds 64 KiB inspection limit');
      if (!same(opened, await handle.stat()) || !(await unchanged(resolved.snapshots))) {
        return unknown('path changed during inspection');
      }
      bytes = buffer.subarray(0, count);
    } finally {
      await handle.close();
    }
    let executable = true;
    try { await access(resolved.target, constants.X_OK); } catch { executable = false; }
    if (!(await unchanged(resolved.snapshots))) return unknown('path changed during inspection');
    const location = displayPath(nominated);
    if (createHash('sha256').update(bytes).digest('hex') === LEGACY_SHA256) {
      const active = executable
        ? 'It uses combined commit/push status.'
        : 'It is not executable; it is not established as an active commit blocker.';
      const linked = resolved.linked ? ' The symlink target matches; it may be shared. Review ownership manually.' : ' The hook may be shared by worktrees; review ownership.';
      return info(`Legacy Gitrole pre-commit hook file found at ${location}. ${active}${linked} See the hook migration guide before replacing it with the local commit check.`);
    }
    if (bytes.toString('utf8').includes('gitrole status --short')) {
      return info(`Custom/composed pre-commit hook at ${location} contains legacy status invocation text; execution behavior not determined. Review it manually.`);
    }
    return undefined;
  } catch {
    return unknown('file unreadable, unresolved, or changed during inspection');
  }
}
