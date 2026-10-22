/** Public site details used for metadata, structured data, and the sitemap. */

const productionHost =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://canva-room-blush.vercel.app');

export const SITE = {
  name: 'CanvaRoom',
  url: productionHost.replace(/\/$/, ''),
  title: 'CanvaRoom — Online Collaborative Whiteboard with Voice & Chat',
  description:
    'An online whiteboard for teams, classes, and study groups. Start free, draw together in real time with no lag, talk over built-in voice, chat, add pages, and start from templates.',
  keywords: [
    'online whiteboard',
    'collaborative whiteboard',
    'free whiteboard',
    'whiteboard app',
    'collab board',
    'study board',
    'online study board',
    'digital whiteboard',
    'virtual whiteboard',
    'whiteboard for teachers',
    'brainstorming board',
    'real-time whiteboard',
    'whiteboard with voice chat',
  ],
};

/** How to reach the team. */
export const CONTACT = {
  email: 'canvacollabroom@gmail.com',
};

export type Faq = { q: string; a: string };

/** How the plans read in copy. The prices match the server's plans. */
export const PLAN_COPY = {
  premium:
    'a one-time payment of $20 for 3 months, $35 for 6 months plus 15 days free, or $65 for 12 months plus a month free (in India: ₹499, ₹849 or ₹1,499), with nothing renewing on its own',
  trial:
    'Every new account gets a free trial of 30 minutes of active use (the clock only runs while CanvaRoom is open in front of you): up to two boards, with two people besides you on each, live drawing, voice, chat, and templates',
  free: 'After the trial, the free plan keeps your first board for you to use on your own',
};

export const HOME_FAQ: Faq[] = [
  {
    q: 'Is CanvaRoom free?',
    a: `${PLAN_COPY.trial}. ${PLAN_COPY.free}. Premium is ${PLAN_COPY.premium}, and adds unlimited boards and people, export, images, and HD recording. Scratch boards stay free with no sign-up.`,
  },
  {
    q: 'How can I pay for Premium?',
    a: 'Outside India you pay in US dollars with PayPal, or with a debit or credit card where PayPal offers it. In India you pay in rupees by UPI, card or netbanking. Either way it is a single payment: nothing renews on its own, and we email you a few days before Premium ends.',
  },
  {
    q: 'Do the people I invite need an account?',
    a: 'No. Share an invite link and they can join as a guest with just a name. They only need an account to create boards of their own.',
  },
  {
    q: 'Is drawing really live?',
    a: 'Yes. Strokes stream to everyone on the board while you draw, typically in under a tenth of a second, instead of appearing only when you lift the pen.',
  },
  {
    q: 'Can we talk while we draw?',
    a: 'Every board has a built-in voice room and chat, so you do not need a separate meeting app. Voice works best for groups of up to about eight people.',
  },
  {
    q: 'Can I try it without signing up?',
    a: 'Open a scratch board from the home page. It lives only in your browser tab; create an account when you want to save and share it.',
  },
  {
    q: 'Can I export my board?',
    a: 'With Premium, each page can be exported as a PNG image, an SVG, or a PDF. Scratch boards can be exported on any plan.',
  },
];

export type UseCase = {
  slug: string;
  /** Search-facing page title. */
  title: string;
  description: string;
  kicker: string;
  heading: string;
  intro: string;
  /** Short label for links from other pages. */
  label: string;
  sections: { title: string; body: string }[];
  steps: string[];
  faq: Faq[];
};

