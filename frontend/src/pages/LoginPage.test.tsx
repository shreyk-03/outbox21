import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { startGoogleLogin } from '../services/api';

vi.mock('../services/api', () => ({
  startGoogleLogin: vi.fn(),
}));

function renderPage(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('starts real Google OAuth navigation on button click', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(startGoogleLogin).toHaveBeenCalledTimes(1);
  });

  it('shows backend OAuth error messages', () => {
    renderPage('/login?error=account_conflict');
    expect(screen.getByText(/already associated with a different sign-in/i)).toBeInTheDocument();
  });
});
