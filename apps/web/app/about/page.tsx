import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '../components/icons';
import { JsonLd, MarketingFooter } from '../components/marketing';
import { SITE } from '../lib/site';
import { FounderPortrait } from './founder-portraits';
import './about.css';

const DESCRIPTION =
  'CanvaRoom was founded by Divyansh Singh and Karambir Singh to end lag and app-juggling in online classes, with a whiteboard where ink, voice, and chat share one live room.';

export const metadata: Metadata = {
  title: 'About us — the founders of CanvaRoom',
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    title: `About ${SITE.name}`,
    description: DESCRIPTION,
    url: `${SITE.url}/about`,
    type: 'website',
  },
};

const FOUNDERS = [
  {
    who: 'divyansh' as const,
    name: 'Divyansh Singh',
    role: 'Founder',
    headline: 'Backend software engineer, Tata Consultancy Services',
    linkedin: 'https://www.linkedin.com/in/ivyansingh/',
    bio: [
      'Divyansh builds production Java and Spring Boot microservices for global enterprise clients at TCS, where he works on authentication and authorization with Spring Security, large Java upgrades, and event-driven pipelines on Kafka. He also builds AI agents that automate testing, code review, and security analysis.',
      'Outside work he has shipped NexFlow, a workflow automation platform running 100+ executions a minute, and LearnSphere, a microservices learning platform. He studied Mechanical Engineering with a Computer Science specialization at Dayalbagh Educational Institute, and leads the engineering behind CanvaRoom’s real-time sync, voice, and storage.',
    ],
    skills: [
      'Real-time systems',
      'Java & Spring Boot',
      'Microservices',
      'Kafka & Redis',
      'AI agents',
    ],
  },
  {
    who: 'karambir' as const,
    name: 'Karambir Singh',
    role: 'Founder',
    headline: 'Head of Bid Management – India, Siemens Energy',
    linkedin: 'https://www.linkedin.com/in/karambir-singh-728b602b/',
    bio: [
      'Karambir leads bid management for Siemens Energy in India. His engineering career spans research and development on electrolyzers, fuel cells, and hydrogen–natural gas blending systems, and commissioning those systems on site.',
      'As an Innovation Head Coach and Scrum Master he has guided teams from an idea to a working product. He brings that discipline to CanvaRoom: understanding what students and teachers actually need, and shipping it in small, tested steps.',
    ],
    skills: [
      'Bid management',
      'Innovation coaching',
      'Hydrogen & fuel-cell R&D',
      'Scrum',
      'Site commissioning',
    ],
  },
];

const PROBLEMS = [
  {
    title: 'Lag kills the explanation',
    body: 'On most tools a diagram appears only after the pen lifts — or seconds later on a slow connection. By then the teacher has moved on.',
  },
  {
    title: 'Too many apps at once',
    body: 'A video call for voice, a whiteboard in another tab, a chat somewhere else. Students spend the class switching windows instead of learning.',
  },
  {
    title: 'Students only watch',
    body: 'Screen-shared boards turn a class into a broadcast. Nobody can point, sketch an answer, or work a problem together.',
  },
];

const ANSWERS = [
  {
    title: 'Ink that streams live',
    body: 'Every stroke is sent while it is being drawn, so a whole class sees the same line at the same moment.',
  },
  {
    title: 'Voice and chat built in',
    body: 'Talk, type, and draw in one place. No second app, no extra link, no “can you hear me?”.',
  },
  {
    title: 'Everyone can draw',
    body: 'Invite students with a link and give them a pen — or keep them as viewers and pause editing when you need focus.',
  },
  {
    title: 'A page for every topic',
    body: 'Split a lesson into pages, zoom from an overview to fine detail, and snapshot the board to revisit after class.',
  },
  {
    title: 'Survives bad Wi-Fi',
    body: 'If a connection drops, CanvaRoom reconnects on its own and catches up — no lost work and no rejoining the call.',
  },
  {
    title: 'Free to start',
    body: 'Open a board in seconds from any browser. Guests join with just a name, no download and no install.',
  },
];

const aboutSchema = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url: `${SITE.url}/about`,
  name: `About ${SITE.name}`,
  description: DESCRIPTION,
  mainEntity: {
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/icon.svg`,
    founder: FOUNDERS.map((founder) => ({
      '@type': 'Person',
      name: founder.name,
      jobTitle: founder.role,
      description: founder.headline,
      knowsAbout: founder.skills,
      sameAs: [founder.linkedin],
    })),
  },
};

export default function AboutPage() {
  return (
    <div className="mk mk-page about">
      <JsonLd data={aboutSchema} />
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
        <section className="about-hero">
          <p className="kicker">About us</p>
          <h1>
            We built the online classroom
            <br />
            <span className="about-mark">we wished we had.</span>
          </h1>
          <p className="about-lede">
            {SITE.name} started with a simple frustration. Online classes were
            supposed to bring people together, but the tools kept getting in the
            way — laggy whiteboards, scattered apps, and students who could only
            watch. We set out to make learning together online feel as natural
            as standing at the same board.
          </p>
        </section>

        <section className="about-section" aria-labelledby="gap-heading">
          <p className="kicker">The gap we found</p>
          <h2 id="gap-heading">
            Collaborating in an online class was a hustle
          </h2>
          <p className="about-text">
            In online lectures and group study sessions, we kept seeing the same
            thing: the teacher would start explaining on a shared board, the
            drawing would stutter or lag behind their voice, and half the class
            would lose the thread. Working on a problem together meant juggling
            a call, a whiteboard, and a chat — and only one person could really
            hold the pen.
          </p>
          <div className="about-grid three">
            {PROBLEMS.map((item) => (
              <article key={item.title} className="about-card problem">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section" aria-labelledby="answer-heading">
          <p className="kicker">What we built</p>
          <h2 id="answer-heading">
            One live room for drawing, talking, and thinking together
          </h2>
          <p className="about-text">
            So we built {SITE.name}: a collaborative whiteboard designed from
            day one for real-time learning. Ink, voice, and chat share a single
            live connection, so what you see, hear, and read always stays in
            sync — for a study group of three or a whole class.
          </p>
          <div className="about-grid">
            {ANSWERS.map((item) => (
              <article key={item.title} className="about-card">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section" aria-labelledby="founders-heading">
          <p className="kicker">The founders</p>
          <h2 id="founders-heading">The people behind {SITE.name}</h2>
          <div className="founders">
            {FOUNDERS.map((founder) => (
              <article key={founder.name} className="founder">
                <FounderPortrait
                  who={founder.who}
                  title={`Illustrated portrait of ${founder.name}`}
                />
                <div className="founder-body">
                  <h3>{founder.name}</h3>
                  <p className="founder-role">
                    {founder.role}, {SITE.name}
                    <span className="founder-headline">{founder.headline}</span>
                  </p>
                  {founder.bio.map((paragraph) => (
                    <p key={paragraph.slice(0, 24)}>{paragraph}</p>
                  ))}
                  <ul className="founder-skills" aria-label="Expertise">
                    {founder.skills.map((skill) => (
                      <li key={skill}>{skill}</li>
                    ))}
                  </ul>
                  <a
                    className="founder-link"
                    href={founder.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Connect on LinkedIn ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section about-mission">
          <p className="kicker">Our mission</p>
          <blockquote>
            Make learning together online feel like being in the same room — for
            every student, on every connection.
          </blockquote>
          <div className="about-cta">
            <Link href="/?mode=signup" className="button primary">
              Start a free board
            </Link>
            <Link href="/" className="button ghost">
              Sign in
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
