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

const STATS = [
  {
    value: '~85 ms',
    label: 'median delay for a live stroke in our hour-long test',
  },
  { value: '1 link', label: 'to bring a whole class onto the same board' },
  { value: '0 installs', label: 'works in any modern browser, on any device' },
];

/** A small sketch of a live board, standing in for a hero photo. */
function BoardSketch() {
  return (
    <svg
      className="about-sketch"
      viewBox="0 0 520 420"
      role="img"
      aria-label="Sketch of a shared board with two people drawing at once"
    >
      <defs>
        <pattern
          id="sketch-grid"
          width="26"
          height="26"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="1.4" fill="currentColor" opacity="0.18" />
        </pattern>
      </defs>
      <rect
        x="8"
        y="8"
        width="504"
        height="404"
        rx="28"
        className="about-sketch-paper"
      />
      <rect
        x="8"
        y="8"
        width="504"
        height="404"
        rx="28"
        fill="url(#sketch-grid)"
      />
      {/* A worked problem: triangle, labels, and an arrow to a note. */}
      <path
        d="M80 300 L220 120 L300 300 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M220 300 L220 120"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="8 8"
      />
      <path
        d="M220 284 l16 0 l0 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <text x="140" y="330" className="about-sketch-hand">
        a = 6
      </text>
      <text x="230" y="214" className="about-sketch-hand">
        h
      </text>
      <path
        d="M318 200 C350 176 370 168 396 168"
        fill="none"
        stroke="#ff6b3d"
        strokeWidth="5"
        strokeLinecap="round"
        className="about-sketch-live"
      />
      <path
        d="M384 156 L400 168 L384 180"
        fill="none"
        stroke="#ff6b3d"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="rotate(4 430 120)">
        <rect x="372" y="62" width="122" height="104" rx="8" fill="#ffe066" />
        <text x="386" y="98" className="about-sketch-note">
          Area =
        </text>
        <text x="386" y="128" className="about-sketch-note">
          ½ × a × h
        </text>
      </g>
      <g transform="translate(300 300)">
        <path
          d="M0 0 L0 22 L6 16 L10 26 L14 24 L10 14 L18 14 Z"
          fill="#3b5bdb"
          stroke="#fff"
          strokeWidth="2"
        />
        <rect x="16" y="22" width="84" height="24" rx="12" fill="#3b5bdb" />
        <text x="58" y="38.5" textAnchor="middle" className="about-sketch-tag">
          Divyansh
        </text>
      </g>
      <g transform="translate(392 176)">
        <path
          d="M0 0 L0 22 L6 16 L10 26 L14 24 L10 14 L18 14 Z"
          fill="#e8590c"
          stroke="#fff"
          strokeWidth="2"
        />
        <rect x="16" y="22" width="84" height="24" rx="12" fill="#e8590c" />
        <text x="58" y="38.5" textAnchor="middle" className="about-sketch-tag">
          Karambir
        </text>
      </g>
      <g className="about-sketch-voice" transform="translate(40 40)">
        <rect width="150" height="40" rx="20" />
        <circle cx="22" cy="20" r="7" fill="#2f9e44" />
        <text x="40" y="25.5">
          2 in voice
        </text>
      </g>
    </svg>
  );
}

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
          <div className="about-hero-copy">
            <p className="about-eyebrow">
              <span>About us</span> Built for live learning
            </p>
            <h1>
              We built the online classroom{' '}
              <span className="about-mark">we wished we had.</span>
            </h1>
            <p className="about-lede">
              {SITE.name} started with a simple frustration. Online classes were
              supposed to bring people together, but the tools kept getting in
              the way — laggy whiteboards, scattered apps, and students who
              could only watch. We set out to make learning together online feel
              as natural as standing at the same board.
            </p>
          </div>
          <BoardSketch />
        </section>

        <dl className="about-stats">
          {STATS.map((stat) => (
            <div key={stat.value}>
              <dt>{stat.value}</dt>
              <dd>{stat.label}</dd>
            </div>
          ))}
        </dl>

        <section className="about-split" aria-labelledby="gap-heading">
          <div className="about-split-head">
            <p className="about-eyebrow">
              <span>01</span> The gap we found
            </p>
            <h2 id="gap-heading">
              Collaborating in an online class was a hustle.
            </h2>
            <p className="about-text">
              In online lectures and group study sessions, we kept seeing the
              same thing: the teacher would start explaining on a shared board,
              the drawing would stutter or lag behind their voice, and half the
              class would lose the thread. Working on a problem together meant
              juggling a call, a whiteboard, and a chat — and only one person
              could really hold the pen.
            </p>
          </div>
          <ol className="about-problems">
            {PROBLEMS.map((item, index) => (
              <li key={item.title}>
                <span className="about-problem-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="about-built" aria-labelledby="answer-heading">
          <div className="about-built-head">
            <p className="about-eyebrow">
              <span>02</span> What we built
            </p>
            <h2 id="answer-heading">
              One live room for drawing, talking, and thinking together.
            </h2>
            <p className="about-text">
              So we built {SITE.name}: a collaborative whiteboard designed from
              day one for real-time learning. Ink, voice, and chat share a
              single live connection, so what you see, hear, and read always
              stays in sync — for a study group of three or a whole class.
            </p>
          </div>
          <div className="about-bento">
            {ANSWERS.map((item) => (
              <article key={item.title} className="about-tile">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-founders" aria-labelledby="founders-heading">
          <div className="about-founders-head">
            <p className="about-eyebrow">
              <span>03</span> The founders
            </p>
            <h2 id="founders-heading">The people behind {SITE.name}.</h2>
          </div>
          {FOUNDERS.map((founder) => (
            <article key={founder.name} className="founder">
              <figure className="founder-frame">
                <FounderPortrait
                  who={founder.who}
                  title={`Illustrated portrait of ${founder.name}`}
                />
                <figcaption>{founder.name.split(' ')[0]}</figcaption>
              </figure>
              <div className="founder-body">
                <p className="founder-role">
                  {founder.role}, {SITE.name}
                </p>
                <h3>{founder.name}</h3>
                <p className="founder-headline">{founder.headline}</p>
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
                  Connect on LinkedIn <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </section>

        <section className="about-mission" aria-labelledby="mission-heading">
          <p className="about-eyebrow" id="mission-heading">
            <span>04</span> Our mission
          </p>
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
