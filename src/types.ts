export interface Suggestion {
  id: string;
  name: string;
  reason: string;
}
export interface Prepared {
  token: string;
  route: string;
  endpoint: string;
  model: string;
  payload: {
    messages: {
      role: string;
      content: string | { type: string; text?: string; image_url?: { url: string } }[];
    }[];
  };
  skipped: { name: string; reason: string }[];
  count: number;
}
export interface HistoryItem {
  id: string;
  batch: string;
  source: string;
  target: string;
  operation: string;
  state: string;
  created: number;
}
