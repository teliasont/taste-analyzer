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
let results          = []; // [{chosen, notChosen, reasoning}, ...]
let currentPairA     = null; // song currently shown on card A
let currentPairB     = null; // song currently shown on card B
let pendingReasoning = "";   // reasoning from the API response, stored until a card is tapped

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
    li.textContent = `${song.title} — ${song.artist}`;

    const removeBtn = document.createElement("button");
    removeBtn.type        = "button";
    removeBtn.textContent = "Remove";
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
// Called when the user clicks Start. Hides the input screen, shows the
// comparison screen, and fires the first round.
function startComparison() {
  shuffledSongs = shuffleArray(songs);
  totalRounds   = Math.floor(shuffledSongs.length / 2);
  currentRound  = 0;
  results       = [];

  inputSection.hidden      = true;
  comparisonSection.hidden = false;

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
  fetchComparisonQuestion(currentPairA, currentPairB);
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
async function fetchComparisonQuestion(songA, songB) {
  const prompt = `You are helping a listener understand their own music taste through comparison. You have deep knowledge of music — not just genre, but emotional texture, structure, and what a song asks of its listener.

You will receive two song titles and their artists.

Step 1: Identify one specific thing these two songs share beneath the surface. Not genre, not tempo, not mood labels — something specific about their emotional logic or what they demand from the listener. Do not use the title, subject matter, or literal content of either song. The connection must be specific enough that it could not describe most other songs — if it could, find a deeper one.

Step 2: Using that shared quality, write a single comparison question. The situation in the question must be a direct consequence of the shared quality you identified — someone reading both fields should be able to see the connection clearly. Place the listener inside a specific physical situation that carries emotional stakes on its own — something is at risk, ending, beginning, or being decided in that moment. A neutral physical action with no stakes is not enough. Write in second person, present tense. Direct address only.

Rules:
- The question must begin with the word "Which"
- Do not ask "which do you like more" directly
- Do not reference genre, tempo, or release year
- The question must feel like a choice between two experiences, not two ideas or abstract qualities
- The situation must be physical and concrete — somewhere the listener can picture themselves standing, sitting, moving, or doing something
- The situation must carry emotional stakes — not a neutral action, not a generic moment, not a metaphor
- Do not use internal or psychological framing — no "the night you decide," no "when you finally realize," no emotional turning points described from the inside
- Avoid vague placeholder language like "something," "the thing," or "it"
- The question must be one sentence, maximum 25 words

Example of correct output:
{
  "reasoning": "Both songs treat forward motion as the only honest response to something already lost.",
  "question": "Which do you play driving away from a place you're never going back to?"
}

Example of incorrect output (too psychological, not physical):
{
  "reasoning": "Both songs stage a moment of psychological rupture where the self must dismantle what it built.",
  "question": "Which do you play the night you finally decide to burn down the version of yourself you built for someone else?"
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
    displayQuestion(parsed.question);

  } catch (error) {
    console.error("Could not fetch comparison question:", error);
    // Fallback so the round is still playable even without a live API response.
    pendingReasoning = "";
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
// Records the user's choice, then either loads the next round or ends the
// analysis if all rounds are complete.
function handleCardChoice(chosen, notChosen) {
  results.push({ chosen, notChosen, reasoning: pendingReasoning });

  if (currentRound < totalRounds) {
    loadNextRound();
  } else {
    // All rounds done — fill progress bar and show a completion message.
    progressBar.style.width = "100%";
    questionText.textContent = "Analysis complete!";
    cardA.disabled = true;
    cardB.disabled = true;

    console.log("Taste analysis results:", results);
  }
}

// ── init ─────────────────────────────────────────────────────────────────────
// Wires up all event listeners and does the first render to populate the
// counter. Called once immediately when the script loads.
function init() {
  console.log("Music Taste Analyzer loaded.");

  btnAdd.addEventListener("click", addSong);

  // Let the user press Enter from either field instead of clicking Add,
  // which is faster when typing several songs in a row.
  inputTitle.addEventListener("keydown",  (e) => { if (e.key === "Enter") addSong(); });
  inputArtist.addEventListener("keydown", (e) => { if (e.key === "Enter") addSong(); });

  btnStart.addEventListener("click", startComparison);

  // Each card passes itself as `chosen` and the other as `notChosen`.
  cardA.addEventListener("click", () => handleCardChoice(currentPairA, currentPairB));
  cardB.addEventListener("click", () => handleCardChoice(currentPairB, currentPairA));

  renderList(); // sets counter text and disables Start on first load
}

init();
