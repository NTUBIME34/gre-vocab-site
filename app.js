// ===== Global State =====
let vocabList = [];
let questionList = [];
let vocabMap = {};        // id -> vocab object
let posBuckets = {};      // pos -> [vocab]

// Practice session state
let practiceMode = "all";
let sessionQueue = [];
let sessionIndex = 0;
let sessionCorrect = 0;
let sessionTotal = 0;
let sessionMistakes = [];
let currentQuestion = null;
let answered = false;

// ===== DOM Refs =====
const $ = id => document.getElementById(id);
const homeBtn = $("homeBtn"), practiceBtn = $("practiceBtn"),
      wordBankBtn = $("wordBankBtn"), statsBtn = $("statsBtn");
const homeSection = $("homeSection"), practiceSection = $("practiceSection"),
      wordBankSection = $("wordBankSection"), statsSection = $("statsSection");
const questionContainer = $("questionContainer"), optionsContainer = $("optionsContainer"),
      resultContainer = $("resultContainer"), nextQuestionBtn = $("nextQuestionBtn");
const progressFill = $("progressFill"), questionCounter = $("questionCounter");
const wordBankContainer = $("wordBankContainer"), wordBankSearch = $("wordBankSearch"),
      wordBankCount = $("wordBankCount");
const statsContainer = $("statsContainer");
const startSmartBtn = $("startSmartBtn"), startNewBtn = $("startNewBtn"), startWrongBtn = $("startWrongBtn");
const exportProgressBtn = $("exportProgressBtn"), importProgressBtn = $("importProgressBtn"),
      resetProgressBtn = $("resetProgressBtn"), importProgressInput = $("importProgressInput");

// ===== Navigation =====
function showSection(section, btn) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll("nav button").forEach(b => b.classList.remove("nav-active"));
  section.classList.add("active");
  btn.classList.add("nav-active");
}

function setPracticeMode(mode) {
  const modeBtn = document.querySelector('.practice-mode-toggle button[data-mode="' + mode + '"]');
  if (!modeBtn) return;
  document.querySelectorAll(".practice-mode-toggle button").forEach(b => b.classList.remove("practice-mode-active"));
  modeBtn.classList.add("practice-mode-active");
  practiceMode = mode;
}

function startFromHome(mode, count) {
  showSection(practiceSection, practiceBtn);
  setPracticeMode(mode);
  $("questionCount").value = String(count);
  $("questionSource").value = "mixed";
  startSession();
}

homeBtn.addEventListener("click", () => { showSection(homeSection, homeBtn); updateHomeStats(); });
practiceBtn.addEventListener("click", () => { showSection(practiceSection, practiceBtn); });
wordBankBtn.addEventListener("click", () => { showSection(wordBankSection, wordBankBtn); renderWordBank(); });
statsBtn.addEventListener("click", () => { showSection(statsSection, statsBtn); renderStats(); });
startSmartBtn.addEventListener("click", () => startFromHome("smart", 20));
startNewBtn.addEventListener("click", () => startFromHome("new", 20));
startWrongBtn.addEventListener("click", () => startFromHome("wrong", 20));

// ===== localStorage Helpers =====
const PROGRESS_KEYS = ["wrongCounts", "correctCounts", "reviewTimes"];

function getStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (err) {
    return {};
  }
}
function setStore(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }
function getWrongCounts() { return getStore("wrongCounts"); }
function getCorrectCounts() { return getStore("correctCounts"); }
function getReviewTimes() { return getStore("reviewTimes"); }

function recordAnswer(wordId, isCorrect) {
  const wc = getWrongCounts(), cc = getCorrectCounts(), rt = getReviewTimes();
  if (isCorrect) {
    cc[wordId] = (cc[wordId] || 0) + 1;
  } else {
    wc[wordId] = (wc[wordId] || 0) + 1;
  }
  rt[wordId] = Date.now();
  setStore("wrongCounts", wc);
  setStore("correctCounts", cc);
  setStore("reviewTimes", rt);
}

