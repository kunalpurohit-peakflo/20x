import { describe, it, expect, vi } from 'vitest'
import { pickWindowsWhichMatch, resolveWindowsClaudeShim } from './claude-executable'

const NPM = 'C:\\Users\\me\\AppData\\Roaming\\npm'
const PKG = `${NPM}\\node_modules\\@anthropic-ai\\claude-code`

function fakeFs(files: Record<string, string> = {}) {
  const readFileSync = vi.fn((path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`)
    return files[path]
  })
  return { existsSync: (path: string) => path in files, readFileSync }
}

describe('pickWindowsWhichMatch', () => {
  it('prefers the .cmd wrapper over the extensionless POSIX shim listed first', () => {
    expect(pickWindowsWhichMatch([`${NPM}\\claude`, `${NPM}\\claude.cmd`])).toBe(`${NPM}\\claude.cmd`)
  })

  it('takes the first .cmd/.exe in listed order', () => {
    expect(pickWindowsWhichMatch([`${NPM}\\claude`, `${NPM}\\claude.exe`, `${NPM}\\claude.cmd`])).toBe(`${NPM}\\claude.exe`)
  })

  it('falls back to the first line when no .cmd/.exe is listed', () => {
    expect(pickWindowsWhichMatch([`${NPM}\\claude`])).toBe(`${NPM}\\claude`)
  })

  it('returns undefined for no matches', () => {
    expect(pickWindowsWhichMatch([])).toBeUndefined()
  })
})

describe('resolveWindowsClaudeShim', () => {
  it('returns a native .exe unchanged without ever reading it as text', () => {
    // Regression guard: a native claude.exe is a huge binary; reading it as
    // UTF-8 and regex-matching it could return an unrelated executable.
    const fs = fakeFs({ 'C:\\Users\\me\\.local\\bin\\claude.exe': '"C:\\Windows\\System32\\cmd.exe"' })
    expect(resolveWindowsClaudeShim('C:\\Users\\me\\.local\\bin\\claude.exe', fs)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('resolves a .cmd shim to the native binary of current claude-code', () => {
    const nativeExe = `${PKG}\\bin\\claude.exe`
    const fs = fakeFs({ [`${NPM}\\claude.cmd`]: '', [nativeExe]: '' })
    expect(resolveWindowsClaudeShim(`${NPM}\\claude.cmd`, fs)).toBe(nativeExe)
  })

  it('resolves the extensionless POSIX shim to the native binary too', () => {
    const nativeExe = `${PKG}\\bin\\claude.exe`
    const fs = fakeFs({ [`${NPM}\\claude`]: '#!/bin/sh', [nativeExe]: '' })
    expect(resolveWindowsClaudeShim(`${NPM}\\claude`, fs)).toBe(nativeExe)
  })

  it('resolves to cli.js for the older node-based packaging', () => {
    const cliJs = `${PKG}\\cli.js`
    const fs = fakeFs({ [`${NPM}\\claude.cmd`]: '', [cliJs]: '' })
    expect(resolveWindowsClaudeShim(`${NPM}\\claude.cmd`, fs)).toBe(cliJs)
  })

  it('prefers the native binary when both layouts exist', () => {
    const nativeExe = `${PKG}\\bin\\claude.exe`
    const fs = fakeFs({ [`${NPM}\\claude.cmd`]: '', [nativeExe]: '', [`${PKG}\\cli.js`]: '' })
    expect(resolveWindowsClaudeShim(`${NPM}\\claude.cmd`, fs)).toBe(nativeExe)
  })

  it('parses a %~dp0 claude.exe target out of a non-standard-layout shim', () => {
    const shim = 'D:\\tools\\claude.cmd'
    const target = 'D:\\tools\\vendor\\claude.exe'
    const fs = fakeFs({ [shim]: '@ECHO off\r\n"%~dp0\\vendor\\claude.exe" %*', [target]: '' })
    expect(resolveWindowsClaudeShim(shim, fs)).toBe(target)
  })

  it('parses a node + cli.js invocation and expands the legacy %dp0% token', () => {
    const shim = 'D:\\tools\\claude.cmd'
    const cli = 'D:\\tools\\lib\\claude-code\\cli.js'
    const fs = fakeFs({ [shim]: '"%dp0%\\node.exe" "%dp0%\\lib\\claude-code\\cli.js" %*', [cli]: '' })
    expect(resolveWindowsClaudeShim(shim, fs)).toBe(cli)
  })

  it('never returns node.exe when it sits beside a node-based shim', () => {
    // Regression guard: an unrestricted `"…\.exe"` match would grab
    // `"%dp0%\node.exe"` and hand node back as the Claude executable.
    const shim = 'D:\\nodejs\\claude.cmd'
    const cli = 'D:\\nodejs\\lib\\claude-code\\cli.js'
    const fs = fakeFs({
      [shim]: '"%dp0%\\node.exe" "%dp0%\\lib\\claude-code\\cli.js" %*',
      'D:\\nodejs\\node.exe': '',
      [cli]: ''
    })
    const resolved = resolveWindowsClaudeShim(shim, fs)
    expect(resolved).toBe(cli)
    expect(resolved.toLowerCase()).not.toContain('node.exe')
  })

  it('returns the shim unchanged when nothing resolves', () => {
    const shim = 'D:\\tools\\claude.cmd'
    const fs = fakeFs({ [shim]: '@ECHO off\r\necho nothing useful' })
    expect(resolveWindowsClaudeShim(shim, fs)).toBe(shim)
  })

  it('ignores a parsed target that does not exist on disk', () => {
    const shim = 'D:\\tools\\claude.cmd'
    const fs = fakeFs({ [shim]: '"%~dp0\\vendor\\claude.exe" %*' })
    expect(resolveWindowsClaudeShim(shim, fs)).toBe(shim)
  })
})
