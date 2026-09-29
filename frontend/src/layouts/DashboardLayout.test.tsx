import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DashboardLayout } from './DashboardLayout';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../context/AuthContext';

const mockedUseAuth = vi.mocked(useAuth);

describe('DashboardLayout logout', () => {
  it('calls backend logout and redirects to /login', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue({
      user: { id: '1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
      isAuthenticated: true,
      isLoading: false,
      logout,
    });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>,
      </MemoryRouter>,
    );
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^logout$/i }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
