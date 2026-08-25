/**
 * The user guide, as structured content rather than markup.
 *
 * Kept as data so that one renderer draws it on screen and the same content
 * prints to PDF without a second copy drifting out of step with the first. A
 * guide that describes an older version of the app is worse than no guide, so
 * there is deliberately only one place to edit.
 *
 * Screenshots are referenced by SLOT, not by URL. A slot whose image has not
 * been dropped in yet renders as a labelled placeholder saying what to capture,
 * so a missing picture is visible rather than silent.
 */

export type Block =
  | { kind: "lead"; text: string }
  | { kind: "text"; text: string }
  | { kind: "steps"; items: { do: string; detail?: string }[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; tone: "info" | "warn" | "danger" | "good"; title: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][]; caption?: string }
  | { kind: "shot"; slot: string; caption: string; capture: string }
  | { kind: "diagram"; id: "flow" | "model" | "doors" | "cycle"; caption: string }
  | { kind: "where"; path: string; text: string };

export interface GuideSection {
  id: string;
  number: string;
  title: string;
  blurb: string;
  /** SVG path, drawn beside the heading and in the contents. */
  icon: string;
  blocks: Block[];
}

export const GUIDE_VERSION = "1.0";

export const GUIDE: GuideSection[] = [
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "overview",
    number: "1",
    title: "How it all fits together",
    blurb: "The one rule that explains everything else",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    blocks: [
      {
        kind: "lead",
        text: "The Rep Router turns your store list into a four-week call cycle for every rep: which stores they visit, on which day of which week, and in what order, so the driving between them is as short as it can be.",
      },
      { kind: "diagram", id: "model", caption: "What the system is made of, and what depends on what" },
      {
        kind: "note",
        tone: "info",
        title: "A store belongs to a rep because of the rep code on the store",
        text: "There is no separate screen where you assign stores to reps. Each store record carries a REPRESENTATIVE ID, and that code is the allocation. Change the code on the store and the store moves to that rep. This is the single most important thing to understand about the system, because it explains where allocations come from and why a rep with no matching code has an empty round.",
      },
      {
        kind: "text",
        text: "Everything else follows from a handful of records. Channels say how often a type of store should be visited and for how long. Reps are the people. Stores are the outlets, each carrying its rep code, its channel and its coordinates. Visit roles say what KIND of visit somebody is making, so a quality check and a sales call can happen at different rhythms. Teams group reps under a manager. Once those are right, generating routes is a single click.",
      },
      { kind: "diagram", id: "flow", caption: "The order to do things in, first time through" },
      {
        kind: "note",
        tone: "warn",
        title: "Routes are a snapshot, not a live view",
        text: "When you generate routes, the plan is saved. It does not update itself. Fix a coordinate, add a rep, change a channel frequency, and the Routes page, the Map and the Rep Capacity page all still show the old plan until you generate again. Whenever you change data, finish by regenerating.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "channels",
    number: "2",
    title: "Channels: how often, and for how long",
    blurb: "The call rules every store inherits",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    blocks: [
      {
        kind: "lead",
        text: "A channel is a type of outlet: Spar, Pick n Pay, Engen, Independent. Each channel carries two numbers that drive the entire plan: how often a store of that type is visited, and how many minutes a visit takes.",
      },
      { kind: "where", path: "Control Centre → Channels", text: "where the rules live" },
      {
        kind: "table",
        head: ["Frequency", "Visits in a four-week cycle", "Typical use"],
        rows: [
          ["Daily", "20", "A key account with a permanent presence"],
          ["3x weekly", "12", "Very high volume"],
          ["2x weekly", "8", "High volume"],
          ["Weekly", "4", "Major supermarkets"],
          ["3x monthly", "3", "Above average"],
          ["2x monthly", "2", "Regular trade"],
          ["Monthly", "1", "The default: standard call"],
          ["Bi-monthly", "Every second cycle", "Low volume"],
          ["Quarterly", "Every third cycle", "Minimal"],
        ],
        caption: "Frequencies available, and what each means over a four-week cycle",
      },
      {
        kind: "steps",
        items: [
          { do: "Open Control Centre → Channels", detail: "Every channel currently in the system is listed with its frequency and visit length." },
          { do: "Set the frequency and duration for each channel", detail: "You can edit them in the grid, or use Import Excel to set many at once." },
          { do: "Click Apply defaults to stores", detail: "This is the step people miss. Editing a channel changes the RULE. It does not change the stores until you apply it." },
          { do: "Read the preview before confirming", detail: "It tells you exactly how many stores will change and what they will change to." },
        ],
      },
      {
        kind: "shot",
        slot: "channels-grid",
        caption: "The Channels page, with frequency and duration per channel",
        capture: "Control Centre → Channels, full page, showing the grid and the Apply defaults button",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Check the total workload before you apply defaults",
        text: "Applying channel defaults rewrites every store in one go, and the effect compounds. A channel set to weekly with a 90-minute visit means 6 hours a month for every single store of that type. Multiply that across a rep's whole round and it can easily exceed the hours in their month. Before applying, look at Rep Capacity and ask whether the resulting workload is one a person could actually do. If it is not, the frequencies need revisiting with the client rather than loading them anyway.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Overriding a single store",
        text: "If one particular store genuinely needs a different rhythm from the rest of its channel, use Call Overrides. A store with an approved override keeps its own values and is left alone when channel defaults are applied.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "reps",
    number: "3",
    title: "Reps: loading the people",
    blurb: "Codes, names and email addresses",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    blocks: [
      {
        kind: "lead",
        text: "A rep record needs very little: a rep code and a name. The code is what matters, because it is what ties stores to that person.",
      },
      { kind: "where", path: "Reps", text: "the rep list, with import and export" },
      {
        kind: "steps",
        items: [
          { do: "Open the Reps page and click Import Excel", detail: "Your file needs a rep code column. Name and email are optional but worth including." },
          { do: "Read the preview", detail: "It shows how many reps will be created, how many updated, and anything it could not use. Nothing is saved yet." },
          { do: "Click Apply these changes", detail: "Only now is anything written." },
        ],
      },
      {
        kind: "table",
        head: ["Column in your file", "What it does"],
        rows: [
          ["REPCODE or Rep Code", "Required. Matches the rep to their stores."],
          ["REPNAME or Rep Name", "Display name. See the note below about spellings."],
          ["REPEMAILADDRESS or Email", "Needed only if the rep will have their own login."],
          ["Cell Number", "Optional contact detail."],
          ["Home Address", "Optional. See section 6."],
          ["Hours/Day", "Optional. Defaults to 8.5 hours."],
        ],
      },
      {
        kind: "note",
        tone: "good",
        title: "The import will not quietly wipe anything",
        text: "A column your file does not contain is left alone on every rep. A cell that is present but blank is also left alone. So a cut-down file of just codes and email addresses is safe to send: it fills in the emails and touches nothing else. Names are a deliberate exception. If a name in your file differs from the one on record, it is reported to you rather than overwritten, because a changed name on the same code can mean the code was given to somebody new.",
      },
      {
        kind: "shot",
        slot: "reps-import",
        caption: "The import preview, before anything is saved",
        capture: "Reps page after choosing a file: the preview panel showing created, updated and unchanged counts",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Reps also appear by themselves",
        text: "When you upload stores, any rep code the system has not seen before is created automatically with a blank name and no email. That keeps the store allocation intact, but it means the rep list can fill up with codes rather than people. The Reps page is worth a look after any big upload, to give those codes a name and an email.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "stores",
    number: "4",
    title: "Stores: loading the outlets",
    blurb: "Two different doors, and why it matters which you use",
    icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z",
    blocks: [
      {
        kind: "lead",
        text: "Stores can be loaded two ways, and they behave differently. Choosing the wrong one is the easiest way to lose data in this system, so it is worth understanding the difference before you upload anything.",
      },
      {
        kind: "table",
        head: ["", "Store Upload", "Import Excel on the Stores page"],
        rows: [
          ["Where", "Control Centre → Store Upload", "Stores → Import Excel"],
          ["Use it for", "The full picture: new stores, their reps, their channels", "Correcting stores that already exist"],
          ["Adds new stores", "Yes", "No, it reports them instead"],
          ["Touches rep allocation", "Yes, it rewrites it", "No, never"],
          ["Touches monthly average", "Yes, it rewrites it", "No, never"],
          ["Safe for a coordinates-only file", "No", "Yes"],
        ],
      },
      { kind: "diagram", id: "doors", caption: "Two ways in, and what each one overwrites" },
      {
        kind: "note",
        tone: "danger",
        title: "Never send a stores-only file through Store Upload",
        text: "Store Upload owns the whole store picture, so it writes the rep code and the monthly average on every row it touches. If those columns are missing from your file it writes blanks, silently unassigning the rep and zeroing the sales figure on every store in the file. When you only want to fix store details such as coordinates, always use Import Excel on the Stores page instead.",
      },
      {
        kind: "steps",
        items: [
          { do: "First load, or adding new stores: Control Centre → Store Upload", detail: "It accepts your own column headings, and one column pair per visit role." },
          { do: "Fixing existing stores: Stores → Export Excel", detail: "Edit what needs correcting in the file." },
          { do: "Then Stores → Import Excel", detail: "It matches on Place ID, updates only the columns your file carries, and reports any Place ID it does not recognise rather than creating it." },
        ],
      },
      {
        kind: "shot",
        slot: "store-upload",
        caption: "Store Upload, for the full picture",
        capture: "Control Centre → Store Upload, showing the file chooser and the notes about column names",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A store with no channel inherits no call rhythm",
        text: "Call frequency and visit length reach a store through its channel. If the CHANNEL column is blank or holds something that is not a channel, the store keeps whatever it was last given and stops following the rules everything else follows. Check the channel column before a big upload rather than after.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "allocation",
    number: "5",
    title: "Allocating stores to reps",
    blurb: "Where allocation actually happens",
    icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
    blocks: [
      {
        kind: "lead",
        text: "There is no allocation screen, because allocation is not a separate thing. The REPRESENTATIVE ID on the store record is the allocation.",
      },
      {
        kind: "steps",
        items: [
          { do: "In bulk: put the rep code in your store file", detail: "Through Store Upload, the REPRESENTATIVE ID column sets who each store belongs to." },
          { do: "One store at a time: edit it on the Stores page", detail: "Change the rep on the row and it moves immediately." },
          { do: "Confirm the result on the Routes page", detail: "After generating, it lists any store it could not schedule and says why, which is where a bad rep code shows up." },
        ],
      },
      {
        kind: "note",
        tone: "danger",
        title: "A rep code that matches nobody makes stores disappear",
        text: "Nothing checks the rep code on a store against the rep list. If a store names a rep who was never loaded, that store is dropped from the map, from every route and from all capacity figures, silently. The Routes page is where you will notice: it lists the stores it could not schedule, and a rep who does not exist is one of the reasons. Load the missing rep and the stores attach themselves.",
      },
    ],
  },


  // ─────────────────────────────────────────────────────────────────────
  {
    id: "visit-roles",
    number: "6",
    title: "Visit roles: more than one person per store",
    blurb: "A sales call and a QC call are not the same visit",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    blocks: [
      {
        kind: "lead",
        text: "Most stores are called on by one person, their sales rep. Some are also visited by somebody doing a different job: a quality check, or training. Those are separate visits, at their own rhythm, by their own person, and the system plans them separately.",
      },
      { kind: "where", path: "Control Centre → Visit Roles", text: "the kinds of visit, and how often each happens" },
      {
        kind: "table",
        head: ["", "The primary role", "Every other role"],
        rows: [
          ["Who it is", "The sales rep", "QC, Training, or any role you add"],
          ["Set on the store by", "REPRESENTATIVE ID", "That role's own column pair"],
          ["How often, and how long", "From the store, which inherits it from its channel", "From the role itself"],
          ["Counts toward capacity", "Yes", "Yes, for the person doing it"],
          ["Flagged when far from their area", "Yes", "Only if you switch it on for that role"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Why the primary role takes its rhythm from the store and the others do not",
        text: "A sales call happens as often as that TYPE of store needs calling on, which is a property of the channel: a Spar is not visited at the same rate as a forecourt. A QC visit happens as often as QC needs doing, which is a property of the job, not of the shop. So the primary role reads the store and every other role reads itself.",
      },
      {
        kind: "steps",
        items: [
          { do: "Open Control Centre → Visit Roles", detail: "Each role carries how often it calls and how many minutes it takes." },
          { do: "Decide whether that role should be checked for out-of-range stores", detail: "A role covering a whole province would otherwise be flagged on nearly every store, which is why it is off by default for those." },
          { do: "Put the person's rep code in that role's column on the store", detail: "Through Store Upload, each role has its own ID and NAME column pair. A store with nothing in a role's column simply is not visited by that role." },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Adding a role adds columns to Store Upload",
        text: "Each visit role gets its own pair of columns in the upload, named after the role. Add a role and the file gains a column pair; rename a role and the column names change with it. If a store's role column is blank, that role does not visit it, which is different from the role having no rep.",
      },
      {
        kind: "shot",
        slot: "visit-roles",
        caption: "Visit Roles: each kind of visit, with its own rhythm",
        capture: "Control Centre → Visit Roles, showing the roles with their frequency, duration and out-of-range setting",
      },
    ],
  },
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "data-health",
    number: "7",
    title: "Checking the data before you plan",
    blurb: "Thirteen checks in one place",
    icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    blocks: [
      {
        kind: "lead",
        text: "Route quality is decided by data quality. A store with no coordinates cannot be put in a day, and a store allocated to nobody cannot be planned at all. Three screens between them find almost everything worth finding.",
      },
      { kind: "where", path: "Stores · Rep Capacity · Duplicate Stores", text: "where the problems show up" },
      {
        kind: "table",
        head: ["Where", "What it tells you"],
        rows: [
          ["Stores, GPS problems filter", "Every store with no coordinates, coordinates at 0,0, or coordinates outside South Africa"],
          ["Routes, could not be scheduled", "Stores left out of the plan, and why each one was left out"],
          ["Rep Capacity, out of range", "Stores far from the middle of that rep's territory"],
          ["Control Centre, Duplicate Stores", "The same shop recorded more than once under one rep"],
          ["Reps, Set Home GPS", "Reps whose typed address never became coordinates"],
        ],
      },
      {
        kind: "steps",
        items: [
          { do: "Start on the Stores page and switch on the GPS problems filter", detail: "A store with no location cannot be clustered into a day or ordered into a route, so this is the one that costs you most." },
          { do: "Export the grid, fix the coordinates in Excel, import it back", detail: "Stores → Export Excel, then Stores → Import Excel. It matches on Place ID and only touches the columns your file carries." },
          { do: "Then look at Duplicate Stores and the out-of-range list", detail: "Duplicates inflate every count and every capacity figure. Out-of-range stores are sometimes genuine and sometimes an allocation mistake." },
        ],
      },
      {
        kind: "shot",
        slot: "stores-gps",
        caption: "The Stores page with the GPS problems filter on",
        capture: "Stores page with the GPS problems filter switched on, showing the editable latitude and longitude columns",
      },
      {
        kind: "note",
        tone: "info",
        title: "Fixing coordinates in bulk",
        text: "Export the Stores grid, fill in the GPS LATITUDE and GPS LONGITUDE columns in Excel, and import it back through Stores → Import Excel. Latitude and longitude must be filled in as a pair. In South Africa the latitude is always negative: a missing minus sign is the most common cause of a store plotting on the wrong continent.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "home",
    number: "8",
    title: "Where each rep starts their day",
    blurb: "Home addresses, and why they save driving",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    blocks: [
      {
        kind: "lead",
        text: "A route has to start somewhere. If the system knows where a rep lives, the day is planned outwards from their front door. If it does not, the day is planned from the middle of their stores, which usually means driving past home to get to the first call.",
      },
      {
        kind: "table",
        head: ["Starts Day At", "What it means"],
        rows: [
          ["Home, with coordinates", "The rep's real starting point is known and used"],
          ["Store centroid", "No home location on file, so the middle of their stores is used instead"],
        ],
      },
      {
        kind: "text",
        text: "There are two ways to capture it, and they are not equally good.",
      },
      {
        kind: "steps",
        items: [
          {
            do: "Typing an address, on the Reps page",
            detail: "Enter the address, then use Set Home GPS to look it up. The system only saves a result it is confident about: an exact building or a numbered point on a known street. Anything vaguer is listed for review rather than saved, because a suburb centre looks identical to a real home address once it is stored, and would quietly move the rep's whole week.",
          },
          {
            do: "The rep capturing it themselves, which is better",
            detail: "Give the rep a login. They sign in, open Account, and tap Use my current location while standing at home. That records the exact spot from the phone's GPS with nothing to look up and nothing to get wrong. This is the only method that works reliably for an informal address.",
          },
        ],
      },
      {
        kind: "shot",
        slot: "rep-account",
        caption: "What a rep sees: their own profile, and nothing else",
        capture: "The /account page signed in as a rep, showing the Where your day starts card and the Use my current location button",
      },
      {
        kind: "note",
        tone: "info",
        title: "Giving reps their own logins",
        text: "On the Reps page, Create login makes an account for a rep and emails them their sign-in details. A rep login can reach their own profile and nothing else: not the rep list, not the store list, not anyone's routes. They are asked to choose their own password the first time they sign in.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Capturing a home address does not change an existing plan",
        text: "Filling in home addresses updates the rep records. The routes already saved still start wherever the old plan said. When the Starts Day At column changes from Store centroid to Home, that is the signal that regenerating is now worth doing.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "generate",
    number: "9",
    title: "Generating the routes",
    blurb: "The single click that builds the cycle",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    blocks: [
      {
        kind: "lead",
        text: "With channels, reps and stores in place, generating the call cycle is one action. The system spreads each rep's stores across four weeks according to how often each store needs visiting, groups each week into five days by geography, then orders each day so the driving is as short as possible.",
      },
      { kind: "diagram", id: "cycle", caption: "One rep's four-week cycle: twenty working days" },
      { kind: "where", path: "Routes → Generate Routes", text: "builds the cycle for every rep, or for one" },
      {
        kind: "steps",
        items: [
          { do: "Choose the call cycle type", detail: "Geography plans every store allocated to the rep, clustered by area. Channel Dedicated plans only the channels that rep is assigned to." },
          { do: "Generate for one rep, or for all of them", detail: "A single rep is quick. All reps takes longer and is worth doing when you have finished a round of data fixes." },
          { do: "Wait for it to finish", detail: "Do not navigate away. When it completes, the Routes page shows the new plan." },
        ],
      },
      {
        kind: "table",
        head: ["Call cycle type", "Which stores a rep gets"],
        rows: [
          ["Geography", "Every store carrying their rep code, grouped by area"],
          ["Channel Dedicated", "Only stores in the channels assigned to that rep"],
        ],
      },
      {
        kind: "shot",
        slot: "routes-generate",
        caption: "The Routes page, with the generate control",
        capture: "Routes page showing the call cycle type selector and the Generate Routes button",
      },
      {
        kind: "note",
        tone: "info",
        title: "Why the ordering sometimes differs between runs",
        text: "Where possible the system asks Google for real road distances, which is what makes a day's order genuinely efficient rather than merely tidy on a map. A large all-reps run has a time budget: once it is spent, the remaining reps are ordered by straight-line distance instead, so the run always completes. Generating for a single rep always gets the full road-based treatment.",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Regenerate after every change",
        text: "This is the rule that catches everyone. Saved plans never update themselves. Corrected fifty coordinates? Regenerate. Added a rep? Regenerate. Changed a channel frequency and applied it? Regenerate. Until you do, the Routes page, the Map and Rep Capacity are all describing the world as it was when you last generated.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "reading",
    number: "10",
    title: "Reading the results",
    blurb: "Routes, Map and Rep Capacity",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    blocks: [
      {
        kind: "lead",
        text: "Three pages show you the same plan from different angles. All three read the saved plan, so all three are only as current as your last generation.",
      },
      {
        kind: "table",
        head: ["Page", "Answers"],
        rows: [
          ["Routes", "Which stores does this rep visit, on which day of which week"],
          ["Map", "What does that week actually look like on the ground"],
          ["Rep Capacity", "Is this workload realistic, and who has room for more"],
        ],
      },
      {
        kind: "text",
        text: "Rep Capacity is the one to read carefully. It adds up the visit time and the driving time in each rep's plan and compares it to the hours they actually work, then tells you who is over capacity and who has room. It is also where you confirm that a store which looks unusually far away really is part of that rep's round.",
      },
      {
        kind: "shot",
        slot: "capacity",
        caption: "Rep Capacity: scheduled hours against available hours",
        capture: "Rep Capacity page showing the table of reps with utilisation percentages",
      },
      {
        kind: "shot",
        slot: "map",
        caption: "The Map: one rep's week, in order",
        capture: "Map page with a rep selected, showing numbered stops and the route line",
      },
      {
        kind: "note",
        tone: "info",
        title: "Stores that look wrongly placed",
        text: "A store a long way from the rest of a rep's round is flagged rather than silently planned. If it is a genuine outlying call, confirm it in cycle and it stops being reported. If it is not, either the store belongs to a different rep or its coordinates are wrong.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "perigee",
    number: "11",
    title: "Sending the cycle to Perigee",
    blurb: "Turning the plan into dated visits",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    blocks: [
      {
        kind: "lead",
        text: "The plan is a repeating four-week cycle. Perigee wants dated appointments. The export projects the cycle forward across the calendar and produces one row per visit, with a real date on it.",
      },
      { kind: "where", path: "Routes → Perigee export", text: "the schedule as dated visits" },
      {
        kind: "steps",
        items: [
          { do: "Generate routes first", detail: "The export reads the saved plan, so it can only export what has been generated." },
          { do: "Choose how many months to project", detail: "Between one and six. Three is the usual choice." },
          { do: "Download and check the first few rows", detail: "Confirm the dates and rep codes look right before importing anything into Perigee." },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Confirm the column headings against your Perigee template",
        text: "The export uses our best understanding of Perigee's import format. Before running a large import, check the headings against the schedule import template in your own Perigee account, and try a small batch first.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "maintenance",
    number: "12",
    title: "Keeping it up to date",
    blurb: "What to do when something changes",
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    blocks: [
      {
        kind: "table",
        head: ["What changed", "What to do", "Regenerate?"],
        rows: [
          ["A new rep joins", "Reps → Import Excel, or Add Rep", "Yes"],
          ["A rep leaves", "Move their stores to another rep code first", "Yes"],
          ["New stores opened", "Control Centre → Store Upload", "Yes"],
          ["A store closed", "Remove it on the Stores page", "Yes"],
          ["Stores move between reps", "Change the rep code on those stores", "Yes"],
          ["Coordinates corrected", "Stores → Export, fix, Import", "Yes"],
          ["Call frequency changes", "Channels, then Apply defaults to stores", "Yes"],
          ["A rep's home address captured", "Reps page, or the rep's own profile", "Yes"],
          ["A rep's working hours change", "Edit the rep", "Yes"],
        ],
        caption: "The answer to the last column is always yes",
      },
      {
        kind: "note",
        tone: "info",
        title: "A sensible routine",
        text: "Once a month, run the GPS problems filter on Stores, glance at Duplicate Stores and the out-of-range list, then regenerate routes. That is enough to stop the plan drifting away from reality, and takes very little time once the data is clean.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "troubleshooting",
    number: "13",
    title: "When something looks wrong",
    blurb: "The usual causes, in order of likelihood",
    icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    blocks: [
      {
        kind: "table",
        head: ["What you see", "Most likely cause"],
        rows: [
          [
            "A rep has no stores in their route",
            "No store carries their rep code. Check the spelling of the code on both sides.",
          ],
          [
            "Stores are missing from the plan entirely",
            "They have no coordinates, or their rep code matches nobody. The Routes page lists what it could not schedule.",
          ],
          [
            "The map shows a rep's day zig-zagging",
            "Some stores have wrong coordinates, so they are not where the plan thinks.",
          ],
          [
            "A rep looks massively over capacity",
            "Channel frequencies may have been applied without checking the total workload. Check Rep Capacity.",
          ],
          [
            "A change I made has not appeared",
            "Routes were not regenerated. This is by far the most common one.",
          ],
          [
            "A store appears twice in a cycle",
            "Duplicate store records. Look in Control Centre, Duplicate Stores.",
          ],
          [
            "A rep did not receive their login email",
            "Check the address on the rep record, and whether another rep shares it. Only one login can exist per address.",
          ],
          [
            "The route ordering looks less efficient than usual",
            "A large generation run may have fallen back to straight-line distances. Regenerate that rep on their own.",
          ],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Checking the map service",
        text: "Control Centre → System Health tests the mapping service that turns addresses into coordinates and orders each day along real roads. If route ordering suddenly looks poor across the board, check there first.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "glossary",
    number: "14",
    title: "Glossary",
    blurb: "The words this system uses",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.247m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.247",
    blocks: [
      {
        kind: "table",
        head: ["Term", "Meaning"],
        rows: [
          ["Call cycle", "The repeating four-week pattern of visits"],
          ["Channel", "A type of outlet, carrying a call frequency and a visit length"],
          ["Rep code", "The code that ties a store to the rep who calls on it"],
          ["Place ID", "The unique identifier for a store, used to match records on import"],
          ["Store centroid", "The middle of a rep's stores, used as a starting point when no home address is known"],
          ["Outlier", "A store far outside the rest of a rep's round"],
          ["Override", "A deliberate exception to a channel's call rules for one store"],
          ["Utilisation", "Scheduled hours as a percentage of the hours a rep actually works"],
          ["Generation", "Building and saving a new plan from the current data"],
        ],
      },
    ],
  },
];

/** Every screenshot the guide expects, for the drop-in checklist. */
export function screenshotSlots(): { slot: string; capture: string; section: string }[] {
  const out: { slot: string; capture: string; section: string }[] = [];
  for (const section of GUIDE) {
    for (const b of section.blocks) {
      if (b.kind === "shot") out.push({ slot: b.slot, capture: b.capture, section: section.title });
    }
  }
  return out;
}
