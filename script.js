// script.js — entry point for the Music Taste Analyzer
//
// This file runs after the HTML has loaded (because the <script> tag is at
// the bottom of index.html). All DOM manipulation and app logic will live
// here or be imported from other files as the project grows.

// ── State ────────────────────────────────────────────────────────────────────
// songs is the single source of truth for the list. Every change goes through
// this array first, then renderList() redraws the UI from it. This means the
// DOM always exactly reflects the array — they can never drift out of sync.
let songs = [];

const MIN_SONGS = 6; // minimum before the Start button becomes active

// ── DOM references ────────────────────────────────────────────────────────────
// Grabbed once at startup so we're not querying the DOM on every interaction.
const inputSection   = document.getElementById("input-section");
const resultsSection = document.getElementById("results-section");
const inputTitle     = document.getElementById("input-title");
const inputArtist    = document.getElementById("input-artist");
const btnAdd         = document.getElementById("btn-add");
const btnStart       = document.getElementById("btn-start");
const songList       = document.getElementById("song-list");
const songCount      = document.getElementById("song-count");

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

  renderList(); // sets counter text and disables Start on first load
}

init();