function getMastery(wordId) {
  const c = getCorrectCounts()[wordId] || 0;
  const w = getWrongCounts()[wordId] || 0;
  const total = c + w;
  if (total === 0) return 0;
  return Math.min(100, Math.round((c / total) * 100));
}

function isMastered(wordId) { return getMastery(wordId) >= 80 && (getCorrectCounts()[wordId] || 0) >= 3; }

function getReviewPriority(vocab) {
  const wc = getWrongCounts(), cc = getCorrectCounts(), rt = getReviewTimes();
  const wrong = wc[vocab.id] || 0;
  const correct = cc[vocab.id] || 0;
  const reviewed = rt[vocab.id] || 0;
  const total = wrong + correct;
  if (total === 0) return 8;

  const daysSinceReview = reviewed ? (Date.now() - reviewed) / 86400000 : 14;
  const mastery = getMastery(vocab.id);
  let score = 0;
  score += wrong * 3;
  score += Math.min(daysSinceReview, 14) * 0.8;
  score += Math.max(0, 80 - mastery) / 10;
  if (wrong > 0 && daysSinceReview >= 1) score += 4;
  if (isMastered(vocab.id) && daysSinceReview < 7) score -= 6;
  return score;
}

function getSmartReviewList(list) {
  return [...list]
    .map(v => ({ vocab: v, score: getReviewPriority(v) }))
    .filter(item => item.score >= 4)
    .sort((a, b) => b.score - a.score || a.vocab.word.localeCompare(b.vocab.word))
    .map(item => item.vocab);
}

// ===== Data Loading =====
async function loadData() {
  try {
    const [vr, qr] = await Promise.all([fetch("data/vocab.json"), fetch("data/questions.json")]);
    if (!vr.ok || !qr.ok) throw new Error("Failed to load data files");
    vocabList = await vr.json();
    questionList = await qr.json();
    vocabMap = {};
    posBuckets = {};
    vocabList.forEach(v => {
      vocabMap[v.id] = v;
      const p = v.pos || "other";
      if (!posBuckets[p]) posBuckets[p] = [];
      posBuckets[p].push(v);
    });
    updateHomeStats();
  } catch (err) {
    document.querySelector("main").innerHTML =
      '<div class="section active" style="color:red;"><h2>Error Loading Data</h2>' +
      "<p>" + escapeHtml(err.message) + "</p>" +
      "<p>Serve the site via a local server (e.g. <code>python3 -m http.server</code>).</p></div>";
  }
}

// ===== Home Stats =====
function updateHomeStats() {
  const wc = getWrongCounts(), cc = getCorrectCounts();
  const totalW = Object.values(wc).reduce((s, n) => s + n, 0);
  const totalC = Object.values(cc).reduce((s, n) => s + n, 0);
  const mastered = vocabList.filter(v => isMastered(v.id)).length;
  const due = getSmartReviewList(vocabList).length;
  $("totalWords").textContent = vocabList.length;
  $("totalQuestions").textContent = questionList.length;
  $("totalCorrect").textContent = totalC;
  $("totalWrong").textContent = totalW;
  $("masteredCount").textContent = mastered;

  // Data source metadata
  const src = vocabList.length > 0 ? vocabList[0].source || "Unknown" : "—";
  const posCounts = {};
  vocabList.forEach(v => { posCounts[v.pos] = (posCounts[v.pos] || 0) + 1; });
  const posStr = Object.entries(posCounts).sort((a,b) => b[1]-a[1]).map(([p,c]) => p + " " + c).join(", ");
  const ds = $("dataSource");
  const clozeN = questionList.filter(q => q.questionType === "cloze").length;
  const defN = questionList.length - clozeN;
  if (ds) ds.innerHTML = "<strong>Source:</strong> " + escapeHtml(src) +
    " · <strong>" + vocabList.length + "</strong> words (" + posStr +
    ") · <strong>" + clozeN + "</strong> cloze + <strong>" + defN + "</strong> definition questions" +
    " · <strong>" + due + "</strong> due for smart review";
}

