import type { Metadata } from 'next';
import { MarketingFooter } from '../components/marketing';
import { SiteHeader } from '../components/site-header';
import { SITE } from '../lib/site';
import { StatusList } from './status-list';
import './status.css';

const DESCRIPTION =
  'Planned maintenance, downtime and repairs for CanvaRoom, and anything else the team wants you to know.';

export const metadata: Metadata = {
  title: 'Status',
  description: DESCRIPTION,
  alternates: { canonical: '/status' },
  openGraph: {
    title: `${SITE.name} status`,
    description: DESCRIPTION,
    url: `${SITE.url}/status`,
    type: 'website',
  },
};

export default function StatusPage() {
  return (
    <div className="mk mk-page status">
      <SiteHeader />
      <main className="status-main">
        <section className="status-intro" aria-labelledby="status-heading">
          <p className="st-eyebrow">Status</p>
          <h1 id="status-heading">What’s happening with CanvaRoom</h1>
          <p className="status-lede">
            Before planned maintenance or any work that could interrupt your
            boards, we post it here, and as a banner across the site. Times are
            shown in your own time zone.
          </p>
        </section>
        <StatusList />
      </main>
      <MarketingFooter />
    </div>
  );
}
