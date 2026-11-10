export interface ReminderItem {
  id: string;
  kind: "comment" | "payment" | "action";
  title: string;
  body: string;
  next: string;
  path: string;
  createdAt: string;
  readAt: string | null;
  handled: boolean;
}
export interface ReminderResult {
  list: ReminderItem[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}
export interface ReminderApi {
  list(input?: {
    page?: number;
    pageSize?: number;
    state?: "unread" | "all";
  }): Promise<ReminderResult>;
  read(
    id: string,
    read: boolean,
  ): Promise<{ id: string; readAt: string | null }>;
}
