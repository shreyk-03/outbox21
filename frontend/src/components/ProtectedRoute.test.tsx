import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/AuthContext';
import { RequireAuth } from './ProtectedRoute';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

const unauthenticated = { user: null, isAuthenticated: false, isLoading: false, logout: async () => undefined };

describe('RequireAuth', () => {
  it('shows a loading state while auth resolves (no premature redirect)', () => {
    mockedUseAuth.mockReturnValue({ ...unauthenticated, isLoading: true });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireAuth><div>Secret content</div></RequireAuth>,
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', async () => {
    mockedUseAuth.mockReturnValue(unauthenticated);
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<RequireAuth><div>Secret content</div></RequireAuth>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>,
      </MemoryRouter>,
    );
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('renders children for authenticated users', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: '1', name: 'A', email: 'a@example.com', avatarUrl: null },
      isAuthenticated: true,
      isLoading: false,
      logout: async () => undefined,
    });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireAuth><div>Secret content</div></RequireAuth>,
      </MemoryRouter>,
    );
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });
});