// ===== Dynamic Question Generation =====
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateDynamicQuestion(vocab) {
  const samePOS = (posBuckets[vocab.pos] || vocabList).filter(v => v.id !== vocab.id);
  const distractors = shuffle([...samePOS]).slice(0, 3);
  const optionWordIds = shuffle([vocab.id, ...distractors.map(d => d.id)]);

  // Try cloze if example_en exists and contains the word
  let questionType = "definition";
  let question = "Choose the word that means: " + vocab.english;
  let hint = "";
  if (vocab.example_en) {
    const re = new RegExp("\\b" + vocab.word.replace(/e$/, "") + "[a-z]*\\b", "i");
    const cloze = vocab.example_en.replace(re, "______");
    if (cloze !== vocab.example_en) {
      questionType = "cloze";
      question = cloze;
      hint = vocab.example_zh || "";
    }
  }

  return {
    id: "dyn_" + vocab.id,
    wordId: vocab.id,
    questionType,
    question,
    answer: vocab.word,
    optionWordIds,
    hint,
    difficulty: "medium"
  };
}

// ===== Practice Session =====
function startSession() {
  const posFilter = $("posFilter").value;
  const countVal = parseInt($("questionCount").value) || 0;
  const source = $("questionSource").value;
  const wc = getWrongCounts(), cc = getCorrectCounts();

  // Determine eligible vocab
  let eligible = vocabList;
  if (posFilter) eligible = eligible.filter(v => v.pos === posFilter);

  if (practiceMode === "wrong") {
    eligible = eligible.filter(v => (wc[v.id] || 0) > 0);
  } else if (practiceMode === "new") {
    eligible = eligible.filter(v => !((wc[v.id] || 0) > 0 || (cc[v.id] || 0) > 0));
  } else if (practiceMode === "smart") {
    eligible = getSmartReviewList(eligible);
  }

  if (eligible.length === 0) {
    questionContainer.innerHTML = '<p class="empty-state">No words match your filters. Try different settings.</p>';
    optionsContainer.innerHTML = "";
    resultContainer.innerHTML = "";
    progressFill.style.width = "0";
    questionCounter.textContent = "";
    nextQuestionBtn.style.display = "none";
    return;
  }

  // Build question queue
  const fixedMap = {};
  questionList.forEach(q => { fixedMap[q.wordId] = q; });

  let pool = [];
  eligible.forEach(v => {
    if (source === "fixed" && fixedMap[v.id]) {
      pool.push(fixedMap[v.id]);
    } else if (source === "dynamic") {
      pool.push(generateDynamicQuestion(v));
    } else {
      // mixed: use fixed if available, else generate
      pool.push(fixedMap[v.id] || generateDynamicQuestion(v));
    }
  });

  sessionQueue = practiceMode === "smart" ? pool : shuffle(pool);
  if (countVal > 0) sessionQueue = sessionQueue.slice(0, countVal);
  sessionIndex = 0;
  sessionCorrect = 0;
  sessionTotal = sessionQueue.length;
  sessionMistakes = [];
  answered = false;
  loadSessionQuestion();
}

function loadSessionQuestion() {
  if (sessionIndex >= sessionQueue.length) {
    showSessionComplete();
    return;
  }

  const q = sessionQueue[sessionIndex];
  currentQuestion = q;
  answered = false;

  // Progress
  const pct = sessionTotal > 0 ? Math.round((sessionIndex / sessionTotal) * 100) : 0;
  progressFill.style.width = pct + "%";
  questionCounter.textContent = "Question " + (sessionIndex + 1) + " of " + sessionTotal;

  // Render question with type badge and optional hint
  const typeBadge = q.questionType === "cloze"
    ? '<span class="q-type-badge cloze-badge">Fill in the Blank</span>'
    : '<span class="q-type-badge def-badge">Definition</span>';
  let qHtml = typeBadge + "<h3>" + escapeHtml(q.question) + "</h3>";
  if (q.hint && q.questionType === "cloze") {
    qHtml += '<p class="cloze-hint"><button class="hint-toggle" type="button">Show Hint</button><span class="hint-text" hidden> ' + escapeHtml(q.hint) + '</span></p>';
  }
  questionContainer.innerHTML = qHtml;
  const hintBtn = questionContainer.querySelector(".hint-toggle");
  if (hintBtn) hintBtn.addEventListener("click", toggleHint);
  optionsContainer.innerHTML = "";
  resultContainer.innerHTML = "";
  nextQuestionBtn.style.display = "none";

  q.optionWordIds.forEach(wId => {
    const vocab = vocabMap[wId];
    if (!vocab) return;
    const btn = document.createElement("button");
    btn.textContent = vocab.word;
    btn.addEventListener("click", () => checkAnswer(vocab.word, wId));
    optionsContainer.appendChild(btn);
  });
}

