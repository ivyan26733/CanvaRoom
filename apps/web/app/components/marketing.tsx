import Link from 'next/link';
import { HOME_FAQ, SITE, USE_CASES, type Faq } from '../lib/site';
import { Logo } from './icons';

/** Structured data for search engines. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Escapes `<` so content can never close the script element.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}

export const appSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Any (web browser)',
  browserRequirements: 'Requires JavaScript and a modern browser.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'Real-time collaborative drawing',
    'Built-in voice and chat',
    'Multiple pages per board',
    'Zoom from 10% to 800%',
    'Sticky notes, shapes, arrows, text, and images',
    'Templates for brainstorms, retros, kanban, and flowcharts',
    'Export to PNG, SVG, and PDF',
  ],
};

export const faqSchema = (faq: Faq[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
});

const FEATURES = [
  {
    title: 'Ink that streams live',
    body: 'Strokes appear for everyone while they are being drawn — not after the pen lifts.',
  },
  {
    title: 'Voice and chat on the board',
    body: 'One click joins the board’s voice room. Chat keeps links and notes beside the work.',
  },
  {
    title: 'Pages and infinite zoom',
    body: 'Give every topic its own page and zoom from a 10% overview to 800% detail.',
  },
  {
    title: 'Templates',
    body: 'Start from a brainstorm, retro, kanban, or flowchart instead of a blank page.',
  },
  {
    title: 'Invite links and roles',
    body: 'Guests join with a name. Choose editors or viewers, pause editing, or revoke a link.',
  },
  {
    title: 'Snapshots and export',
    body: 'Boards save as you go. Snapshot a version, restore it later, or export PNG, SVG, or PDF.',
  },
];

function FaqList({ faq }: { faq: Faq[] }) {
  return (
    <div className="mk-faq">
      {faq.map(({ q, a }) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-brand">
        <Link href="/" className="mk-brand">
          <Logo size={24} /> {SITE.name}
        </Link>
        <p>The free online whiteboard with live ink, voice, and chat.</p>
      </div>
      <nav aria-label="Use cases">
        <h2>Use CanvaRoom as a</h2>
        <ul>
          {USE_CASES.map((useCase) => (
            <li key={useCase.slug}>
              <Link href={`/${useCase.slug}`}>{useCase.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Get started">
        <h2>Get started</h2>
        <ul>
          <li>
            <Link href="/?mode=signup">Create a free account</Link>
          </li>
          <li>
            <Link href="/">Sign in</Link>
          </li>
        </ul>
      </nav>
      <p className="mk-copyright">
        © {new Date().getFullYear()} {SITE.name}
      </p>
    </footer>
  );
}

/** Crawlable detail below the sign-in screen on the home page. */
export function HomeContent() {
  return (
    <div className="mk">
      <section className="mk-section" aria-labelledby="features-heading">
        <p className="kicker">Why CanvaRoom</p>
        <h2 id="features-heading">
          A free online whiteboard that feels like being in the same room
        </h2>
        <p className="mk-lede">
          CanvaRoom is a collaborative whiteboard for teams, classrooms, and
          study groups. Draw together in real time, talk over built-in voice,
          and keep every topic on its own page.
        </p>
        <div className="mk-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="mk-card">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-section" aria-labelledby="uses-heading">
        <p className="kicker">Made for</p>
        <h2 id="uses-heading">One board, many ways to use it</h2>
        <div className="mk-grid">
          {USE_CASES.map((useCase) => (
            <Link
              key={useCase.slug}
              href={`/${useCase.slug}`}
              className="mk-card mk-link-card"
            >
              <h3>{useCase.label}</h3>
              <p>{useCase.description}</p>
              <span className="mk-more">Learn more →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mk-section" aria-labelledby="faq-heading">
        <p className="kicker">Questions</p>
        <h2 id="faq-heading">Frequently asked questions</h2>
        <FaqList faq={HOME_FAQ} />
      </section>
      <MarketingFooter />
    </div>
  );
}

/** A landing page for one way of using the board. */
export function UseCaseView({ slug }: { slug: string }) {
  const useCase = USE_CASES.find((item) => item.slug === slug)!;
  const others = USE_CASES.filter((item) => item.slug !== slug);
  return (
    <div className="mk mk-page">
      <header className="mk-header">
        <Link href="/" className="mk-brand">
          <Logo size={28} /> {SITE.name}
        </Link>
        <nav className="mk-header-actions" aria-label="Account">
          <Link href="/" className="button ghost">
            Sign in
          </Link>
          <Link href="/?mode=signup" className="button primary">
            Start free
          </Link>
        </nav>
      </header>

      <main>
        <section className="mk-hero">
          <p className="kicker">{useCase.kicker}</p>
          <h1>{useCase.heading}</h1>
          <p className="mk-lede">{useCase.intro}</p>
          <div className="mk-cta">
            <Link href="/?mode=signup" className="button primary">
              Create a free board
            </Link>
            <Link href="/" className="button ghost">
              Try a scratch board
            </Link>
          </div>
        </section>

        <section className="mk-section" aria-labelledby="what-heading">
          <h2 id="what-heading">What you can do</h2>
          <div className="mk-grid mk-grid-2">
            {useCase.sections.map((section) => (
              <article key={section.title} className="mk-card">
                <h3>{section.title}</h3>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mk-section" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <ol className="mk-steps">
            {useCase.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="mk-section" aria-labelledby="faq-heading">
          <h2 id="faq-heading">Questions</h2>
          <FaqList faq={useCase.faq} />
        </section>

        <section className="mk-section" aria-labelledby="more-heading">
          <h2 id="more-heading">More ways to use CanvaRoom</h2>
          <div className="mk-grid">
            {others.map((item) => (
              <Link
                key={item.slug}
                href={`/${item.slug}`}
                className="mk-card mk-link-card"
              >
                <h3>{item.label}</h3>
                <p>{item.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
