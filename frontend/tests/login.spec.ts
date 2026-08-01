import { expect,test } from '@playwright/test'
test('administrator logs in and creates a project',async({page})=>{
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'계정에 로그인'})).toBeVisible()
  await expect(page.getByText('의료영상은 외부 서비스로 전송되지 않습니다.')).toBeVisible()
  await page.getByLabel('아이디').fill('admin')
  await page.getByLabel('비밀번호').fill('ChangeThisBeforeUse123!')
  await page.getByRole('button',{name:'안전하게 로그인'}).click()
  await expect(page.getByRole('heading',{name:/안녕하세요/})).toBeVisible()
  await page.getByRole('button',{name:'프로젝트'}).click()
  const projectName=`E2E-${Date.now()}`
  await page.getByPlaceholder('새 프로젝트 이름').fill(projectName)
  await page.getByPlaceholder('설명').fill('Synthetic end-to-end project')
  await page.getByRole('button',{name:'생성'}).click()
  await expect(page.getByRole('heading',{name:projectName,exact:true})).toBeVisible()
})