function toggleHint() {
  const hintBtn = questionContainer.querySelector(".hint-toggle");
  const hintText = questionContainer.querySelector(".hint-text");
  if (!hintBtn || !hintText) return;
  hintText.hidden = !hintText.hidden;
  hintBtn.textContent = hintText.hidden ? "Show Hint" : "Hide Hint";
}

function checkAnswer(selectedWord, selectedId) {
  if (answered) return;
  answered = true;

  const q = currentQuestion;
  const correctVocab = vocabMap[q.wordId];
  if (!correctVocab) return;

  const isCorrect = selectedId === q.wordId;
  recordAnswer(q.wordId, isCorrect);
  if (isCorrect) sessionCorrect++;
  else if (!sessionMistakes.some(item => item.wordId === q.wordId)) sessionMistakes.push(q);

  optionsContainer.querySelectorAll("button").forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === correctVocab.word) btn.classList.add("option-correct");
    else if (btn.textContent === selectedWord && !isCorrect) btn.classList.add("option-wrong");
  });

  resultContainer.innerHTML = buildAnswerFeedback(q, correctVocab, selectedWord, isCorrect);
  nextQuestionBtn.style.display = "inline-block";
}

function buildAnswerFeedback(q, correctVocab, selectedWord, isCorrect) {
  const wc = getWrongCounts();
  let html = '<div class="result-box ' + (isCorrect ? "result-correct" : "result-wrong") + '">';
  html += isCorrect
    ? '<p class="correct">&#10003; Correct!</p>'
    : '<p class="wrong">&#10007; Wrong!</p>';
  if (!isCorrect) html += "<p><strong>Your Answer:</strong> " + escapeHtml(selectedWord) + "</p>";
  html += "<p><strong>Correct Answer:</strong> " + escapeHtml(correctVocab.word) + "</p>";
  html += buildWordDetail(correctVocab);
  html += "<hr><p><strong>Option Explanations:</strong></p>";
  q.optionWordIds.forEach(wId => {
    const v = vocabMap[wId];
    if (!v) return;
    const isCor = wId === q.wordId;
    html += '<div class="explanation-item' + (isCor ? " explanation-correct" : "") + '">';
    html += "<strong>" + escapeHtml(v.word) + "</strong>";
    if (isCor) html += ' <span class="correct-badge">&#10003; Answer</span>';
    html += "<br>English: " + escapeHtml(v.english);
    html += "<br>中文: " + escapeHtml(v.chinese) + "</div>";
  });
  html += "<p class='wrong-count-note'>Wrong count for this word: <strong>" + (wc[q.wordId] || 0) + "</strong></p></div>";
  return html;
}

function buildWordDetail(vocab) {
  let html = '<div class="answer-detail">';
  html += "<p><strong>English:</strong> " + escapeHtml(vocab.english) + "</p>";
  html += "<p><strong>中文:</strong> " + escapeHtml(vocab.chinese) + "</p>";
  if (vocab.example_en) html += '<p class="example-sentence"><strong>Example:</strong> ' + escapeHtml(vocab.example_en) + "</p>";
  if (vocab.example_zh) html += '<p class="example-sentence-zh">' + escapeHtml(vocab.example_zh) + "</p>";
  if (vocab.synonyms && vocab.synonyms.length) html += "<p><strong>Synonyms:</strong> " + vocab.synonyms.map(escapeHtml).join(", ") + "</p>";
  if (vocab.antonyms && vocab.antonyms.length) html += "<p><strong>Antonyms:</strong> " + vocab.antonyms.map(escapeHtml).join(", ") + "</p>";
  html += "</div>";
  return html;
}

