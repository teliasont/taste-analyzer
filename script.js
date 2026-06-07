// script.js — entry point for the Music Taste Analyzer
//
// This file runs after the HTML has loaded (because the <script> tag is at
// the bottom of index.html). All DOM manipulation and app logic will live
// here or be imported from other files as the project grows.

// ── API configuration ─────────────────────────────────────────────────────────
// API calls go through the Netlify serverless function at the path below. The
// function adds the Anthropic API key from a server-side environment variable
// and forwards the request — the key is never sent to or stored in the browser.
const CLAUDE_ENDPOINT = "/.netlify/functions/claude";

const MODEL = "claude-sonnet-4-6";

// ── Input-screen state ────────────────────────────────────────────────────────
// songs is the single source of truth for the list. Every change goes through
// this array first, then renderList() redraws the UI from it. This means the
// DOM always exactly reflects the array — they can never drift out of sync.
let songs = [];

const MIN_SONGS = 6; // minimum before the Start button becomes active

// ── Comparison state ──────────────────────────────────────────────────────────
let shuffledSongs    = []; // songs in a random order, fixed for the whole run
let currentRound     = 0;  // 1-indexed; incremented before each round starts
let totalRounds      = 0;  // Math.floor(songs.length / 2)
let results          = []; // [{chosen, notChosen, reasoning, question}, ...]
let currentPairA     = null; // song currently shown on card A
let currentPairB     = null; // song currently shown on card B
let pendingReasoning = "";   // reasoning from the API response, stored until a card is tapped
let pendingQuestion  = "";   // question displayed this round, stored until a card is tapped

// ── DOM references ────────────────────────────────────────────────────────────
// Grabbed once at startup so we're not querying the DOM on every interaction.
const inputSection      = document.getElementById("input-section");
const comparisonSection = document.getElementById("comparison-section");
const inputTitle        = document.getElementById("input-title");
const inputArtist       = document.getElementById("input-artist");
const btnAdd            = document.getElementById("btn-add");
const btnStart          = document.getElementById("btn-start");
const songList          = document.getElementById("song-list");
const songCount         = document.getElementById("song-count");

// Comparison screen elements
const progressBar  = document.getElementById("progress-bar");
const roundCounter = document.getElementById("round-counter");
const questionText = document.getElementById("question-text");
const cardA        = document.getElementById("card-a");
const cardATitle   = document.getElementById("card-a-title");
const cardAArtist  = document.getElementById("card-a-artist");
const cardB        = document.getElementById("card-b");
const cardBTitle   = document.getElementById("card-b-title");
const cardBArtist  = document.getElementById("card-b-artist");
const btnUndo      = document.getElementById("btn-undo");

// Results screen elements
const resultsSection   = document.getElementById("results-section");
const reflectionStatus = document.getElementById("reflection-status");
const reflectionText   = document.getElementById("reflection-text");
const btnRestart       = document.getElementById("btn-restart");

// ── addSong ───────────────────────────────────────────────────────────────────
// Reads both input fields, rejects empty values, pushes a new {title, artist}
// object onto the songs array, clears the fields, then re-renders the list.
function addSong() {
  const title  = inputTitle.value.trim();
  const artist = inputArtist.value.trim();

  // Silently bail if either field is blank — no partial entries in the list.
  if (!title || !artist) return;

  songs.push({ title, artist });

  inputTitle.value  = "";
  inputArtist.value = "";
  inputTitle.focus(); // return focus so the user can type the next song without clicking

  renderList();
}

// ── removeSong ───────────────────────────────────────────────────────────────
// Removes the song at position `index` from the array using splice(), then
// re-renders. Each remove button captures its own index in a closure (see
// renderList), so this function always removes the correct entry.
function removeSong(index) {
  songs.splice(index, 1);
  renderList();
}

