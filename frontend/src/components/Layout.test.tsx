// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'
import type { User } from '../types'

const baseUser: User = { id: 'user-1', username: 'user', display_name: '사용자', role: 'ANNOTATOR', status: 'ACTIVE' }

describe('role based navigation', () => {
  it('hides administrator functions from an annotator', () => {
    render(<Layout user={baseUser} page="dashboard" onPage={vi.fn()} onLogout={vi.fn()}><div>content</div></Layout>)
    expect(screen.queryByRole('button', { name: '관리자' })).toBeNull()
    expect(screen.getByRole('button', { name: '내 작업' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '검수' })).toBeNull()
  })

  it('shows project administration without user work menus to a project manager', () => {
    render(<Layout user={{ ...baseUser, role: 'PROJECT_MANAGER' }} page="admin" onPage={vi.fn()} onLogout={vi.fn()}><div>content</div></Layout>)
    expect(screen.getByRole('button', { name: '관리자' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '내 작업' })).toBeNull()
    expect(screen.queryByRole('button', { name: '검수' })).toBeNull()
  })
})
