import type { Peer } from '../../lib/api';
import type { CallState } from '../../lib/audio';

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {off && (
        <path
          d="M4 4l16 16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function CallControls({
  call,
  peers,
  selfPeerId,
  disabled,
  onJoin,
  onLeave,
  onToggleMute,
}: {
  call: CallState;
  peers: Peer[];
  selfPeerId: string;
  disabled: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
}) {
  const inCall = peers.filter((peer) => peer.inCall);
  const others = inCall.filter((peer) => peer.peerId !== selfPeerId);

  if (!call.joined)
    return (
      <button
        className={`call-button ${others.length ? 'call-live' : ''}`}
        onClick={onJoin}
        disabled={disabled || call.joining}
        title="Join the voice call for this board"
      >
        <MicIcon />
        <span className="call-label">
          {call.joining
            ? 'Connecting…'
            : others.length
              ? `Join audio · ${others.length}`
              : 'Start audio'}
        </span>
        {others.length > 0 && (
          <span className="live-pulse" aria-hidden="true" />
        )}
      </button>
    );

  return (
    <div className="call-bar" role="group" aria-label="Voice call">
      {call.needsTap && (
        // Any tap retries playback; this button just gives one a target.
        <button className="call-tap" title="Your browser paused the call audio">
          Tap to hear the call
        </button>
      )}
      {call.micPaused && !call.muted && (
        <span
          className="call-paused"
          title="Your device paused the microphone, for example during a phone call. It resumes on its own."
        >
          Mic paused
        </span>
      )}
      <div className="call-people">
        {inCall.slice(0, 5).map((peer) => {
          const self = peer.peerId === selfPeerId;
          const speaking = call.speaking.has(peer.peerId);
          const connecting = !self && !call.connected.has(peer.peerId);
          return (
            <span
              key={peer.peerId}
              className={`call-person ${speaking ? 'speaking' : ''} ${connecting ? 'connecting' : ''}`}
              style={{ background: peer.color }}
              title={`${self ? 'You' : peer.name}${peer.muted ? ' · muted' : ''}${connecting ? ' · connecting' : ''}`}
            >
              {peer.name[0]?.toUpperCase()}
              {peer.muted && (
                <span className="call-muted" aria-label="muted">
                  <MicIcon off />
                </span>
              )}
            </span>
          );
        })}
        {inCall.length > 5 && (
          <span className="call-person more">+{inCall.length - 5}</span>
        )}
      </div>
      <button
        className={`call-icon ${call.muted ? 'is-muted' : ''}`}
        onClick={onToggleMute}
        aria-pressed={call.muted}
        aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
        title={call.muted ? 'Unmute · M' : 'Mute · M'}
      >
        <MicIcon off={call.muted} />
      </button>
      <button className="call-leave" onClick={onLeave} title="Leave audio">
        Leave
      </button>
    </div>
  );
}
