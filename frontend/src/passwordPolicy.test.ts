import { describe, expect, it } from 'vitest'
import { passwordPairError, passwordPolicyError } from './passwordPolicy'

describe('password policy', () => {
  it('requires at least eight characters', () => {
    expect(passwordPolicyError('Ab!123')).not.toBe('')
  })

  it('accepts any two of uppercase, lowercase, and special characters', () => {
    expect(passwordPolicyError('Abcdefgh')).toBe('')
    expect(passwordPolicyError('ABCDEFG!')).toBe('')
    expect(passwordPolicyError('abcdefg!')).toBe('')
  })

  it('does not count digits as one of the required categories', () => {
    expect(passwordPolicyError('abcdefgh1')).not.toBe('')
    expect(passwordPolicyError('12345678!')).not.toBe('')
  })

  it('requires matching confirmation', () => {
    expect(passwordPairError('Abcdefgh', 'Abcdefg!')).toBe('비밀번호 확인이 일치하지 않습니다.')
    expect(passwordPairError('Abcdefgh', 'Abcdefgh')).toBe('')
  })
})
