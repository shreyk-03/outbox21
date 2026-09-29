import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSender,
  disconnectSlack,
  fetchEmailDetail,
  fetchScheduledEmails,
  fetchSenders,
  fetchSentEmails,
  fetchSlackStatus,
  scheduleBulkEmails,
  searchEmails,
  type CreateSenderInput,
  type ScheduleBulkInput,
} from '../services/api';

export const queryKeys = {
  scheduled: ['emails', 'scheduled'],
  sent: ['emails', 'sent'],
  senders: ['senders'],
  slackStatus: ['slack', 'status'],
  search: (q: string) => ['emails', 'search', q],
  emailDetail: (id: string) => ['emails', 'detail', id],
} as const;

export function useScheduledEmails() {
  return useQuery({ queryKey: queryKeys.scheduled, queryFn: fetchScheduledEmails });
}

export function useSentEmails() {
  return useQuery({ queryKey: queryKeys.sent, queryFn: fetchSentEmails });
}

export function useEmailDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.emailDetail(id ?? ''),
    queryFn: () => fetchEmailDetail(id as string),
    enabled: id !== null,
  });
}

export function useSenders() {
  return useQuery({ queryKey: queryKeys.senders, queryFn: fetchSenders });
}

export function useSlackStatus() {
  return useQuery({ queryKey: queryKeys.slackStatus, queryFn: fetchSlackStatus });
}

/** Backend (Elasticsearch) search; only fires for non-empty debounced queries. */
export function useEmailSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => searchEmails(q),
    enabled: q.length > 0,
  });
}

export function useScheduleBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleBulkInput) => scheduleBulkEmails(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduled });
    },
  });
}

export function useCreateSender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSenderInput) => createSender(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.senders });
    },
  });
}

export function useDisconnectSlack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectSlack(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.slackStatus });
    },
  });
}
