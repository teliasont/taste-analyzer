// script.js — entry point for the Music Taste Analyzer
//
// This file runs after the HTML has loaded (because the <script> tag is at
// the bottom of index.html). All DOM manipulation and app logic will live
// here or be imported from other files as the project grows.

// ── DOM references ───────────────────────────────────────────────────────────
// Grab the sections we defined in index.html so we can update them later.
const inputSection = document.getElementById("input-section");
const resultsSection = document.getElementById("results-section");

// ── App entry point ──────────────────────────────────────────────────────────
// Everything starts here. We call init() immediately at the bottom of this
// file so the app boots as soon as the script loads.
function init() {
  console.log("Music Taste Analyzer loaded.");
  // Future: fetch user data, render input form, wire up event listeners, etc.
}

init();
