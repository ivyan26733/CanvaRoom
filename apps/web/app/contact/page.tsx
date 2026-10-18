import type { Metadata } from 'next';
import Link from 'next/link';
import { FeedbackForm } from '../components/feedback';
import { Icon, Logo } from '../components/icons';
import { JsonLd, MarketingFooter } from '../components/marketing';
import { CONTACT, SITE } from '../lib/site';
import './contact.css';

const DESCRIPTION =
  'Call, email, or send feedback to the team behind CanvaRoom, the online whiteboard with live ink, voice, and chat.';

export const metadata: Metadata = {
  title: 'Contact us',
  description: DESCRIPTION,
  alternates: { canonical: '/contact' },
  openGraph: {
    title: `Contact ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/contact`,
    type: 'website',
  },
};

const contactSchema = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  name: `Contact ${SITE.name}`,
  url: `${SITE.url}/contact`,
  mainEntity: {
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    email: CONTACT.email,
    telephone: CONTACT.phone,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: CONTACT.email,
      telephone: CONTACT.phone,
    },
  },
};

export default function ContactPage() {
  return (
    <div className="mk mk-page contact">
      <JsonLd data={contactSchema} />
      <header className="mk-header">
        <Link href="/" className="mk-brand">
          <Logo size={28} /> {SITE.name}
        </Link>
        <nav className="mk-header-actions" aria-label="Account">
          <Link href="/login" className="button ghost">
            Sign in
          </Link>
          <Link href="/signup" className="button primary">
            Start free
          </Link>
        </nav>
      </header>

      <main className="contact-main">
        <section className="contact-intro" aria-labelledby="contact-heading">
          <p className="st-eyebrow">Contact us</p>
          <h1 id="contact-heading">
            Talk to the people <span>building</span> CanvaRoom.
          </h1>
          <p className="contact-lede">
            A question about Premium, a payment, a class you want to run, or a
            bug that got in the way — reach us directly. A person reads every
            message.
          </p>

          <ul className="contact-ways">
            <li>
              <span className="contact-way-label">
                <Icon name="mic" size={18} /> Phone
              </span>
              <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>
                {CONTACT.phone}
              </a>
              <small>We’re in India, on IST.</small>
            </li>
            <li>
              <span className="contact-way-label">
                <Icon name="inbox" size={18} /> Email
              </span>
              <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              <small>For payments, include your payment ID.</small>
            </li>
            <li>
              <span className="contact-way-label">
                <Icon name="help" size={18} /> Quick answers
              </span>
              <Link href="/#pricing">Plans and pricing</Link>
              <small>
                What the free trial, free plan, and Premium include.
              </small>
            </li>
          </ul>
        </section>

        <section
          className="contact-feedback"
          id="feedback"
          aria-labelledby="feedback-heading"
        >
          <p className="st-eyebrow">Feedback</p>
          <h2 id="feedback-heading">Tell us how it’s going.</h2>
          <p>
            Ideas, bugs, and praise all land in the same inbox. Leave your email
            and we’ll write back.
          </p>
          <FeedbackForm />
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
