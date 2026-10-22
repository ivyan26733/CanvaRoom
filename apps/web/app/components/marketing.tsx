import Link from 'next/link';
import { FooterAccountLinks } from './plan-cta';
import { SiteHeader } from './site-header';
import { HOME_FAQ, SITE, USE_CASES, type Faq } from '../lib/site';
import { Logo } from './icons';
import { decimal, PRICE } from '../lib/pricing';
import { Pricing } from './pricing';
import { Story } from './story';

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
  offers: [
    {
      '@type': 'Offer',
      name: 'Free plan, with a trial of 30 minutes of active use',
      price: '0',
      priceCurrency: 'USD',
    },
    {
      '@type': 'Offer',
      name: 'CanvaRoom Premium, monthly',
      price: decimal(PRICE.amount),
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: decimal(PRICE.amount),
        priceCurrency: 'USD',
        unitCode: 'MON',
        referenceQuantity: {
          '@type': 'QuantitativeValue',
          value: 1,
          unitCode: 'MON',
        },
      },
    },
  ],
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
        <p>
          The online whiteboard with live ink, voice, and chat. Free to start.
        </p>
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
          <FooterAccountLinks />
          <li>
            <a href="/#pricing">Pricing</a>
          </li>
        </ul>
      </nav>
      <nav aria-label="Company">
        <h2>Company</h2>
        <ul>
          <li>
            <Link href="/about">About us</Link>
          </li>
          <li>
            <Link href="/contact">Contact us</Link>
          </li>
          <li>
            <Link href="/contact#feedback">Send feedback</Link>
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
    <div className="mk mk-home">
      <Story />
      <Pricing />

      <section
        className="mk-uses"
        id="use-cases"
        aria-labelledby="uses-heading"
      >
        <h2 id="uses-heading">One board, many rooms:</h2>
        <ul>
          {USE_CASES.map((useCase) => (
            <li key={useCase.slug}>
              <Link href={`/${useCase.slug}`}>
                {useCase.label}
                <span aria-hidden="true">↗</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mk-qa" id="faq" aria-labelledby="faq-heading">
        <div className="mk-qa-head">
          <p className="st-eyebrow">Questions</p>
          <h2 id="faq-heading">Frequently asked questions</h2>
          <p>
            Still deciding? Open a scratch board from the top of this page — no
            account needed.
          </p>
        </div>
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
      <SiteHeader />

      <main>
        <section className="mk-hero">
          <p className="kicker">{useCase.kicker}</p>
          <h1>{useCase.heading}</h1>
          <p className="mk-lede">{useCase.intro}</p>
          <div className="mk-cta">
            <Link href="/signup" className="button primary">
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
