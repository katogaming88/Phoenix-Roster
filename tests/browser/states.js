// The page states the browser suite checks (#810, Phase A).
//
// Phase A is the pages a signed-out visitor can reach: index.html's nine
// views, guild.html, and boe.html's signed-out state. officer.html and admin.html need a seeded session and
// come in Phase B.
//
// index.html with no ?team= is deliberately absent. It is not a state: a cold
// landing with no claimed-team session calls location.replace('guild.html')
// (resolveColdLanding(), js/roster.js) and bootRosterApp() never runs, so it
// would be guild.html a second time under another name.
//
// `sentinel` is the assertion that the page finished, and it is picked by one
// rule: it must be something that only exists once the HEAVY reads have
// rendered. loadData()'s onCoreReady fires on roster, team settings and M+
// rejections alone, so a sentinel drawn from core data goes green on a page
// that is still half empty -- which is the #790 failure the suite exists to
// catch, and would be an embarrassing way to reproduce it.
//
// `click` means the state is reached by clicking rather than by the hash. Only
// Streams needs it, and only because of #811: the #streams deep link builds
// the tab before DATA.streamers lands and nothing rebuilds it, so the deep
// link genuinely renders an empty tab today. Clicking the nav item is the
// working path, and it is what gets axe a populated Streams view to judge.
// When #811 is fixed, drop the click and the state still passes.

export const STATES = [
  {
    label: 'index-landing',
    path: '/index.html?team=phoenix',
    // buildProgression() returns early when DATA.raidProgression is empty.
    sentinel: '#landingProgression .prog-wrap'
  },
  {
    label: 'index-roster',
    path: '/index.html?team=phoenix#roster',
    sentinel: '#rosterView .roster-table tbody tr'
  },
  {
    label: 'index-streams',
    path: '/index.html?team=phoenix#streams',
    click: '#navStreamers',
    sentinel: '#streamersView .stream-card'
  },
  {
    label: 'index-signup',
    path: '/index.html?team=phoenix#signup',
    sentinel: '#signupForm .signup-step-title'
  },
  {
    label: 'index-history',
    path: '/index.html?team=phoenix#history',
    sentinel: '#historyView .recap-season-block'
  },
  {
    label: 'index-about',
    path: '/index.html?team=phoenix#about',
    sentinel: '#aboutViewWrap .bio-card'
  },
  {
    label: 'index-news',
    path: '/index.html?team=phoenix#news',
    sentinel: '#newsViewWrap button'
  },
  {
    label: 'index-help',
    path: '/index.html?team=phoenix#help',
    sentinel: '#helpViewWrap h3'
  },
  {
    label: 'guild',
    path: '/guild.html',
    sentinel: '#guildStreams .stream-card'
  },
  {
    // The BoE Sales page (#864) signed out, carrying the report form since
    // #891. The sign-in prompt for the records is written only after the
    // session read settles, so it is the sentinel; the form above it builds
    // from its own reads and needs no session at all. The signed-in render
    // needs a seeded session and is Phase B with officer and admin.
    label: 'boe',
    path: '/boe.html',
    sentinel: '#boeAccessNote p'
  }
];
