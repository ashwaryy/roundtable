import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendJsonl, atomicRewriteJsonl } from './jsonl'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-jsonl-'))
  file = path.join(dir, 'test.jsonl')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('appendJsonl', () => {
  it('creates the file and appends a JSON line', () => {
    appendJsonl(file, { id: 'a1', val: 1 })
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({ id: 'a1', val: 1 })
  })

  it('appends subsequent records without overwriting', () => {
    appendJsonl(file, { id: 'a1' })
    appendJsonl(file, { id: 'a2' })
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1])).toEqual({ id: 'a2' })
  })
})

describe('atomicRewriteJsonl', () => {
  it('writes records as newline-terminated JSON lines', () => {
    atomicRewriteJsonl(file, [{ id: 'b1' }, { id: 'b2' }])
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).toBe('{"id":"b1"}\n{"id":"b2"}\n')
  })

  it('writes an empty file when records is empty', () => {
    fs.writeFileSync(file, '{"id":"old"}\n')
    atomicRewriteJsonl(file, [])
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('replaces existing content', () => {
    appendJsonl(file, { id: 'old' })
    atomicRewriteJsonl(file, [{ id: 'new' }])
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({ id: 'new' })
  })
})
