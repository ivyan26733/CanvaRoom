import { ImageResponse } from 'next/og';

export const alt =
  'Avenor — free online collaborative whiteboard with voice and chat';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The preview shown when an Avenor link is shared. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        color: '#f1eee7',
        background: '#121211',
        backgroundImage:
          'radial-gradient(ellipse at 85% 0%, rgba(255,79,31,0.28), transparent 55%)',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="56" height="56" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="9" fill="#ff4f1f" />
          <path
            d="M8 21.5c2.2-6.4 4.7-9.6 7.4-9.6 3.6 0 1.4 8.2 4.6 8.2 1.6 0 3-2 4-5.6"
            fill="none"
            stroke="#fff"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="24.2" cy="9.6" r="2.2" fill="#fff" />
        </svg>
        <span style={{ fontSize: 40, fontWeight: 700 }}>Avenor</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 30, color: '#8c887f', marginBottom: 18 }}>
          Where ideas move forward.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 96,
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: -3,
          }}
        >
          <span>Think out loud,</span>
          <span style={{ color: '#ff4f1f' }}>together.</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 40, fontSize: 26, color: '#a19d94' }}>
        <span>Live strokes</span>
        <span>Built-in voice</span>
        <span>Pages &amp; zoom</span>
        <span>Templates</span>
      </div>
    </div>,
    size,
  );
}
