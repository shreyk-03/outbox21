import axios from 'axios';
import type { EmailDetail, EmailListItem, ScheduleBulkResult, Sender, SlackStatus } from '../types/api';

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

export async function fetchScheduledEmails(): Promise<EmailListItem[]> {
  const res = await api.get<{ emails: EmailListItem[] }>('/emails/scheduled');
  return res.data.emails;
}

export async function fetchSentEmails(): Promise<EmailListItem[]> {
  const res = await api.get<{ emails: EmailListItem[] }>('/emails/sent');
  return res.data.emails;
}

export async function fetchEmailDetail(id: string): Promise<EmailDetail> {
  const res = await api.get<EmailDetail>(`/emails/${id}`);
  return res.data;
}

export async function searchEmails(query: string): Promise<EmailListItem[]> {
  const res = await api.get<{ emails: EmailListItem[] }>('/emails/search', { params: { q: query } });
  return res.data.emails;
}

export interface ScheduleBulkInput {
  senderId: string;
  subject: string;
  body: string;
  scheduledAt: string;
  delayMs: number;
  recipients: string[];
}

export async function scheduleBulkEmails(input: ScheduleBulkInput): Promise<ScheduleBulkResult> {
  const res = await api.post<ScheduleBulkResult>('/emails/schedule/bulk', input);
  return res.data;
}

export async function fetchSenders(): Promise<Sender[]> {
  const res = await api.get<{ senders: Sender[] }>('/senders');
  return res.data.senders;
}

export interface CreateSenderInput {
  email: string;
  name: string;
  hourlyLimit: number;
}

export async function createSender(input: CreateSenderInput): Promise<Sender> {
  const res = await api.post<Sender>('/senders', input);
  return res.data;
}

export async function fetchSlackStatus(): Promise<SlackStatus> {
  const res = await api.get<SlackStatus>('/slack/status');
  return res.data;
}

export function startSlackConnect(): void {
  window.location.href = '/api/slack/connect';
}

export async function disconnectSlack(): Promise<void> {
  await api.post('/slack/disconnect');
}

/** Human-readable message for API failures; never leaks raw payloads. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { code?: string; message?: string } } | undefined;
    if (err.response?.status === 401) return 'Your session has expired. Please sign in again.';
    if (typeof data?.error?.message === 'string' && data.error.message) return data.error.message;
  }
  return fallback;
}
