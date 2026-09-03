# Raider Walkthrough

Reference notes for walking a raider through the site -- not published to raiders.

## What it is

- A web app for the guild -- gives every raider a personal profile page and lets them do a few things without needing to message an officer
- The landing page itself (raider count, recent loot, raid progression) is public, no login needed
- Viewing their own profile requires logging in with Discord and claiming their character -- see below

---

## Finding their profile

- Open the link (share this in Discord)
- Top nav: **Home**, **Roster**, **Streams**, **Sign Up**, **History**, **About**, **News**, **Help**
- **History** only appears once the team has archived at least one season; **News** shows a notification dot when there's an unread entry
- Click **Login with Discord** in the top nav and authorize
- First time logging in, they'll be asked to claim their character from the roster
- Once claimed, click **View My Profile** (or click their name in the nav) -- this opens their own profile
- Note: there's no dropdown to browse other raiders' profiles -- only officers can look up other characters

---

## Quick Reference -- What Do They Need to Do When...

- **They got an item outside of raid (M+, vault, crafted, catalyst)** -- mark it received from their profile (see "Mark an item as received" below)
- **Their BiS plan changed for one item/slot, and Wishlist Editing is currently open (or their own "Allow Wishlist Edit" is on)** -- retag it in My Wishlist as BiS; takes effect immediately, no officer step needed, and supersedes whatever the officer had set for that slot
- **Their BiS plan changed but they can't self-edit their Wishlist right now** -- their BiS source should already be on file as the reference source, so use **My BiS Changed (Same Source)** to flag it either way: an officer can update the BiS Manager grid directly, or flip their "Allow Wishlist Edit" toggle so they can make the change themselves. Note field is a good place to say which they'd prefer
- **Their whole BiS plan changed (new sim, new list)** -- submit or update their BiS source from their profile; this feeds the officer's grid, not the live list directly (see "Submit or update their BiS list" below)
- **They want to flag backups/sidegrades, not just their one BiS pick** -- tag items in the My Wishlist section of their profile (see "Fill out their Wishlist" below)
- **Signups just opened, or they're switching mains this season** -- use the Sign Up button on the main page
- **Their Great Vault can no longer offer them a Mythic+ upgrade** -- submit an M+ exclusion request from their profile
- **They stream on Twitch and want to show up on the Streams tab** -- link their channel from their profile (see "Link their Twitch stream" below)
- **They just want to check attendance, loot, or priority standing** -- it's all on their profile any time, no action needed
- **They're not sure how to do any of the above** -- point them at the site's own **Help** tab in the top nav; it's the same steps written out for them to follow on their own

---

## What shows on their profile

- **Attendance** -- their attendance % for the current season with a colour bar; click to expand and see specific dates where they were excused or a no-show
- **Items Received** -- how many items they've gotten this tier; click to expand the full list with slot and difficulty
- **BiS List** -- a live merge, not just their submitted source: the officer's picked item per slot (BiS Manager grid), overridden slot-by-slot by anything the raider has tagged **BiS** in their own Wishlist. Their submitted BiS source is shown here too, but only as the reference an officer reads to decide what to put in their grid -- it doesn't drive this list directly
- **Loot Priority** -- every item on their BiS list with their current priority rank, which slot it is, and which boss drops it
- **My Wishlist** -- only shown to the raider viewing their own profile; per-slot cards where they tag every item they'd want (BiS/Good/OK/Catalyst Only/Pass), not just their one BiS pick -- see "Fill out their Wishlist" below
- **M+ Exclusion** -- shows Excluded/Rejected status if they've ever requested one, or the request button if exclusions are open
- **Your Stream** -- only shown to the raider viewing their own profile; lets them link a Twitch channel
- **Backup Tank / Backup Healer badges** -- shown publicly on the profile if an officer has flagged them as either; purely an officer-set designation, nothing for the raider to do here
- **Quick-link icons** (WarcraftLogs / Raider.IO / Armory) -- next to their name, built automatically from their character name and realm, no submission needed; visible on anyone's profile, not just their own
- Every section above has a small **?** button next to its heading with a short explanation -- point raiders at those instead of re-explaining a section from scratch

---

## Things they can do

