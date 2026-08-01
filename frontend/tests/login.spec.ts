import { expect, test } from '@playwright/test'

test('administrator logs in and creates a project', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '계정으로 로그인' })).toBeVisible()
  await page.getByLabel('아이디').fill('admin')
  await page.getByLabel('비밀번호').fill('ChangeThisBeforeUse123!')
  await page.getByRole('button', { name: '안전하게 로그인' }).click()
  await page.getByRole('button', { name: '관리자' }).click()
  await expect(page.getByRole('heading', { name: '관리자 페이지' })).toBeVisible()
  const projectName = `E2E-${Date.now()}`
  await page.getByPlaceholder('새 프로젝트 이름').fill(projectName)
  await page.getByPlaceholder('설명').fill('Synthetic end-to-end project')
  await page.getByRole('button', { name: '생성' }).click()
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
})
