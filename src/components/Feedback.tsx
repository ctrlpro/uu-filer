import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { CircleCheck, CircleAlert, Info, LoaderCircle, X } from 'lucide-react';

export type NoticeKind = 'success' | 'error' | 'warning' | 'info';
export interface FeedbackNotice {
  id: number;
  text: string;
  kind: NoticeKind;
}
interface FeedbackState {
  notice: FeedbackNotice | null;
  busy: string;
  dismiss: (id: number) => void;
  register: (id: string) => () => void;
  activeHost: string | undefined;
}
const FeedbackContext = createContext<FeedbackState | null>(null);

export function FeedbackProvider({
  notice,
  busy,
  dismiss,
  children,
}: {
  notice: FeedbackNotice | null;
  busy: string;
  dismiss: (id: number) => void;
  children: ReactNode;
}) {
  const [hosts, setHosts] = useState<string[]>([]);
  const register = useCallback((id: string) => {
    setHosts((old) => [...old.filter((host) => host !== id), id]);
    return () => setHosts((old) => old.filter((host) => host !== id));
  }, []);
  const state = { notice, busy, dismiss, register, activeHost: hosts.at(-1) };
  return (
    <FeedbackContext.Provider value={state}>
      {children}
      {!hosts.length && <FeedbackView {...state} />}
    </FeedbackContext.Provider>
  );
}

// Native dialogs are in the browser's top layer. Render inside the active dialog so
// feedback stays visible and is announced to assistive technology while the page is inert.
export function ModalFeedback() {
  const context = useContext(FeedbackContext),
    id = useId(),
    register = context?.register;
  useEffect(() => register?.(id), [register, id]);
  return context?.activeHost === id ? <FeedbackView {...context} /> : null;
}

function FeedbackView({
  notice,
  busy,
  dismiss,
}: Pick<FeedbackState, 'notice' | 'busy' | 'dismiss'>) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!notice) setPaused(false);
  }, [notice]);
  useEffect(() => {
    if (!notice || paused || notice.kind === 'error' || notice.kind === 'warning') return;
    const timer = setTimeout(() => dismiss(notice.id), 5000);
    return () => clearTimeout(timer);
  }, [notice, paused, dismiss]);
  const message = notice ?? (busy ? { id: 0, text: busy, kind: 'loading' as const } : null);
  if (!message) return null;
  const important = message.kind === 'error' || message.kind === 'warning';
  const Icon =
    message.kind === 'loading'
      ? LoaderCircle
      : message.kind === 'success'
        ? CircleCheck
        : important
          ? CircleAlert
          : Info;
  return (
    <div
      className={`feedback-toast ${message.kind}`}
      data-kind={message.kind}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <div
        className="feedback-message"
        key={message.id}
        role={important ? 'alert' : 'status'}
        aria-live={important ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        <Icon
          size={19}
          className={message.kind === 'loading' ? 'spin' : undefined}
          aria-hidden="true"
        />
        <span>{message.text}</span>
      </div>
      {message.kind !== 'loading' && (
        <button className="icon-button" aria-label="关闭提示" onClick={() => dismiss(message.id)}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
