export const DEFAULT_QUEUE_RETENTION_SECONDS = 4 * 24 * 60 * 60;

export interface QueueSettingsProps {
  readonly queueId: string;
  readonly messageRetentionSeconds: number;
}

export interface QueueSettingsAttributes extends QueueSettingsProps {
  readonly accountId: string;
}
