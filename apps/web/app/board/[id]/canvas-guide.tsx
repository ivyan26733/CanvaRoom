import { Icon, type IconName } from '../../components/icons';

type ToolInfo = { tool: string; icon: IconName; label: string; key?: string };

const GROUPS: { title: string; tools: string[] }[] = [
  { title: 'Draw', tools: ['pen', 'highlighter', 'eraser'] },
  { title: 'Shapes', tools: ['rect', 'ellipse', 'diamond', 'line', 'arrow'] },
  { title: 'Notes', tools: ['text', 'sticky'] },
  { title: 'Move', tools: ['select', 'hand'] },
];

/**
 * A faint, non-interactive watermark on an empty page that lists what the
 * canvas can do. It fades out the moment someone starts to draw.
 */
export function CanvasGuide({
  tools,
  hidden,
  isLocal,
  canShare,
}: {
  tools: ToolInfo[];
  hidden: boolean;
  isLocal: boolean;
  canShare: boolean;
}) {
  const byTool = new Map(tools.map((item) => [item.tool, item]));
  const features: { icon: IconName; title: string; body: string }[] = [
    {
      icon: 'pages',
      title: 'Pages',
      body: 'Top left · Page Up / Page Down to flip',
    },
    {
      icon: 'fit',
      title: 'Zoom',
      body: 'Ctrl/⌘ + scroll or pinch · Shift 1 to fit',
    },
    ...(isLocal
      ? []
      : [
          {
            icon: 'mic' as const,
            title: 'Voice & chat',
            body: 'Top right · press M to mute',
          },
        ]),
    ...(canShare
      ? [
          {
            icon: 'share' as const,
            title: 'Invite',
            body: 'Share link or QR code',
          },
        ]
      : []),
    {
      icon: 'download',
      title: 'Export',
      body: isLocal ? 'PNG, SVG, PDF in ⋯' : 'PNG, SVG, PDF and versions in ⋯',
    },
    { icon: 'keyboard', title: 'Shortcuts', body: 'Press ? for the full list' },
  ];

  return (
    <div
      className={`canvas-guide ${hidden ? 'is-hidden' : ''}`}
      aria-hidden={hidden}
    >
      <p className="canvas-guide-kicker">Your canvas is ready</p>
      <h2 className="canvas-guide-title">Pick a tool and start anywhere.</h2>

      <div className="canvas-guide-tools">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.tools.map((tool) => {
                const item = byTool.get(tool);
                if (!item) return null;
                return (
                  <li key={tool}>
                    <Icon name={item.icon} size={16} />
                    <span>{item.label}</span>
                    {item.key && <kbd>{item.key}</kbd>}
                  </li>
                );
              })}
              {group.title === 'Notes' && (
                <li>
                  <Icon name="image" size={16} />
                  <span>Image</span>
                </li>
              )}
              {group.title === 'Move' && (
                <li>
                  <Icon name="hand" size={16} />
                  <span>Pan</span>
                  <kbd>Space</kbd>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>

      <ul className="canvas-guide-features">
        {features.map((feature) => (
          <li key={feature.title}>
            <Icon name={feature.icon} size={16} />
            <span>
              <b>{feature.title}</b> {feature.body}
            </span>
          </li>
        ))}
      </ul>

      <p className="canvas-guide-foot">
        {isLocal
          ? 'Scratch boards live only in this tab. This guide fades when you draw.'
          : 'Everyone here sees each stroke live. This guide fades when you draw.'}
      </p>
    </div>
  );
}