function showSessionComplete() {
  progressFill.style.width = "100%";
  questionCounter.textContent = "";
  optionsContainer.innerHTML = "";
  nextQuestionBtn.style.display = "none";
  const pct = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  const missed = sessionMistakes.length;
  questionContainer.innerHTML = "";
  resultContainer.innerHTML =
    '<div class="session-complete">' +
    "<h3>Session Complete!</h3>" +
    '<div class="session-score">' + pct + "%</div>" +
    '<p class="session-detail">Correct: ' + sessionCorrect + " / " + sessionTotal + "</p>" +
    '<p class="session-detail">Missed words: ' + missed + "</p>" +
    buildSessionMistakeList() +
    '<div class="session-actions">' +
    (missed > 0 ? '<button id="retryMistakesBtn">Retry Mistakes</button>' : "") +
    '<button id="smartAgainBtn">Smart Review Again</button>' +
    "</div></div>";
  const retryBtn = $("retryMistakesBtn");
  const smartAgainBtn = $("smartAgainBtn");
  if (retryBtn) retryBtn.addEventListener("click", retrySessionMistakes);
  if (smartAgainBtn) smartAgainBtn.addEventListener("click", () => {
    setPracticeMode("smart");
    startSession();
  });
  updateHomeStats();
}

function buildSessionMistakeList() {
  if (sessionMistakes.length === 0) return "";
  let html = '<div class="session-mistakes"><h4>Review These</h4>';
  sessionMistakes.forEach(q => {
    const v = vocabMap[q.wordId];
    if (!v) return;
    html += '<div class="session-mistake-item"><strong>' + escapeHtml(v.word) + "</strong> - " +
      escapeHtml(v.english) + " / " + escapeHtml(v.chinese) + "</div>";
  });
  html += "</div>";
  return html;
}

function retrySessionMistakes() {
  sessionQueue = shuffle([...sessionMistakes]);
  sessionIndex = 0;
  sessionCorrect = 0;
  sessionTotal = sessionQueue.length;
  sessionMistakes = [];
  answered = false;
  loadSessionQuestion();
}

nextQuestionBtn.addEventListener("click", () => { sessionIndex++; loadSessionQuestion(); });

// Practice mode toggle
document.querySelectorAll(".practice-mode-toggle button").forEach(btn => {
  btn.addEventListener("click", () => {
    setPracticeMode(btn.dataset.mode);
    startSession();
  });
});

// Also start session when changing POS / count / source
["posFilter", "questionCount", "questionSource"].forEach(id => {
  $(id).addEventListener("change", () => { if (practiceSection.classList.contains("active")) startSession(); });
});

