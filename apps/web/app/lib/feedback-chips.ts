/**
 * The one-tap answers in the feedback prompt, and how the admin console
 * labels them. IDs are stored; labels can be reworded freely.
 */

export type Chip = { id: string; label: string; emoji: string };

/** Shown after a rating of 1 to 3. */
export const PROBLEM_CHIPS: Chip[] = [
  { id: 'lag', label: 'Lag while drawing', emoji: '🐢' },
  { id: 'network', label: 'Connection drops', emoji: '📶' },
  { id: 'slow_load', label: 'Slow to load', emoji: '⏳' },
  { id: 'hard_to_use', label: 'Hard to find things', emoji: '🧭' },
  { id: 'voice', label: 'Voice or call issues', emoji: '🎧' },
  { id: 'mobile', label: 'Awkward on phone or tablet', emoji: '📱' },
  { id: 'bug', label: 'Something broke', emoji: '🐞' },
  { id: 'price', label: 'Too expensive', emoji: '💸' },
];

/** Shown after a rating of 4 or 5. */
export const PRAISE_CHIPS: Chip[] = [
  { id: 'smooth', label: 'Smooth and fast', emoji: '⚡' },
  { id: 'easy', label: 'Easy to use', emoji: '👌' },
  { id: 'teaching', label: 'Great for teaching', emoji: '🎓' },
  { id: 'collaboration', label: 'Drawing together works well', emoji: '🤝' },
  { id: 'library', label: 'The library is useful', emoji: '📚' },
  { id: 'voice_good', label: 'Voice works well', emoji: '🎙️' },
];

/** "What should we add?", shown for every rating. */
export const FEATURE_CHIPS: Chip[] = [
  { id: 'templates', label: 'More templates', emoji: '🧩' },
  { id: 'pdf', label: 'Import PDFs and slides', emoji: '📄' },
  { id: 'maths', label: 'Graphs and maths tools', emoji: '📐' },
  { id: 'handwriting', label: 'Handwriting to text', emoji: '✍️' },
  { id: 'video', label: 'Video in calls', emoji: '🎥' },
  { id: 'breakout', label: 'Breakout groups', emoji: '👥' },
  { id: 'tablet', label: 'Better pen and tablet support', emoji: '🖊️' },
  { id: 'offline', label: 'Work offline', emoji: '✈️' },
];

const ALL = [...PROBLEM_CHIPS, ...PRAISE_CHIPS, ...FEATURE_CHIPS];

/** "🐢 Lag while drawing" for an ID, or the ID itself if it's unknown. */
export const chipLabel = (id: string) => {
  const chip = ALL.find((item) => item.id === id);
  return chip ? `${chip.emoji} ${chip.label}` : id;
};
