import { StoryCta } from './plan-cta';
import {
  DropArt,
  JuggleArt,
  LagArt,
  LandArt,
  LiveArt,
  OnePenArt,
  OutcomeArt,
  RecoverArt,
  SearchArt,
} from './story-art';
import './story.css';

type Chapter = {
  time: string;
  title: string;
  body: string;
  /** A line of what Sam is thinking at that moment. */
  thought: string;
  Art: () => React.JSX.Element;
};

type Act = { id: string; label: string; name: string; chapters: Chapter[] };

const ACTS: Act[] = [
  {
    id: 'problem',
    label: 'Act I',
    name: 'The problem',
    chapters: [
      {
        time: 'Tuesday, 7:00 pm',
        title: 'The class starts, and the drawing doesn’t',
        body: 'Sam tutors maths online. They draw a triangle to explain area, but on the students’ screens it arrives seconds later, a piece at a time. By the time the line shows up, Sam has already moved on.',
        thought: '“Can everyone see this?” — for the fourth time.',
        Art: LagArt,
      },
      {
        time: '7:12 pm',
        title: 'Three apps for one lesson',
        body: 'Voice is in a video call, the board is in tab seven, questions land in a chat somewhere else. Sam spends the class switching windows, and the students spend it finding where the lesson went.',
        thought: 'Half the lesson is spent managing the lesson.',
        Art: JuggleArt,
      },
      {
        time: '7:25 pm',
        title: 'Only one person holds the pen',
        body: 'A student wants to try the next step on the board. On a screen share they can only watch, so the class turns into a broadcast. Nobody can point, sketch an answer, or work a problem together.',
        thought: '“Can I try?” “…just tell me and I’ll draw it.”',
        Art: OnePenArt,
      },
      {
        time: '7:40 pm',
        title: 'The Wi-Fi drops',
        body: 'Sam’s connection blinks for a moment. When it comes back, the last ten minutes of working on the board are gone, and everyone has to rejoin the call.',
        thought: 'There has to be something better than this.',
        Art: DropArt,
      },
    ],
  },
  {
    id: 'search',
    label: 'Act II',
    name: 'The search',
    chapters: [
      {
        time: '11:30 pm',
        title: 'Looking for a board built for live classes',
        body: 'That night Sam searches for a whiteboard with voice for online classes — something where the drawing, the talking, and the questions live in one place, and where students can draw too.',
        thought: 'Free, in the browser, and nothing to install. Please.',
        Art: SearchArt,
      },
      {
        time: '11:32 pm',
        title: 'Landing on CanvaRoom',
        body: 'Two minutes later Sam has a board for next week’s lesson. Students won’t need to download anything or make an account: they open one invite link and join as a guest with their name.',
        thought: 'That was… it?',
        Art: LandArt,
      },
    ],
  },
  {
    id: 'fix',
    label: 'Act III',
    name: 'The class that works',
    chapters: [
      {
        time: 'Next Tuesday, 7:00 pm',
        title: 'Everyone draws, live, in one room',
        body: 'Sam draws and every student sees the line as it’s being drawn — around 85 ms in our hour-long tests. Voice and chat sit on the same board, students sketch their own answers, and each topic gets its own page to zoom in and out of.',
        thought: '“Ohh, now I get it.”',
        Art: LiveArt,
      },
      {
        time: '7:40 pm',
        title: 'The Wi-Fi drops again. Nothing is lost.',
        body: 'Sam’s connection blinks, just like last week. CanvaRoom reconnects by itself and catches up, every stroke is still there, and the call keeps going because voice runs directly between the people in it.',
        thought: 'Nobody even noticed.',
        Art: RecoverArt,
      },
      {
        time: '8:00 pm',
        title: 'A board full of everyone’s thinking',
        body: 'The class ends with a page covered in the students’ own work. Sam saves a snapshot to look back on, exports the page as a PDF for the students, and starts next week’s board from where this one left off.',
        thought: 'Same students. Same Wi-Fi. A completely different class.',
        Art: OutcomeArt,
      },
    ],
  },
];

/** The home page story: one tutor’s class, before and after CanvaRoom. */
export function Story() {
  let index = 0;
  return (
    <section className="st" id="features" aria-labelledby="story-heading">
      <header className="st-intro">
        <p className="st-eyebrow">A story in three acts</p>
        <h2 id="story-heading">
          Why tutors, students, and teams switch to a{' '}
          <span>live collaborative whiteboard</span>
        </h2>
        <p className="st-intro-text">
          Every online class has the same three villains: lag, too many apps,
          and a board only one person can draw on. Here’s one evening of it —
          and the week after.
        </p>
      </header>

      <div className="st-timeline">
        {ACTS.map((act) => (
          <div key={act.id} className={`st-act st-act-${act.id}`}>
            <p className="st-act-label">
              <span>{act.label}</span> {act.name}
            </p>
            <ol className="st-chapters">
              {act.chapters.map((chapter) => {
                const side = index++ % 2 ? 'right' : 'left';
                const { Art } = chapter;
                return (
                  <li key={chapter.title} className={`st-chapter ${side}`}>
                    <span className="st-node" aria-hidden="true" />
                    <div className="st-copy">
                      <p className="st-time">{chapter.time}</p>
                      <h3>{chapter.title}</h3>
                      <p>{chapter.body}</p>
                      <p className="st-thought">{chapter.thought}</p>
                    </div>
                    <div className="st-figure">
                      <Art />
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <div className="st-finale">
        <div>
          <p className="st-eyebrow">Your turn</p>
          <h2>Your next class can start in thirty seconds.</h2>
          <p>
            Free to start. Nothing to install. Invite with one link, draw
            together live, and talk without leaving the board.
          </p>
        </div>
        <StoryCta />
      </div>
    </section>
  );
}