// ===== Word Bank =====
function renderWordBank() {
  const wc = getWrongCounts(), cc = getCorrectCounts();
  const searchVal = wordBankSearch.value.toLowerCase();
  const posVal = $("wbPosFilter").value;
  const sortVal = $("wbSortBy").value;

  let list = vocabList;
  if (searchVal) {
    list = list.filter(v =>
      v.word.toLowerCase().includes(searchVal) ||
      v.english.toLowerCase().includes(searchVal) ||
      v.chinese.includes(searchVal)
    );
  }
  if (posVal) list = list.filter(v => v.pos === posVal);

  // Sort
  list = [...list];
  if (sortVal === "alpha") list.sort((a, b) => a.word.localeCompare(b.word));
  else if (sortVal === "alpha-desc") list.sort((a, b) => b.word.localeCompare(a.word));
  else if (sortVal === "wrong-desc") list.sort((a, b) => (wc[b.id] || 0) - (wc[a.id] || 0));
  else if (sortVal === "mastery-asc") list.sort((a, b) => getMastery(a.id) - getMastery(b.id));

  wordBankCount.textContent = list.length + " words";
  wordBankContainer.innerHTML = "";

  if (list.length === 0) {
    wordBankContainer.innerHTML = '<p class="empty-state">No matching words found.</p>';
    return;
  }

  // Render in batches of 50 for performance
  const BATCH = 50;
  let shown = 0;

  function renderBatch() {
    const end = Math.min(shown + BATCH, list.length);
    const frag = document.createDocumentFragment();
    for (let idx = shown; idx < end; idx++) {
      const item = list[idx];
      const card = document.createElement("div");
      card.className = "word-card";
      const wrong = wc[item.id] || 0;
      const correct = cc[item.id] || 0;
      const mastery = getMastery(item.id);
      const level = mastery >= 80 ? "high" : mastery >= 40 ? "mid" : "low";

      let html = "<h3>" + escapeHtml(item.word) + ' <span class="pos-tag">' + escapeHtml(item.pos) + "</span>";
      if (wrong > 0) html += ' <span class="wrong-badge">' + wrong + " wrong</span>";
      if (correct > 0) html += ' <span class="correct-count-badge">' + correct + " correct</span>";
      html += "</h3>";
      html += "<p><strong>English:</strong> " + escapeHtml(item.english) + "</p>";
      html += "<p><strong>中文:</strong> " + escapeHtml(item.chinese) + "</p>";
      if (item.example_en)
        html += '<p class="example-sentence"><strong>Example:</strong> ' + escapeHtml(item.example_en) + "</p>";
      if (item.example_zh)
        html += '<p class="example-sentence-zh">' + escapeHtml(item.example_zh) + "</p>";
      if (item.synonyms && item.synonyms.length)
        html += "<p><strong>Synonyms:</strong> " + item.synonyms.map(escapeHtml).join(", ") + "</p>";
      if (item.antonyms && item.antonyms.length)
        html += "<p><strong>Antonyms:</strong> " + item.antonyms.map(escapeHtml).join(", ") + "</p>";
      if (correct + wrong > 0) {
        html += '<div class="mastery-bar"><div class="mastery-fill ' + level + '" style="width: ' + mastery + '%"></div></div>';
        html += '<div class="mastery-text">Mastery: ' + mastery + "%</div>";
      }
      card.innerHTML = html;
      frag.appendChild(card);
    }
    // Remove old "Load More" button if present
    const oldBtn = wordBankContainer.querySelector(".load-more-btn");
    if (oldBtn) oldBtn.remove();
    wordBankContainer.appendChild(frag);
    shown = end;
    if (shown < list.length) {
      const moreBtn = document.createElement("button");
      moreBtn.className = "load-more-btn";
      moreBtn.textContent = "Load More (" + (list.length - shown) + " remaining)";
      moreBtn.addEventListener("click", renderBatch);
      wordBankContainer.appendChild(moreBtn);
    }
  }

  renderBatch();
}

wordBankSearch.addEventListener("input", renderWordBank);
$("wbPosFilter").addEventListener("change", renderWordBank);
$("wbSortBy").addEventListener("change", renderWordBank);

// ===== Statistics =====
let currentStatsTab = "wrong";

document.querySelectorAll(".stats-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".stats-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentStatsTab = tab.dataset.tab;
    renderStats();
  });
});