// ── renderList ───────────────────────────────────────────────────────────────
// Clears the <ul> and rebuilds it entirely from the songs array. Called after
// every add or remove. Rebuilding from the array (rather than patching the DOM
// in place) is simpler to reason about: whatever is in songs is what you see.
function renderList() {
  songList.innerHTML = ""; // wipe the previous render

  songs.forEach((song, index) => {
    const li = document.createElement("li");

    // Wrap the text in a span so CSS can target it independently from the button.
    const label = document.createElement("span");
    label.textContent = `${song.title} — ${song.artist}`;
    li.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.type        = "button";
    removeBtn.textContent = "×"; // rendered as a cream × on green fill via CSS
    // The arrow function closes over `index`, so each button removes its own song.
    removeBtn.addEventListener("click", () => removeSong(index));

    li.appendChild(removeBtn);
    songList.appendChild(li);
  });

  updateCounter();
  updateStartButton();
}

// ── updateCounter ─────────────────────────────────────────────────────────────
// Writes a human-readable count into #song-count. The message changes once
// MIN_SONGS is reached so the user gets clear progress feedback throughout.
function updateCounter() {
  const count     = songs.length;
  const remaining = MIN_SONGS - count;
  const label     = count === 1 ? "song" : "songs";

  if (count === 0) {
    songCount.textContent = `No songs added yet — add at least ${MIN_SONGS} to start`;
  } else if (remaining > 0) {
    songCount.textContent = `${count} ${label} added — add ${remaining} more to start`;
  } else {
    songCount.textContent = `${count} ${label} added`;
  }
}

// ── updateStartButton ─────────────────────────────────────────────────────────
// Keeps the Start button's disabled state in sync with the array length.
// The button is both visually and functionally inactive below the threshold —
// setting .disabled handles both without needing any CSS class toggling.
function updateStartButton() {
  btnStart.disabled = songs.length < MIN_SONGS;
}