### Submit or update their BiS list
- Their profile shows their current BiS source (if they've submitted one)
- Hit Submit / Update and paste in the new link
- An officer reviews and approves it, then manually updates their pick(s) in the BiS Manager grid to match -- unlike Wishlist tags, this doesn't write anywhere automatically, it's the officer's reference source
- If the source itself hasn't changed but the list behind it has (e.g. they reordered items on the same wowhead/raidbots page), use **My BiS Changed (Same Source)** instead of resubmitting the link -- this is the general "my considered-BiS changed, please act" flag, whether the actual change is one item or the whole list. It queues for an officer either way; how it gets resolved (edit the BiS Manager grid directly, or open Wishlist Editing for just this raider so they can retag it themselves) is the officer's call, and the note field is a good place to say which they'd prefer
- If Wishlist Editing is already open (or their own "Allow Wishlist Edit" is on), tagging a single item/slot BiS directly in **My Wishlist** is faster and needs no officer step at all -- see "Fill out their Wishlist" below
- Their submitted source is cleared unconditionally every time a new season starts (**Start New Season**), regardless of which site it's on -- a source points at a specific tier's loot table, and there's no way to tell whether the site behind it happens to update in place for a new tier. If a raider asks where their source went, this is why -- they need to resubmit a fresh one.

### Mark an item as received (self-report)
- Use this for items received outside of raid -- M+, Great Vault, Crafted, Catalyst, World Drop
- Fill in the item name, where it came from, and any notes
- An officer reviews it; once approved it's added to their loot history and affects their priority standing
- Don't use this for items that went through RCLootCouncil in raid -- those are tracked automatically

### Season signup
- If signups are open there's a Sign Up button on the main page
- Multi-step form -- character/realm, class, spec, role, Discord tag, notes
- If they're switching mains this season, check the "I'm switching mains" box and enter the old main -- this records the swap for officers
- If they're logged in with Discord and the name/class entered doesn't match their claimed character, they'll see a warning and have to confirm before submitting (this catches typos and wrong-class clicks)
- Step 3 (Spec/Role) shows who else already plays the class they picked; hybrid classes picking Tank or Healer also see a capacity nudge once the team's officer-set target for that role is already met -- they can still submit either way, it's just a heads-up to consider DPS/backup or talk to an officer first
- Officers review applications

### M+ exclusion request
- Once their Great Vault can no longer offer them a Mythic+ gear upgrade, they can request to be excluded from the weekly M+ requirement for the rest of the season -- not a one-week skip
- The form now gates on two self-attested checks before Submit is even clickable: a checkbox confirming 6/6 Myth in every M+ obtainable slot, and a "gem sockets filled (Helm/Bracer/Belt)" dropdown that must be 2 of 3 or better
- Submit their Raider.io profile from the M+ Exclusion section of their profile
- Notes field is a good place to flag known exceptions, e.g. a raid-only trinket stuck below Myth track with no M+ equivalent
- Officers review and approve or reject it; a rejected request can be re-submitted

### Fill out their Wishlist
- **My Wishlist** on their own profile lets them tag a status (BiS, Good, OK, Catalyst Only, Pass) plus an optional note for every item in each gear slot, not just one BiS pick per slot -- collapsible cards per slot, dot summary shows tagged items without expanding
- Tagging something BiS there also updates their BiS List; only one item per slot can be BiS at a time -- tagging a new one auto-demotes the previous BiS pick in that slot to Good
- **Other Sources -- BiS Not From Raid (M+ / Crafted)** card covers slots whose real BiS comes from outside raid drops
- A completeness counter shows how many required slots are tagged (or already covered by the officer's BiS pick); a **Show all seasons** checkbox lifts the current-tier-only item filter
- Read-only whenever wishlist editing is closed -- unless an officer has flipped their personal "Allow Wishlist Edit" toggle (their profile, officer view), same per-raider exception BiS Submissions already has via "Allow BiS Submit"
- Raiders who swap specs regularly in raid, per boss fight (e.g. a warlock alternating Aff/Demo/Destro; Frost/Unholy DK; Devastation/Augmentation Evoker; any pure-DPS class): only one item per slot can be BiS, even if a different item is genuinely BiS for another spec they play. In-app help tip tells them to tag their most-played spec's item BiS, tag the other spec's item with whichever tier actually fits (Good/OK/Catalyst Only), and use the Note field to say it's really BiS for that spec -- officers can see wishlist notes via BiS Manager > Priority > Notes (see [officer-walkthrough.md](officer-walkthrough.md)). Doesn't apply to an off-spec only played outside raid or in a different role (e.g. an Elemental Shaman tagging a Restoration item) -- only specs actually swapped between mid-raid that share the same role and primary stat

### Link their Twitch stream
- From the **Your Stream** section on their own profile, enter their Twitch channel name and an optional schedule note, then Save
- They'll show up on the **Streams** tab automatically whenever they go live
- **Opt out of showing on other teams' pages** keeps their stream off other teams' sites while still showing it here

### Report a found BoE
- The **BoE** tab is the replacement for the old BoE Google Form: reporting team, character Name-Realm, item, track, upgrade rank, optional note, Submit
- The item field is a list of the season's BoEs ([#875](https://github.com/katogaming88/WGA-Raid-Hub/issues/875), select-only since [#880](https://github.com/katogaming88/WGA-Raid-Hub/pull/880)); pick the one you found. It fills once the page has loaded, and an item that is not on it cannot be reported until the catalog gains it, so tell an officer
- **Track** and **Upgrade rank** are both required ([#865](https://github.com/katogaming88/WGA-Raid-Hub/issues/865)): the rank is a list of 1/6 to 6/6, the number the item's tooltip shows. Together they say which item this is: two finds of the same item on the same track at the same rank are one queue and the first reported sells first, while a different rank is a different item and never waits behind the other. The form refuses to submit without them
- **I'd like to donate my finder's fee to the guild** is a checkbox under the note, off by default ([#862](https://github.com/katogaming88/WGA-Raid-Hub/issues/862)), with a short note above it saying some finders donate their cut and that there is no obligation to. It records the intent: the row shows it to the managers on the BoE Sales page, the Discord post carries it as its own field, and the manager's settle button is what decides when the item sells
- No login needed. The guild-level way in is the **Found a BoE?** card on the guild page ([#781](https://github.com/katogaming88/WGA-Raid-Hub/issues/781)): pick the team you raided with, and it hands off to that team's form with that team already chosen. It carries no team in the link, so one pinned link serves every team including Wrathless, and it hides itself entirely if no team has BoE turned on. Direct per-team links (`index.html?team=<slug>#boe`) still land on the card the same way
- **Reporting for team** is a dropdown, not a label ([#767](https://github.com/katogaming88/WGA-Raid-Hub/issues/767)). It starts on the right team by itself (an explicit `?team=` link wins, otherwise their claimed character's team, otherwise the page they are on) but they can always change it, because raiders sub across teams. It lists Wrathless too, which raids with the guild but has no page of its own, and it hides any team that has switched its own `boe` flag off
- Logged in, the character field prefills from their claimed character (still editable). Anything they have already typed or picked survives, so a late login never overwrites their work
- Submitting records the find for the officers and posts the familiar bot-style message to the BoE Discord channel; officers handle listing, sale, and payout on the BoE Sales page ([#774](https://github.com/katogaming88/WGA-Raid-Hub/issues/774), [#864](https://github.com/katogaming88/WGA-Raid-Hub/issues/864)), which raiders never see
- Hidden per team via the `boe` feature flag (Admin tab / site admin dashboard)

---

## The landing page

- Shows current raider count and total items distributed this tier
- Recent loot feed -- last 10 items given out across the roster; a search box lets them type an item name to see every match for the current season instead of just the last 10
- Raid progression -- current season's raids showing how many bosses are down out of the total (e.g. 3/8 Mythic) with a first-kill date for each downed boss

---

## The Roster tab

- Public, no login needed -- shows who's currently on the roster, grouped by role
- Just name, class, and spec -- no attendance, loot, or BiS info
- A second sub-tab, named after the officer-set signup season (e.g. "MN Season 2 Roster (Tentative)"), appears once there's an incoming roster to show -- lists who's approved for next season, tentative until the officer rollover

---

## The Streams tab

- Public, no login needed -- shows raiders currently live on Twitch, with a banner at the top of every page when someone's live
- Pulls from whoever's linked their channel via the **Your Stream** section on their own profile

---

## The History tab

- Public, no login needed -- only appears in the nav once the team has archived at least one season
- Past seasons' raid progression and boss kill dates, read-only

---

## The About tab

- Public, no login needed -- renamed from "Bios"; up to 4 sub-tabs, pill bar only shows once 2+ are populated (a team with only one populated section just shows that content directly)
- **Team** -- officer-curated cards introducing this team's raid officers (name, title, pronouns, class/spec, photo or initials, short bio)
- **Guild** -- same card format, but for the guild's own leadership (separate from Team since not every team officer holds a guild rank and vice versa)
- **About** -- static copy on what WGA Raid Hub is and who built it; always present
- **Contact** -- a form (name optional, message required) that posts straight to a Discord channel the admins watch; if they're logged in with Discord their username rides along so a reply is easy
- Team/Guild content is entirely set by officers from the dashboard; raiders can't edit or add anything here

---

## The News tab

- Public, no login needed -- reverse-chronological "what shipped" feed, sourced from a hand-maintained news file (separate from CHANGELOG.md, filtered to raider-relevant entries only)
- A notification dot on the nav item shows when there's an entry a raider hasn't seen yet; visiting the tab clears it
- Pinned entries and the single newest entry are expanded by default; click any entry to expand/collapse it

---

## The Help tab

- Raider-facing help, mirroring the officer dashboard's own Officer Guide tab -- covers claiming a character, submitting/updating BiS, signing up, requesting a received item, and checking priority/attendance
- Point raiders here instead of walking them through the site from scratch every time