function renderStats() {
  const wc = getWrongCounts(), cc = getCorrectCounts(), rt = getReviewTimes();
  statsContainer.innerHTML = "";

  let list;
  if (currentStatsTab === "wrong") {
    list = vocabList.filter(v => (wc[v.id] || 0) > 0).sort((a, b) => (wc[b.id] || 0) - (wc[a.id] || 0));
    if (list.length === 0) { statsContainer.innerHTML = '<p class="empty-state">No wrong answers yet. Keep practicing!</p>'; return; }
    list.forEach(item => renderStatCard(item, wc, cc, rt));
  } else if (currentStatsTab === "mastery") {
    list = vocabList.filter(v => ((wc[v.id] || 0) + (cc[v.id] || 0)) > 0).sort((a, b) => getMastery(a.id) - getMastery(b.id));
    if (list.length === 0) { statsContainer.innerHTML = '<p class="empty-state">No practice data yet.</p>'; return; }
    list.forEach(item => renderStatCard(item, wc, cc, rt));
  } else if (currentStatsTab === "recent") {
    list = vocabList.filter(v => rt[v.id]).sort((a, b) => (rt[b.id] || 0) - (rt[a.id] || 0));
    if (list.length === 0) { statsContainer.innerHTML = '<p class="empty-state">No reviews yet.</p>'; return; }
    list.forEach(item => renderStatCard(item, wc, cc, rt));
  }
}

function renderStatCard(item, wc, cc, rt) {
  const div = document.createElement("div");
  div.className = "word-card";
  const wrong = wc[item.id] || 0;
  const correct = cc[item.id] || 0;
  const mastery = getMastery(item.id);
  const level = mastery >= 80 ? "high" : mastery >= 40 ? "mid" : "low";
  const reviewed = rt[item.id] ? new Date(rt[item.id]).toLocaleDateString() : "—";

  let html = "<h3>" + escapeHtml(item.word) + ' <span class="pos-tag">' + escapeHtml(item.pos) + "</span>";
  if (wrong > 0) html += ' <span class="wrong-badge">' + wrong + " wrong</span>";
  if (correct > 0) html += ' <span class="correct-count-badge">' + correct + " correct</span>";
  html += "</h3>";
  html += "<p>" + escapeHtml(item.english) + " — " + escapeHtml(item.chinese) + "</p>";
  html += '<div class="mastery-bar"><div class="mastery-fill ' + level + '" style="width: ' + mastery + '%"></div></div>';
  html += '<div class="mastery-text">Mastery: ' + mastery + "% · Last reviewed: " + reviewed + "</div>";
  div.innerHTML = html;
  statsContainer.appendChild(div);
}

// ===== Progress Tools =====
function refreshVisibleViews() {
  updateHomeStats();
  if (wordBankSection.classList.contains("active")) renderWordBank();
  if (statsSection.classList.contains("active")) renderStats();
}

function exportProgress() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "gre-vocab-site",
    progress: {}
  };
  PROGRESS_KEYS.forEach(key => { payload.progress[key] = getStore(key); });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gre-vocab-progress.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importProgress(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const progress = parsed.progress || parsed;
      PROGRESS_KEYS.forEach(key => setStore(key, progress[key] || {}));
      refreshVisibleViews();
      alert("Progress imported.");
    } catch (err) {
      alert("Could not import this progress file.");
    } finally {
      importProgressInput.value = "";
    }
  };
  reader.readAsText(file);
}

function resetProgress() {
  if (!confirm("Reset all local practice progress on this browser?")) return;
  PROGRESS_KEYS.forEach(key => localStorage.removeItem(key));
  refreshVisibleViews();
}

exportProgressBtn.addEventListener("click", exportProgress);
importProgressBtn.addEventListener("click", () => importProgressInput.click());
importProgressInput.addEventListener("change", () => importProgress(importProgressInput.files[0]));
resetProgressBtn.addEventListener("click", resetProgress);

// ===== Keyboard Shortcuts =====
document.addEventListener("keydown", event => {
  if (!practiceSection.classList.contains("active")) return;
  if (event.target.matches("input, select, textarea")) return;

  if (!answered && /^[1-4]$/.test(event.key)) {
    const option = optionsContainer.querySelectorAll("button")[Number(event.key) - 1];
    if (option) option.click();
  } else if (answered && event.key === "Enter" && nextQuestionBtn.style.display !== "none") {
    nextQuestionBtn.click();
  } else if (event.key.toLowerCase() === "h") {
    toggleHint();
  }
});

// ===== Utility =====
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ===== Init =====
loadData();
