import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export interface HealthResponse {
  status: string;
  redis: string;
  database: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await api.get<HealthResponse>('/health');
  return res.data;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface MeResponse {
  authenticated: boolean;
  user: AuthUser;
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await api.get<MeResponse>('/auth/me');
    return res.data.user;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null;
    throw err;
  }
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export function startGoogleLogin(): void {
  // Full-page navigation so the server can 302 to Google's consent screen
  // and the session cookie is set on the top-level return trip.
  window.location.href = '/api/auth/google';
}
