// Every violation the page commits, in the order the checklist shows them.
// Shared by the build (the checklist markup) and the browser (marking each one seen).

export type Group = 'better-ads' | 'deceptive' | 'texture';

export interface Violation {
  id: string;
  group: Group;
  label: string;
  /** Where the page commits it. */
  where: string;
  /** Which Better Ads list names it: desktop, mobile, or both. */
  lists?: string;
}

export const GROUPS: Record<Group, { title: string; note: string }> = {
  'better-ads': {
    title: 'Better Ads Standards',
    note: 'The ad experiences the Coalition for Better Ads found people rate lowest, and asks the industry to stop using.',
  },
  deceptive: {
    title: 'Deceptive patterns',
    note: 'Types from the catalog at deceptive.design.',
  },
  texture: {
    title: 'Also observed',
    note: 'Not on either list, but you know them.',
  },
};

export const VIOLATIONS: Violation[] = [
  { id: 'popup', group: 'better-ads', label: 'Pop-up ads', lists: 'Desktop, mobile', where: 'The survey window, and the two that replace it' },
  { id: 'autoplay-sound', group: 'better-ads', label: 'Auto-playing video ads with sound', lists: 'Desktop, mobile', where: 'The video under the intro plays its jingle on its own' },
  { id: 'prestitial', group: 'better-ads', label: 'Prestitial ads with countdown', lists: 'Desktop, mobile', where: 'The bread subscription before the page' },
  { id: 'sticky-large', group: 'better-ads', label: 'Large sticky ads', lists: 'Desktop, mobile', where: 'The sock banner over a third of the screen' },
  { id: 'density-50', group: 'better-ads', label: 'Ad density higher than 50%', lists: 'Desktop', where: 'Ads take more than half the article column' },
  { id: 'density-30', group: 'better-ads', label: 'Ad density higher than 30%', lists: 'Mobile', where: 'Ads take more than 30% of the article column' },
  { id: 'density-30-sticky-video', group: 'better-ads', label: 'Ad density higher than 30% with a sticky video ad', lists: 'Desktop', where: 'Both at once' },
  { id: 'flashing', group: 'better-ads', label: 'Flashing animated ads', lists: 'Mobile', where: 'The spoon, kept under three flashes a second' },
  { id: 'poststitial', group: 'better-ads', label: 'Postitial ads with countdown', lists: 'Mobile', where: 'Follow the "Jump to recipe" link' },
  { id: 'scrollover', group: 'better-ads', label: 'Full-screen scrollover ads', lists: 'Mobile', where: 'The mattress that sweeps over the text' },
  { id: 'sticky-video', group: 'better-ads', label: 'Sticky, pop-out video ads', lists: 'Mobile', where: 'Scroll past the video and it follows you' },
  { id: 'sticky-video-inline', group: 'better-ads', label: 'Sticky video ad with large inline ad', lists: 'Mobile', where: 'The pop-out video beside a big inline ad' },

  { id: 'confirmshaming', group: 'deceptive', label: 'Confirmshaming', where: 'Every "No thanks" on the newsletter' },
  { id: 'disguised-ads', group: 'deceptive', label: 'Disguised ads', where: 'The big buttons under the byline, and a story that is not one' },
  { id: 'fake-scarcity', group: 'deceptive', label: 'Fake scarcity', where: 'Only a few toasters left, always' },
  { id: 'fake-social-proof', group: 'deceptive', label: 'Fake social proof', where: 'Strangers buying toasters in the corner' },
  { id: 'fake-urgency', group: 'deceptive', label: 'Fake urgency', where: 'A deal that ends, then is extended, forever' },
  { id: 'forced-action', group: 'deceptive', label: 'Forced action', where: 'No reading until you answer the cookie wall' },
  { id: 'obstruction', group: 'deceptive', label: 'Obstruction', where: 'Rejecting cookies takes fourteen clicks' },
  { id: 'preselection', group: 'deceptive', label: 'Preselection', where: 'Every cookie purpose, switched on for you' },
  { id: 'trick-wording', group: 'deceptive', label: 'Trick wording', where: 'The newsletter checkbox' },
  { id: 'visual-interference', group: 'deceptive', label: 'Visual interference', where: 'The real close links are the faint ones' },
  { id: 'nagging', group: 'deceptive', label: 'Nagging', where: 'The newsletter, the alerts, and the sock banner come back' },
  { id: 'hidden-subscription', group: 'deceptive', label: 'Hidden subscription', where: 'The free bread trial' },
  { id: 'hard-to-cancel', group: 'deceptive', label: 'Hard to cancel', where: 'Cancelling the bread' },
  { id: 'hidden-costs', group: 'deceptive', label: 'Hidden costs', where: 'The free toaster' },
  { id: 'sneaking', group: 'deceptive', label: 'Sneaking', where: 'What else is in the toaster cart' },
  { id: 'currency-confusion', group: 'deceptive', label: 'Currency confusion', where: 'Prizes paid in Crumbs' },
  { id: 'addictive-design', group: 'deceptive', label: 'Addictive design', where: 'Bonk again to double your Crumbs' },

  { id: 'fake-close', group: 'texture', label: 'A close button that is part of the ad', where: 'Some of the x marks' },
  { id: 'layout-shift', group: 'texture', label: 'Late ads that shove the text', where: 'Ads that load above where you are reading' },
  { id: 'chumbox', group: 'texture', label: 'The chumbox', where: 'Around the web' },
  { id: 'retargeting', group: 'texture', label: 'Retargeting', where: 'A sofa you looked at once' },
  { id: 'chat', group: 'texture', label: 'A chat bubble that pings', where: 'Bottom right' },
  { id: 'exit-intent', group: 'texture', label: 'Exit intent', where: 'Move toward the tabs and the newsletter pounces' },
  { id: 'push-ask', group: 'texture', label: 'The notification pre-ask', where: 'Toast alerts, under the bar' },
];
