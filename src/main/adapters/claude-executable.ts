import { win32 } from 'path'

/**
 * Locating the `claude` executable on Windows. Pure functions over injected fs
 * calls (and `path.win32`, so they behave the same on any host) so every
 * branch can be unit tested without a Windows machine.
 */

export interface ClaudeResolveFs {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
}

/**
 * `where claude` can list npm's extensionless POSIX shim (kept for
 * git-bash/WSL) ahead of the `.cmd`/`.exe` wrapper — enumeration order isn't
 * guaranteed alphabetical. The shim isn't a native Windows executable, so
 * prefer a `.cmd`/`.exe` match and only fall back to the first line.
 */
export function pickWindowsWhichMatch(matches: string[]): string | undefined {
  return matches.find((m) => /\.(cmd|exe)$/i.test(m)) ?? matches[0]
}

/**
 * The SDK spawns the executable directly (no shell), so a `.cmd` wrapper
 * fails with EINVAL and an extensionless POSIX shim fails to launch. Resolve
 * a shim to the real thing: the native `bin/claude.exe` that current
 * claude-code ships, or the `cli.js` of the older node-based packaging.
 *
 * Returns the input unchanged when it cannot be resolved.
 */
export function resolveWindowsClaudeShim(shimPath: string, fs: ClaudeResolveFs): string {
  // Already a native executable — nothing to resolve. Never read it as text:
  // it is a huge binary, and a regex over it can match unrelated strings.
  if (/\.exe$/i.test(shimPath)) return shimPath

  const dir = win32.dirname(shimPath)
  const pkgDir = win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code')

  // Current packaging: the shim execs a native binary, no node/cli.js at all.
  const nativeExe = win32.join(pkgDir, 'bin', 'claude.exe')
  if (fs.existsSync(nativeExe)) return nativeExe

  // Older packaging: node + cli.js.
  const cliJs = win32.join(pkgDir, 'cli.js')
  if (fs.existsSync(cliJs)) return cliJs

  // Non-standard layout: read the shim itself. npm's generated shims use the
  // batch-file-directory token `%~dp0` (older ones `%dp0%`) — handle both.
  const content = fs.readFileSync(shimPath, 'utf8')
  // `%~dp0` already ends in a backslash and shims also write `%dp0%\…`, so
  // normalize to collapse the doubled separator and any `..` segments.
  const resolveToken = (raw: string): string => win32.normalize(raw.replace(/%~?dp0%?/g, dir + '\\'))

  // Only accept an .exe that is plainly claude's. A bare `"[^"]+\.exe"` would
  // also match `"%dp0%\node.exe"` in node-based shims and return node itself.
  const exeMatch = content.match(/"([^"]*claude[^"]*\.exe)"/i)
  if (exeMatch?.[1]) {
    const resolvedExe = resolveToken(exeMatch[1])
    if (fs.existsSync(resolvedExe)) return resolvedExe
  }

  const jsMatch = content.match(/"[^"]*node(?:\.exe)?"[^"]*"([^"]+\.js)"/)
    || content.match(/node(?:\.exe)?\s+"([^"]+\.js)"/)
    || content.match(/node(?:\.exe)?\s+([^\s]+\.js)/)
  if (jsMatch?.[1]) {
    const resolvedJs = resolveToken(jsMatch[1])
    if (fs.existsSync(resolvedJs)) return resolvedJs
  }

  return shimPath
}
