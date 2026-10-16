import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ff4f1f',
      }}
    >
      <svg width="132" height="132" viewBox="0 0 32 32">
        <path
          d="M8 21.5c2.2-6.4 4.7-9.6 7.4-9.6 3.6 0 1.4 8.2 4.6 8.2 1.6 0 3-2 4-5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="24.2" cy="9.6" r="2.2" fill="#fff" />
      </svg>
    </div>,
    size,
  );
}
