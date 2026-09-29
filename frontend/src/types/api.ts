export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface EmailListItem {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  attempts: number;
  createdAt: string;
}

export interface EmailDetail extends EmailListItem {
  body: string;
  errorMessage: string | null;
  bullmqJobId: string | null;
}

export interface Sender {
  id: string;
  email: string;
  name: string;
  hourlyLimit: number;
  createdAt: string;
}

export interface ScheduleBulkResult {
  campaignId: string;
  totalRecipients: number;
  scheduled: number;
  failed: number;
  duplicatesRemoved: number;
  startTime: string;
  status: 'scheduled';
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string };
}
