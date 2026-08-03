export const PASSWORD_POLICY_MESSAGE = '8자 이상이며 대문자, 소문자, 특수문자 중 2종류 이상을 포함해야 합니다.'

export function passwordPolicyError(password: string): string {
  if (password.length < 8) return PASSWORD_POLICY_MESSAGE
  const categories = [
    /\p{Lu}/u.test(password),
    /\p{Ll}/u.test(password),
    /[^\p{L}\p{N}\s]/u.test(password),
  ].filter(Boolean).length
  return categories >= 2 ? '' : PASSWORD_POLICY_MESSAGE
}

export function passwordPairError(password: string, confirmation: string): string {
  return passwordPolicyError(password) || (password === confirmation ? '' : '비밀번호 확인이 일치하지 않습니다.')
}