// ── stripCodeFences ───────────────────────────────────────────────────────────
// Removes markdown code fences that Claude sometimes wraps JSON responses in.
// Handles both ```json ... ``` and plain ``` ... ``` wrappers. If neither is
// present the original string is returned unchanged, so JSON.parse always gets
// a clean string regardless of how Claude formatted its response.
function stripCodeFences(text) {
  const match = text.trim().match(/^```\w*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

// ── applyScreen ──────────────────────────────────────────────────────────────
// Shows exactly one screen and hides the other two. Called both by the
// navigation functions below and by handleHashChange. Keeping visibility logic
// in one place means there is no way for sections to get out of sync.
function applyScreen(screen) {
  inputSection.hidden      = screen !== 'input';
  comparisonSection.hidden = screen !== 'compare';
  resultsSection.hidden    = screen !== 'results';
  // Toggle a class on <body> so CSS can paint the full viewport green and
  // invert the header when the comparison screen is active.
  document.body.classList.toggle('comparing', screen === 'compare');
}

// ── handleHashChange ──────────────────────────────────────────────────────────
// Fires when the URL hash changes via the browser's back/forward buttons, or
// on the initial page load (called manually from init). Validates that the
// required state exists before showing a screen — if the user bookmarks
// #compare and reloads, the comparison state is gone, so we redirect to #input.
function handleHashChange() {
  const screen = window.location.hash.slice(1); // strip the leading '#'

  if (screen === 'compare' && shuffledSongs.length > 0) {
    applyScreen('compare');
  } else if (screen === 'results' && results.length > 0) {
    applyScreen('results');
  } else {
    applyScreen('input');
    // Replace the unresolvable hash so the back button doesn't loop to it.
    if (screen && screen !== 'input') {
      history.replaceState(null, '', '#input');
    }
  }
}

// ── shuffleArray ──────────────────────────────────────────────────────────────
// Returns a new array in a random order (Fisher-Yates). The original is not
// mutated — the caller owns the result.
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ── startComparison ───────────────────────────────────────────────────────────
// Called when the user clicks Start. Sets up comparison state, navigates to
// the comparison screen, and fires the first round.
function startComparison() {
  shuffledSongs = shuffleArray(songs);
  // An odd-length list can't be fully paired. Drop the last song silently so
  // every round has exactly two songs and totalRounds is always a whole number.
  if (shuffledSongs.length % 2 !== 0) shuffledSongs.pop();
  totalRounds    = shuffledSongs.length / 2;
  currentRound   = 0;
  results        = [];
  btnUndo.hidden = true; // hidden until the first choice is recorded

  applyScreen('compare');
  window.location.hash = 'compare';

  loadNextRound();
}

// ── loadNextRound ─────────────────────────────────────────────────────────────
// Advances the round counter, updates the progress bar, populates the two
// song cards from the shuffled array, and kicks off the API fetch.
function loadNextRound() {
  currentRound++;

  // Progress bar fills as rounds complete (0% at start of round 1, 100% after last).
  const progressPercent = ((currentRound - 1) / totalRounds) * 100;
  progressBar.style.width = `${progressPercent}%`;

  roundCounter.textContent = `Round ${currentRound} of ${totalRounds}`;

  const pairIndex = (currentRound - 1) * 2;
  currentPairA = shuffledSongs[pairIndex];
  currentPairB = shuffledSongs[pairIndex + 1];

  cardATitle.textContent  = currentPairA.title;
  cardAArtist.textContent = currentPairA.artist;
  cardBTitle.textContent  = currentPairB.title;
  cardBArtist.textContent = currentPairB.artist;

  showLoadingState();
  fetchComparisonQuestion(currentPairA, currentPairB, results.map(r => r.question).filter(Boolean));
}

// ── showLoadingState ──────────────────────────────────────────────────────────
// Puts the question area into its loading state and disables both cards while
// we wait for the API. Prevents the user from tapping before the question loads.
function showLoadingState() {
  questionText.textContent = "Finding a connection...";
  cardA.disabled = true;
  cardB.disabled = true;
}

// ── fetchComparisonQuestion ───────────────────────────────────────────────────
// Sends a request to the Netlify proxy function, which adds the API key and
// forwards it to Anthropic. Stores the reasoning field for later, then calls
// displayQuestion() to show the question and enable the cards.
//
// Falls back to a generic question if the fetch fails, so the user can still
// step through all rounds without a hard error.
async function fetchComparisonQuestion(songA, songB, previousQuestions = []) {
  // Build the optional context block listing questions already asked this session.
  // Omitted entirely on round 1 when there is nothing to avoid yet.
  const previousQuestionsBlock = previousQuestions.length > 0
    ? `Previous questions asked in this session — do not repeat these situations or close variations of them:\n${previousQuestions.map(q => `- ${q}`).join('\n')}\n\n`
    : '';

  const prompt = `You are helping a listener understand their own music taste through comparison. You have deep knowledge of music — not just genre, but emotional texture, structure, and what a song asks of its listener.

You will receive two song titles and their artists.

Step 1: Identify one specific thing these two songs share beneath the surface. Not genre, not tempo, not mood labels — something specific about their emotional logic or what they demand from the listener. Do not use the title, subject matter, or literal content of either song. The connection must be specific enough that it could not describe most other songs — if it could, find a deeper one.

Step 2: Using that shared quality, write a single comparison question. The situation in the question must be a direct consequence of the shared quality you identified — someone reading both fields should be able to see the connection clearly. Place the listener inside a specific physical situation that carries emotional stakes on its own — something is at risk, ending, beginning, or being decided in that moment. A neutral physical action with no stakes is not enough. Write in second person, present tense. Direct address only.

${previousQuestionsBlock}Rules:
- The question must begin with the word "Which"
- Do not ask "which do you like more" directly
- Do not reference genre, tempo, or release year
- The question must feel like a choice between two experiences, not two ideas or abstract qualities
- The situation must be physical and concrete — somewhere the listener can picture themselves standing, sitting, moving, or doing something
- The situation must carry emotional stakes — not a neutral action, not a generic moment, not a metaphor
- Do not use internal or psychological framing — no "the night you decide," no "when you finally realize," no emotional turning points described from the inside
- Avoid vague placeholder language like "something," "the thing," or "it"
- The question must be one sentence, maximum 20 words
- Do not use these situations or close variations of them: leaving a place, packing belongings, waiting outside a door, sitting in a parked car, watching something disappear in the distance. Find a genuinely different physical context
- The situation does not need to be heavy or melancholic. Celebrations, high-energy moments, ordinary pleasures, and joyful situations are equally valid as long as the emotional stakes are real
- Vary the type of situation — if it involves stillness, consider movement. If it involves an ending, consider a beginning or a middle

Example of correct output:
{
  "reasoning": "Both songs build emotional weight through accumulation — detail layered on detail — until the listener is holding something heavier than they agreed to at the start.",
  "question": "Which do you play at mile three when the hard part is still ahead?"
}

Example of incorrect output (wrong situation type — departure, melancholic, banned context):
{
  "reasoning": "Both songs treat forward motion as the only honest response to something already lost.",
  "question": "Which do you play driving away from a place you're never going back to?"
}

Return a JSON object with two fields:
- "reasoning": one specific sentence naming the shared quality — specific enough that it could not describe most other songs. No complex psychological framing, no vague generalities
- "question": the comparison question only — must begin with "Which," the situation must carry emotional stakes, and it must visibly follow from the reasoning. No preamble, no setup, nothing before or after it
Song A: ${songA.title} by ${songA.artist}

Song B: ${songB.title} by ${songB.artist}`;

  try {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // No x-api-key or anthropic-version here — the Netlify function adds
        // both server-side so the key is never exposed in the browser.
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 300,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const data   = await response.json();
    const text   = stripCodeFences(data.content[0].text);
    const parsed = JSON.parse(text);

    pendingReasoning = parsed.reasoning || "";
    pendingQuestion  = parsed.question  || "";
    displayQuestion(parsed.question);

  } catch (error) {
    console.error("Could not fetch comparison question:", error);
    // Fallback so the round is still playable even without a live API response.
    pendingReasoning = "";
    pendingQuestion  = "";
    displayQuestion("Which of these two songs speaks to you more right now?");
  }
}

// ── displayQuestion ───────────────────────────────────────────────────────────
// Shows the AI question and enables both cards so the user can make a choice.
function displayQuestion(question) {
  questionText.textContent = question;
  cardA.disabled = false;
  cardB.disabled = false;
}

// ── handleCardChoice ──────────────────────────────────────────────────────────
// Records the user's choice. Shows the undo button after the first choice.
// Either loads the next round or navigates to the results screen when done.
function handleCardChoice(chosen, notChosen) {
  results.push({ chosen, notChosen, reasoning: pendingReasoning, question: pendingQuestion });
  btnUndo.hidden = false; // reveal after the first choice is recorded

  if (currentRound < totalRounds) {
    loadNextRound();
  } else {
    progressBar.style.width = "100%";
    btnUndo.hidden = true; // undo doesn't make sense once we leave the comparison screen

    applyScreen('results');
    window.location.hash = 'results';
    fetchReflection();
  }
}

// ── handleUndo ────────────────────────────────────────────────────────────────
// Steps back one round: removes the last choice, restores the previous pair,
// and fetches a fresh question for it. loadNextRound() is intentionally NOT
// called here — it would increment currentRound again, landing on the wrong pair.
// Instead this function manually restores all state that loadNextRound would set,
// then calls fetchComparisonQuestion directly.
function handleUndo() {
  results.pop();                                    // 1. remove the last choice
  currentRound--;                                   // 2. step back one round

  btnUndo.hidden = currentRound === 0;              // 3. hide if nothing left to undo

  // 4. currentRound is now the 1-indexed round we want to show again.
  //    Because it's already decremented, the pair index is currentRound * 2 - 2,
  //    which simplifies to (currentRound - 1) * 2 — but written directly:
  const pairIndex = (currentRound - 1) * 2;
  currentPairA = shuffledSongs[pairIndex];
  currentPairB = shuffledSongs[pairIndex + 1];

  // Restore the card labels to the reverted pair.
  cardATitle.textContent  = currentPairA.title;
  cardAArtist.textContent = currentPairA.artist;
  cardBTitle.textContent  = currentPairB.title;
  cardBArtist.textContent = currentPairB.artist;

  // Rewind the progress bar to reflect the number of completed rounds.
  progressBar.style.width = `${((currentRound - 1) / totalRounds) * 100}%`;

  roundCounter.textContent = `Round ${currentRound} of ${totalRounds}`;  // 5. update counter

  showLoadingState();                               // disable cards while fetching
  // Pass questions from rounds still in results (after the pop) so the model
  // avoids repeating situations from earlier rounds that the user kept.
  fetchComparisonQuestion(currentPairA, currentPairB, results.map(r => r.question).filter(Boolean)); // 6.
}

// ── fetchReflection ───────────────────────────────────────────────────────────
// Sends all of the listener's choices to Claude and asks for a personal
// reflection on what the pattern reveals about their taste. The response is
// plain prose, not JSON — no parsing needed beyond extracting the text field.
async function fetchReflection() {
  const choiceLines = results.map((r, i) => {
    const shared = r.reasoning ? ` Shared quality: ${r.reasoning}` : '';
    return `Round ${i + 1}: Chose "${r.chosen.title}" by ${r.chosen.artist} over "${r.notChosen.title}" by ${r.notChosen.artist}.${shared}`;
  }).join('\n');

  const prompt = `You have observed a listener choose between song pairs. Here are their choices and the quality each pair shared:
${choiceLines}

Write a 3 sentence reflection for this listener. Be direct and specific — name actual qualities you notice in the music they chose: energy levels, sonic texture, lyrical approach, emotional register, tempo, genre tendencies, or structural patterns where relevant. Say what their choices suggest about how they actually use music in their life — not poetically, but practically and specifically.

Do not use: abstract language, literary metaphors, phrases like "sit with discomfort," "keep honest company," "fuel or release," "the withholding is the point," "tension becomes meaning," "make the waiting feel necessary," "almost said," "almost resolved," or any variation of these constructions. Do not personify the songs. Do not write literary analysis. Do not write about what the songs "ask of" the listener. Write observations about listening behavior — what kinds of songs they pick, what those songs share sonically or structurally, and what that pattern suggests about when and how they listen.

Write directly to the listener in second person, present tense. Prose only, no formatting.`;

  try {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 400,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    showReflection(data.content[0].text.trim());

  } catch (error) {
    console.error("Could not fetch reflection:", error);
    showReflection("Your choices trace a pattern — even if it's hard to name right now. Come back and listen again.");
  }
}

// ── showReflection ────────────────────────────────────────────────────────────
// Swaps the loading indicator for the finished reflection text.
function showReflection(text) {
  reflectionStatus.hidden    = true;
  reflectionText.textContent = text;
  reflectionText.hidden      = false;
}

// ── restartApp ────────────────────────────────────────────────────────────────
// Resets all comparison and results state and returns to the input screen.
// The song list is preserved so the user doesn't have to re-enter everything.
function restartApp() {
  shuffledSongs    = [];
  currentRound     = 0;
  totalRounds      = 0;
  results          = [];
  currentPairA     = null;
  currentPairB     = null;
  pendingReasoning = "";
  pendingQuestion  = "";

  btnUndo.hidden             = true;
  reflectionStatus.hidden    = false;  // reset for the next run
  reflectionText.hidden      = true;
  reflectionText.textContent = "";

  applyScreen('input');
  window.location.hash = 'input';
}

// ── init ─────────────────────────────────────────────────────────────────────
// Wires up all event listeners and does the first render to populate the
// counter. Called once immediately when the script loads.
function init() {
  btnAdd.addEventListener("click", addSong);

  // Let the user press Enter from either field instead of clicking Add,
  // which is faster when typing several songs in a row.
  inputTitle.addEventListener("keydown",  (e) => { if (e.key === "Enter") addSong(); });
  inputArtist.addEventListener("keydown", (e) => { if (e.key === "Enter") addSong(); });

  btnStart.addEventListener("click", startComparison);

  // Each card passes itself as `chosen` and the other as `notChosen`.
  cardA.addEventListener("click", () => handleCardChoice(currentPairA, currentPairB));
  cardB.addEventListener("click", () => handleCardChoice(currentPairB, currentPairA));

  btnUndo.addEventListener("click", handleUndo);
  btnRestart.addEventListener("click", restartApp);

  // hashchange fires when the user navigates with the browser's back/forward
  // buttons. We use it to keep the visible screen in sync with the URL hash.
  window.addEventListener("hashchange", handleHashChange);

  // On page load, respect any hash already in the URL — handles direct links
  // like mysite.com/#input and redirects invalid hashes back to #input.
  handleHashChange();

  renderList(); // sets counter text and disables Start on first load
}

init();
