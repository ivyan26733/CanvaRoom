import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import type { ChatMessage } from '../../lib/api';

const TYPING_EVERY_MS = 2_500;

export function ChatPanel({
  messages,
  selfUserId,
  onlineCount,
  typing,
  disabled,
  onSend,
  onTyping,
  onClose,
}: {
  messages: ChatMessage[];
  selfUserId: string;
  onlineCount: number;
  typing: string[];
  disabled: boolean;
  onSend: (text: string) => void;
  onTyping: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const stickToBottom = useRef(true);

  useEffect(() => input.current?.focus(), []);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && stickToBottom.current)
      element.scrollTop = element.scrollHeight;
  }, [messages, typing]);

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
    stickToBottom.current = true;
  }

  return (
    <aside className="chat-panel" aria-label="Room chat">
      <div className="chat-header">
        <div>
          <h2>Room chat</h2>
          <p className="chat-presence">
            <span className="status-dot live" />
            {onlineCount} {onlineCount === 1 ? 'person' : 'people'} here
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close chat"
        >
          <Icon name="close" />
        </button>
      </div>
      <div
        className="chat-messages"
        ref={list}
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            40;
        }}
      >
        {messages.length ? (
          messages.map((message, index) => {
            const mine = message.userId === selfUserId;
            const grouped =
              messages[index - 1]?.userId === message.userId &&
              Date.parse(message.createdAt) -
                Date.parse(messages[index - 1]!.createdAt) <
                120_000;
            return (
              <article
                className={`chat-message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${message.pending ? 'pending' : ''}`}
                key={message.id}
              >
                {!grouped && (
                  <div className="message-meta">
                    <strong>{mine ? 'You' : message.name}</strong>
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                )}
                <p>{message.text}</p>
              </article>
            );
          })
        ) : (
          <div className="chat-empty">
            <span className="chat-empty-icon">
              <Icon name="chat" size={22} />
            </span>
            <p>Good thinking happens out loud.</p>
            <small>Start the conversation with your group.</small>
          </div>
        )}
        {typing.length > 0 && (
          <div className="typing-indicator">
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typing.length === 1
              ? `${typing[0]} is typing…`
              : `${typing.slice(0, 2).join(' and ')} are typing…`}
          </div>
        )}
      </div>
      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const now = Date.now();
            if (
              event.target.value &&
              now - lastTyping.current > TYPING_EVERY_MS
            ) {
              lastTyping.current = now;
              onTyping();
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? 'Reconnecting…' : 'Write a message…'}
          aria-label="Message"
          maxLength={2000}
          rows={1}
        />
        <button
          className="send-message"
          aria-label="Send message"
          disabled={!draft.trim() || disabled}
        >
          <Icon name="share" size={17} strokeWidth={2.2} />
        </button>
      </form>
      <div className="chat-footer-note">
        Enter to send · Shift+Enter for a new line
      </div>
    </aside>
  );
}
