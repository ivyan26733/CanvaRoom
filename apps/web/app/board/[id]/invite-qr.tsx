import { useMemo } from 'react';
import QRCode from 'qrcode';
import { Icon } from '../../components/icons';

/** Dark modules as one SVG path, so the code stays crisp at any size. */
function qrPath(link: string) {
  const { modules } = QRCode.create(link, { errorCorrectionLevel: 'M' });
  let d = '';
  for (let row = 0; row < modules.size; row++)
    for (let col = 0; col < modules.size; col++)
      if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
  return { d, size: modules.size };
}

async function downloadQr(link: string, title: string) {
  const url = await QRCode.toDataURL(link, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1024,
    color: { dark: '#141414', light: '#ffffff' },
  });
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'board';
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `canvaroom-invite-${slug}.png`;
  anchor.click();
}

/** A scannable copy of the invite link, for joining from a phone. */
export function InviteQr({ link, title }: { link: string; title: string }) {
  const { d, size } = useMemo(() => qrPath(link), [link]);
  const quiet = 2;
  return (
    <div className="invite-qr">
      <svg
        className="invite-qr-code"
        viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
        role="img"
        aria-label="QR code for the invite link"
        shapeRendering="crispEdges"
      >
        <rect
          x={-quiet}
          y={-quiet}
          width={size + quiet * 2}
          height={size + quiet * 2}
          fill="#ffffff"
        />
        <path d={d} fill="#141414" />
      </svg>
      <div className="invite-qr-copy">
        <h3>Scan to join</h3>
        <p>
          Point a phone camera at the code to open this board. Put it on a slide
          or print it for a class.
        </p>
        <button
          className="button ghost small"
          onClick={() => void downloadQr(link, title)}
        >
          <Icon name="download" size={16} /> Download QR
        </button>
      </div>
    </div>
  );
}