export const USE_CASES: UseCase[] = [
  {
    slug: 'online-whiteboard',
    label: 'Online whiteboard',
    title:
      'Online Whiteboard, Free to Start — Draw, Write, and Share Instantly',
    description:
      'An online whiteboard that works in your browser, free to start. Sketch, write, add sticky notes, shapes, and images, then share a link so others can draw with you live.',
    kicker: 'Online whiteboard · free to start',
    heading: 'A whiteboard that opens in your browser and fills up with ideas.',
    intro:
      'CanvaRoom is an online whiteboard with an infinite canvas, free to start. Open it in any modern browser, start drawing, and share a link when you want company. Nothing to install.',
    sections: [
      {
        title: 'Every tool you reach for',
        body: 'Pen, rectangles, ellipses, diamonds, arrows, lines, text, sticky notes, and images. Select, move, resize, restyle, undo, and redo.',
      },
      {
        title: 'Infinite canvas, multiple pages',
        body: 'Zoom from 10% to 800% and pan anywhere. When a topic needs its own space, add a page instead of crowding one board.',
      },
      {
        title: 'Share with a link',
        body: 'Send an invite link and people join in seconds as editors or viewers. You stay in control: change roles, pause editing, or revoke the link.',
      },
      {
        title: 'Keep and export your work',
        body: 'Boards save automatically. Take snapshots to roll back, and export any page as PNG, SVG, or PDF.',
      },
    ],
    steps: [
      'Create a free account, or open a scratch board with no sign-up.',
      'Pick a blank board or a template and start drawing.',
      'Share the invite link when you want others to join.',
    ],
    faq: [
      {
        q: 'Do I need to download anything?',
        a: 'No. CanvaRoom runs in Chrome, Edge, Firefox, and Safari on desktop, and works on tablets and phones too.',
      },
      {
        q: 'Is the online whiteboard free?',
        a: `Scratch boards are free with no sign-up. ${PLAN_COPY.trial}. ${PLAN_COPY.free}. Premium is ${PLAN_COPY.premium}.`,
      },
      {
        q: 'Can I add images?',
        a: 'Yes. Upload PNG, JPEG, or WebP images onto any board. Only the board’s members can open them.',
      },
    ],
  },
  {
    slug: 'collaborative-whiteboard',
    label: 'Collaborative whiteboard',
    title: 'Collaborative Whiteboard for Teams — Real-Time, with Voice',
    description:
      'A real-time collaborative whiteboard for remote and hybrid teams. See every stroke and cursor live, talk over built-in voice, and chat without leaving the board.',
    kicker: 'Collaborative whiteboard',
    heading: 'Work on one board together, as if you were in the same room.',
    intro:
      'Most whiteboards sync when you finish a stroke. CanvaRoom streams ink while it is being drawn, shows everyone’s cursor, and puts voice and chat on the board itself, so collaboration feels immediate.',
    sections: [
      {
        title: 'Live strokes and cursors',
        body: 'Watch ideas take shape as they are drawn. Named cursors show who is working where, and the pages panel shows who is on which page.',
      },
      {
        title: 'Voice and chat built in',
        body: 'Join the board’s voice room with one click, see who is speaking, and keep links and notes in chat. No separate call to set up.',
      },
      {
        title: 'Roles and control',
        body: 'Owners invite editors or viewers, can pause editing for everyone during a presentation, and can revoke an invite link at any time.',
      },
      {
        title: 'Recovers on its own',
        body: 'If someone’s connection drops, their unsent edits are kept and delivered when they reconnect, so nothing they drew is lost.',
      },
    ],
    steps: [
      'Create a board from a template such as a retro, kanban, or flowchart.',
      'Invite your team with a link; guests can join without an account.',
      'Talk it through over voice while everyone draws.',
    ],
    faq: [
      {
        q: 'How many people can collaborate at once?',
        a: 'Many people can draw on one board. Voice is peer-to-peer and works best for up to about eight people at a time.',
      },
      {
        q: 'What happens if two people edit the same thing?',
        a: 'Edits to different objects never conflict. If two people change the same object at the same moment, the last change wins.',
      },
      {
        q: 'Can I stop people from editing during a presentation?',
        a: 'Yes. The owner can pause editing so everyone can view but not change the board, then resume it later.',
      },
    ],
  },
  {
    slug: 'study-board',
    label: 'Study board',
    title: 'Online Study Board for Group Study and Revision',
    description:
      'An online study board for students. Revise together, map out topics, solve problems on a shared whiteboard, and talk over built-in voice. Start free.',
    kicker: 'Online study board',
    heading:
      'A shared study board for revising, explaining, and solving together.',
    intro:
      'Group study works best when everyone can see the same page. CanvaRoom gives your study group a shared whiteboard with voice, chat, and a page for every topic, so you can explain a problem by drawing it.',
    sections: [
      {
        title: 'A page per topic',
        body: 'Keep each chapter, subject, or problem set on its own page and jump between them from the pages panel.',
      },
      {
        title: 'Work problems out by hand',
        body: 'Write steps with the pen, sketch diagrams, and drop in a photo of a question to annotate it together.',
      },
      {
        title: 'Talk it through',
        body: 'Start a voice room on the board to explain an idea out loud while you draw it, or use chat to share links and notes.',
      },
      {
        title: 'Revision that sticks around',
        body: 'Boards save automatically. Take a snapshot before an exam and export pages as PDFs to revise from later.',
      },
    ],
    steps: [
      'Create a free board and add a page for each topic.',
      'Share the invite link with your study group.',
      'Join voice and work through problems together.',
    ],
    faq: [
      {
        q: 'Is the study board free for students?',
        a: `${PLAN_COPY.trial}. ${PLAN_COPY.free}. Premium is ${PLAN_COPY.premium}.`,
      },
      {
        q: 'Can my friends join without signing up?',
        a: 'Yes. They can join from your invite link as a guest with just a name.',
      },
      {
        q: 'Can I save my notes as a PDF?',
        a: 'Yes. Export any page as a PDF, PNG, or SVG.',
      },
    ],
  },
  {
    slug: 'whiteboard-for-teachers',
    label: 'Whiteboard for teachers',
    title: 'Online Whiteboard for Teachers and Tutors',
    description:
      'An online whiteboard for teaching and tutoring. Explain live with ink that appears instantly, talk over voice, control who can edit, and export lessons as PDFs.',
    kicker: 'Online whiteboard for teaching',
    heading: 'Teach on a whiteboard your students can see — and join.',
    intro:
      'Whether you tutor one student or teach a small class online, CanvaRoom lets you write and draw with ink that appears for everyone instantly, talk over built-in voice, and decide when students can draw too.',
    sections: [
      {
        title: 'Explain in real time',
        body: 'Your handwriting and diagrams appear for students as you draw them, so explanations keep pace with your voice.',
      },
      {
        title: 'You decide who draws',
        body: 'Invite students as viewers or editors, and pause editing for the whole board while you present.',
      },
      {
        title: 'Lessons across pages',
        body: 'Prepare a lesson as a series of pages, duplicate a page for each exercise, and move through them during class.',
      },
      {
        title: 'Hand out the board afterwards',
        body: 'Export any page as a PDF or image to share with students, or keep the board and reuse it next term.',
      },
    ],
    steps: [
      'Create a board and prepare a page for each part of the lesson.',
      'Share the invite link; students join as guests with a name.',
      'Start voice, teach, and let students draw when you are ready.',
    ],
    faq: [
      {
        q: 'Do students need accounts?',
        a: 'No. Students can join from your link with just a name.',
      },
      {
        q: 'How many students can join voice?',
        a: 'Voice works best for up to about eight people, which suits tutoring and small groups.',
      },
      {
        q: 'Can I stop students from drawing?',
        a: 'Yes. Make them viewers, or pause editing for everyone while you present.',
      },
    ],
  },
  {
    slug: 'brainstorming-board',
    label: 'Brainstorming board',
    title: 'Online Brainstorming Board with Sticky Notes',
    description:
      'An online brainstorming board with sticky notes, shapes, arrows, and templates for brainstorms, retros, kanban, and flowcharts. Brainstorm live with voice and chat.',
    kicker: 'Online brainstorming board',
    heading: 'Get every idea on the board, then make sense of them together.',
    intro:
      'Start from a brainstorm, retro, kanban, or flowchart template, fill the board with sticky notes, and group and connect ideas while you talk it through.',
    sections: [
      {
        title: 'Templates to start fast',
        body: 'Brainstorm, retrospective, kanban, and flowchart templates give your session a structure in one click.',
      },
      {
        title: 'Sticky notes, shapes, and arrows',
        body: 'Add colourful sticky notes, connect ideas with arrows, and group them with shapes. Restyle anything in a click.',
      },
      {
        title: 'Everyone at once',
        body: 'The whole team adds notes at the same time, with live cursors and voice so the conversation keeps flowing.',
      },
      {
        title: 'Snapshots of every stage',
        body: 'Save a snapshot after each round so you can look back or restore an earlier version.',
      },
    ],
    steps: [
      'Create a board from the brainstorm or retro template.',
      'Invite your team and add sticky notes together.',
      'Group, connect, and export the result.',
    ],
    faq: [
      {
        q: 'Which templates are included?',
        a: 'Blank, brainstorm, flowchart, kanban, and retrospective.',
      },
      {
        q: 'Can I export the brainstorm?',
        a: 'Yes, as a PNG, SVG, or PDF of each page.',
      },
      {
        q: 'Is it free?',
        a: `${PLAN_COPY.trial}. ${PLAN_COPY.free}. Premium is ${PLAN_COPY.premium}.`,
      },
    ],
  },
];
