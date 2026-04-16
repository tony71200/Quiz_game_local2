// ============================================================
// Quiz Game Server — server.js
// Express + Socket.IO + QR Code
// Server-authoritative architecture
// Phases: main_slide → lobby → question → reveal → scoreboard
//         → slide → elimination → final → summary → thankyou
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = 3000;

// ── Load Config & Questions ─────────────────────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const questionsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

// ── Static Files ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──────────────────────────────────────────────────
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'index.html'));
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

// ── LAN IP Detection ────────────────────────────────────────
function getAllLanIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  ips.sort((a, b) => {
    const priority = (ip) => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (ip.startsWith('172.')) return 2;
      return 3;
    };
    return priority(a.address) - priority(b.address);
  });
  return ips;
}

function getLanIP() {
  const ips = getAllLanIPs();
  return ips.length > 0 ? ips[0].address : 'localhost';
}

// ── Game State ──────────────────────────────────────────────
let gameState = {
  phase: 'main_slide',
  teams: [],
  currentRound: 0,
  currentQuestionIndex: 0,
  currentQuestion: null,
  shuffledAnswers: null,
  timeLeft: 0,
  totalTime: 0,
  paused: false,
  answersSubmitted: {},
  hostSocketId: null,
  slideIndex: 0,
  tieBreak: null
};

let timerInterval = null;
const STATE_FILE = path.join(__dirname, 'game_state.json');
const HISTORY_FILE = path.join(__dirname, 'match_history.json');

// ── Persistence ─────────────────────────────────────────────
function saveState() {
  try {
    const stateToSave = { ...gameState };
    delete stateToSave.timer;
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

function saveHistory(matchData) {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    history.push(matchData);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save history:', e.message);
  }
}

// ── Question Helpers ────────────────────────────────────────
function getQuestionsForRound(roundNumber) {
  const round = questionsData.rounds.find(r => r.round === roundNumber);
  return round ? round.questions : [];
}

function getAllTieBreakQuestions() {
  return questionsData.rounds
    .filter(r => r.round >= 99)
    .flatMap(r => r.questions.map(question => ({
      ...question,
      __tieBreakKey: `round:${r.round}:question:${question.id || question.text}`
    })));
}

function getUnusedTieBreakQuestion() {
  const allTieBreakQuestions = getAllTieBreakQuestions();
  const usedKeys = new Set(gameState.tieBreak?.usedQuestionKeys || []);
  const candidates = allTieBreakQuestions.filter(q => !usedKeys.has(q.__tieBreakKey));
  if (candidates.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

function shuffleAnswers(question) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    text: question.text,
    answers: indices.map(i => question.answers[i]),
    correctIndex: indices.indexOf(question.correct_index),
    originalQuestion: question,
    shuffleMap: indices,
    timeLimit: question.time_limit || config.rounds[gameState.currentRound]?.timer || 30,
    slideImage: question.slide_image || null
  };
}

function getConfiguredSlideImage(key, fallback) {
  const configured = questionsData[key];
  return typeof configured === 'string' && configured.trim() ? configured : fallback;
}

function getSlideImages() {
  return {
    main_slide: getConfiguredSlideImage('main_slide', '/assets/slides/main_slide.jpg'),
    summary_slide: getConfiguredSlideImage('summary_slide', '/assets/slides/summary_slide.jpg'),
    thank_slide: getConfiguredSlideImage('thank_slide', '/assets/slides/thank_slide.svg')
  };
}

function getPhaseSlideImage(phase) {
  const slides = getSlideImages();
  if (phase === 'main_slide') return slides.main_slide;
  if (phase === 'summary') return slides.summary_slide;
  if (phase === 'thankyou') return slides.thank_slide;
  return null;
}

function hasQuestionSlideImage(question) {
  return typeof question?.slide_image === 'string' && question.slide_image.trim().length > 0;
}

// ── Scoring ─────────────────────────────────────────────────
function calculateScore(timeLeft, totalTime) {
  // SKILL.md formula: score = 40 + 60 * (time_left / total_time)
  return Math.floor(config.scoring.baseScore + config.scoring.timeBonus * (timeLeft / totalTime));
}

// ── Timer ───────────────────────────────────────────────────
function startTimer() {
  clearTimer();
  timerInterval = setInterval(() => {
    if (gameState.paused) return;

    gameState.timeLeft--;

    io.emit('timer_tick', {
      timeLeft: gameState.timeLeft,
      totalTime: gameState.totalTime
    });

    if (gameState.timeLeft <= 0) {
      clearTimer();
      endQuestion();
    }
  }, 1000);
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ── Broadcast Helpers ───────────────────────────────────────
function teamPublicData(t) {
  return {
    id: t.id, name: t.name, icon: t.icon, color: t.color,
    score: t.score, roundScore: t.roundScore, eliminated: t.eliminated
  };
}

function broadcastGameState(extra = {}) {
  io.emit('game_state', buildGameStatePayload(extra));
}

function buildGameStatePayload(extra = {}) {
  const phaseSlideImage = getPhaseSlideImage(gameState.phase);
  return {
    phase: gameState.phase,
    currentRound: gameState.currentRound,
    currentQuestionIndex: gameState.currentQuestionIndex,
    roundConfig: config.rounds[gameState.currentRound],
    teams: gameState.teams.map(teamPublicData),
    tieBreak: gameState.tieBreak?.active ? {
      active: true,
      participants: gameState.tieBreak.participants,
      scores: gameState.tieBreak.scores
    } : { active: false },
    slideImages: getSlideImages(),
    ...(phaseSlideImage ? { slideImage: phaseSlideImage } : {}),
    ...extra
  };
}

// ── Game Flow Functions ─────────────────────────────────────

function showMainSlide() {
  gameState.phase = 'main_slide';
  broadcastGameState({ slideImage: getConfiguredSlideImage('main_slide', '/assets/slides/main_slide.jpg') });
  saveState();
  console.log('[Phase] → MAIN_SLIDE');
}

function startQuestion() {
  const roundConfig = config.rounds[gameState.currentRound];
  if (!roundConfig) {
    showFinal();
    return;
  }

  const roundNum = roundConfig.round;
  const questions = getQuestionsForRound(roundNum);

  if (gameState.currentQuestionIndex >= questions.length) {
    endRound();
    return;
  }

  const question = questions[gameState.currentQuestionIndex];
  const shuffled = shuffleAnswers(question);

  gameState.phase = 'question';
  gameState.currentQuestion = question;
  gameState.shuffledAnswers = shuffled;
  gameState.totalTime = shuffled.timeLimit;
  gameState.timeLeft = shuffled.timeLimit;
  gameState.paused = false;
  gameState.answersSubmitted = {};

  const roundData = questionsData.rounds.find(r => r.round === roundNum);
  const questionPayload = {
    questionText: shuffled.text,
    answers: shuffled.answers,
    questionNumber: gameState.currentQuestionIndex + 1,
    totalQuestions: questions.length,
    roundNumber: roundConfig.round,
    roundName: roundData?.name || `Round ${roundNum}`,
    timeLimit: shuffled.timeLimit,
    totalTime: shuffled.timeLimit
  };

  broadcastGameState({ question: questionPayload });
  saveState();
  startTimer();
  console.log(`[Phase] → QUESTION R${roundNum} Q${gameState.currentQuestionIndex + 1}`);
}

function endQuestion() {
  clearTimer();
  gameState.phase = 'reveal';

  const shuffled = gameState.shuffledAnswers;
  const tieBreak = gameState.tieBreak;
  const activeTeams = tieBreak?.active
    ? gameState.teams.filter(t => tieBreak.participants.includes(t.id))
    : gameState.teams.filter(t => !t.eliminated);

  // Calculate scores for all active teams
  activeTeams.forEach(team => {
    const submission = gameState.answersSubmitted[team.id];
    let scoreGained = 0;
    let isCorrect = false;

    if (submission && submission.answerIndex === shuffled.correctIndex) {
      isCorrect = true;
      scoreGained = calculateScore(submission.timeLeft, gameState.totalTime);
    }

    if (tieBreak?.active) {
      tieBreak.scores[team.id] = (tieBreak.scores[team.id] || 0) + scoreGained;
    } else {
      team.score += scoreGained;
      team.roundScore += scoreGained;
    }

    // Personal result → sent to each client ONLY NOW (after timer ends)
    if (team.socketId) {
      io.to(team.socketId).emit('personal_result', {
        isCorrect,
        score: scoreGained,
        totalScore: team.score
      });
    }
  });

  // Build answer stats
  const answerCounts = new Array(4).fill(0);
  Object.values(gameState.answersSubmitted).forEach(sub => {
    if (sub.answerIndex >= 0 && sub.answerIndex < 4) {
      answerCounts[sub.answerIndex]++;
    }
  });

  const totalAnswers = activeTeams.length;
  const answerStats = shuffled.answers.map((text, idx) => ({
    index: idx,
    text,
    count: answerCounts[idx],
    percent: totalAnswers > 0 ? Math.round((answerCounts[idx] / totalAnswers) * 100) : 0,
    isCorrect: idx === shuffled.correctIndex
  }));

  const roundConfig = config.rounds[gameState.currentRound];
  const roundNum = roundConfig.round;
  const questions = getQuestionsForRound(roundNum);

  broadcastGameState({
    correctIndex: shuffled.correctIndex,
    answerStats,
    question: {
      questionText: shuffled.text,
      answers: shuffled.answers,
      questionNumber: gameState.currentQuestionIndex + 1,
      totalQuestions: questions.length,
      roundNumber: roundNum
    },
    tieBreak: tieBreak?.active ? {
      active: true,
      participants: tieBreak.participants,
      scores: tieBreak.scores
    } : { active: false }
  });

  io.emit('answer_stats', answerStats);
  io.emit('play_sound', { sound: 'reveal' });
  saveState();
  console.log('[Phase] → REVEAL');
}

function showScoreboard() {
  gameState.phase = 'scoreboard';
  if (gameState.tieBreak?.active) {
    const participantSet = new Set(gameState.tieBreak.participants);
    const sortedParticipants = gameState.teams
      .filter(t => participantSet.has(t.id))
      .sort((a, b) => (gameState.tieBreak.scores[b.id] || 0) - (gameState.tieBreak.scores[a.id] || 0))
      .map(team => ({
        ...teamPublicData(team),
        tieBreakScore: gameState.tieBreak.scores[team.id] || 0
      }));
    broadcastGameState({
      rankedTeams: sortedParticipants,
      tieBreak: {
        active: true,
        participants: gameState.tieBreak.participants,
        scores: gameState.tieBreak.scores
      }
    });
  } else {
    const sortedTeams = [...gameState.teams].sort((a, b) => b.score - a.score);
    broadcastGameState({ rankedTeams: sortedTeams.map(teamPublicData) });
  }
  saveState();
  console.log('[Phase] → SCOREBOARD');
}

function showSlide() {
  if (gameState.tieBreak?.active) {
    nextQuestion();
    return;
  }

  if (!hasQuestionSlideImage(gameState.currentQuestion)) {
    nextQuestion();
    return;
  }

  gameState.phase = 'slide';
  const slideImage = gameState.currentQuestion.slide_image.trim();
  broadcastGameState({ slideImage });
  saveState();
  console.log('[Phase] → SLIDE');
}

function nextQuestion() {
  if (gameState.tieBreak?.active) {
    continueTieBreak();
    return;
  }

  gameState.currentQuestionIndex++;
  const roundConfig = config.rounds[gameState.currentRound];
  const questions = getQuestionsForRound(roundConfig.round);

  if (gameState.currentQuestionIndex >= questions.length) {
    endRound();
  } else {
    startQuestion();
  }
}

function endRound() {
  const roundConfig = config.rounds[gameState.currentRound];
  const isLastRound = gameState.currentRound >= config.rounds.length - 1;

  if (isLastRound) {
    showFinal();
    return;
  }

  gameState.phase = 'elimination';

  const activeTeams = gameState.teams
    .filter(t => !t.eliminated)
    .sort((a, b) => b.score - a.score);

  const advanceCount = roundConfig.advanceCount;

  const tieBreakPlan = buildTieBreakPlan(activeTeams, advanceCount);
  if (tieBreakPlan) {
    startTieBreak(tieBreakPlan);
    return;
  }

  if (activeTeams.length > advanceCount) {
    const teamsToEliminate = activeTeams.slice(advanceCount);
    teamsToEliminate.forEach(team => {
      team.eliminated = true;
      if (team.socketId) {
        io.to(team.socketId).emit('eliminated', {
          message: 'Cảm ơn bạn đã tham gia! Đội bạn đã bị loại.'
        });
      }
    });
    io.emit('play_sound', { sound: 'eliminated' });
  }

  broadcastGameState({
    eliminatedTeams: gameState.teams.filter(t => t.eliminated).map(t => t.id),
    advancingTeams: gameState.teams.filter(t => !t.eliminated).map(t => t.id)
  });
  saveState();
  console.log('[Phase] → ELIMINATION');
}

function buildTieBreakPlan(activeTeams, advanceCount) {
  if (activeTeams.length <= advanceCount || advanceCount <= 0) return null;

  const cutoffScore = activeTeams[advanceCount - 1]?.score;
  if (typeof cutoffScore !== 'number') return null;

  const lockedAdvancers = activeTeams.filter(t => t.score > cutoffScore).map(t => t.id);
  const tieParticipants = activeTeams.filter(t => t.score === cutoffScore).map(t => t.id);
  const autoEliminated = activeTeams.filter(t => t.score < cutoffScore).map(t => t.id);
  const slotsLeft = advanceCount - lockedAdvancers.length;

  if (slotsLeft <= 0) return null;
  if (tieParticipants.length <= slotsLeft) return null;

  return {
    active: true,
    roundIndex: gameState.currentRound,
    roundNumber: config.rounds[gameState.currentRound]?.round,
    lockedAdvancers,
    participants: tieParticipants,
    autoEliminated,
    slotsLeft,
    scores: Object.fromEntries(tieParticipants.map(id => [id, 0])),
    usedQuestionKeys: gameState.tieBreak?.usedQuestionKeys || []
  };
}

function startTieBreak(tieBreakPlan) {
  gameState.tieBreak = tieBreakPlan;
  console.log(`[TieBreak] Start with ${tieBreakPlan.participants.length} teams for ${tieBreakPlan.slotsLeft} slots`);
  startTieBreakQuestion();
}

function startTieBreakQuestion() {
  const tieBreakQuestion = getUnusedTieBreakQuestion();
  if (!tieBreakQuestion) {
    console.log('[TieBreak] No unused tie-break questions available, falling back to score order');
    finalizeTieBreakByCurrentOrder();
    return;
  }

  gameState.tieBreak.usedQuestionKeys.push(tieBreakQuestion.__tieBreakKey);
  const shuffled = shuffleAnswers(tieBreakQuestion);

  gameState.phase = 'question';
  gameState.currentQuestion = tieBreakQuestion;
  gameState.shuffledAnswers = shuffled;
  gameState.totalTime = shuffled.timeLimit;
  gameState.timeLeft = shuffled.timeLimit;
  gameState.paused = false;
  gameState.answersSubmitted = {};

  const participants = gameState.tieBreak.participants;
  broadcastGameState({
    question: {
      questionText: shuffled.text,
      answers: shuffled.answers,
      questionNumber: 1,
      totalQuestions: 1,
      roundNumber: gameState.tieBreak.roundNumber,
      roundName: 'Tie Break',
      timeLimit: shuffled.timeLimit,
      totalTime: shuffled.timeLimit
    },
    tieBreak: {
      active: true,
      participants
    }
  });
  saveState();
  startTimer();
  console.log(`[Phase] → QUESTION (TIE BREAK, participants: ${participants.length})`);
}

function continueTieBreak() {
  const tieBreak = gameState.tieBreak;
  if (!tieBreak?.active) return;

  if (tieBreak.slotsLeft <= 0) {
    const advancing = new Set(tieBreak.lockedAdvancers);
    const activeTeamIds = new Set(gameState.teams.filter(t => !t.eliminated).map(t => t.id));
    const eliminated = [...activeTeamIds].filter(teamId => !advancing.has(teamId));
    eliminated.forEach(teamId => {
      const team = gameState.teams.find(t => t.id === teamId);
      if (!team) return;
      team.eliminated = true;
      if (team.socketId) {
        io.to(team.socketId).emit('eliminated', {
          message: 'Cảm ơn bạn đã tham gia! Đội bạn đã bị loại.'
        });
      }
    });
    if (eliminated.length > 0) {
      io.emit('play_sound', { sound: 'eliminated' });
    }
    gameState.phase = 'elimination';
    tieBreak.active = false;
    broadcastGameState({
      tieBreak: { active: false },
      eliminatedTeams: gameState.teams.filter(t => t.eliminated).map(t => t.id),
      advancingTeams: gameState.teams.filter(t => !t.eliminated).map(t => t.id)
    });
    saveState();
    console.log('[Phase] → ELIMINATION (tie-break locked)');
    return;
  }

  const participantTeams = gameState.teams
    .filter(t => tieBreak.participants.includes(t.id))
    .sort((a, b) => (tieBreak.scores[b.id] || 0) - (tieBreak.scores[a.id] || 0));

  const cutoffScore = tieBreak.scores[participantTeams[tieBreak.slotsLeft - 1]?.id] ?? null;
  if (cutoffScore === null) {
    finalizeTieBreakByCurrentOrder();
    return;
  }

  const fixedWinners = participantTeams
    .filter(t => (tieBreak.scores[t.id] || 0) > cutoffScore)
    .map(t => t.id);
  const tiedAtCutoff = participantTeams
    .filter(t => (tieBreak.scores[t.id] || 0) === cutoffScore)
    .map(t => t.id);
  const losersBelowCutoff = participantTeams
    .filter(t => (tieBreak.scores[t.id] || 0) < cutoffScore)
    .map(t => t.id);

  const slotsLeftAfterFixed = tieBreak.slotsLeft - fixedWinners.length;

  // Tie persists at cutoff → ask another tie-break question with narrowed participant group.
  if (tiedAtCutoff.length > slotsLeftAfterFixed) {
    tieBreak.lockedAdvancers = [...new Set([...tieBreak.lockedAdvancers, ...fixedWinners])];
    tieBreak.slotsLeft = slotsLeftAfterFixed;
    tieBreak.participants = tiedAtCutoff;
    tieBreak.autoEliminated = [...new Set([...tieBreak.autoEliminated, ...losersBelowCutoff])];
    tieBreak.participants.forEach(id => {
      if (typeof tieBreak.scores[id] !== 'number') tieBreak.scores[id] = 0;
    });
    startTieBreakQuestion();
    return;
  }

  const selectedFromTiedGroup = tiedAtCutoff.slice(0, slotsLeftAfterFixed);
  const advancing = [...new Set([...tieBreak.lockedAdvancers, ...fixedWinners, ...selectedFromTiedGroup])];
  const activeTeamIds = new Set(gameState.teams.filter(t => !t.eliminated).map(t => t.id));

  const eliminated = [...activeTeamIds].filter(teamId => !advancing.includes(teamId));
  eliminated.forEach(teamId => {
    const team = gameState.teams.find(t => t.id === teamId);
    if (!team) return;
    team.eliminated = true;
    if (team.socketId) {
      io.to(team.socketId).emit('eliminated', {
        message: 'Cảm ơn bạn đã tham gia! Đội bạn đã bị loại.'
      });
    }
  });
  if (eliminated.length > 0) {
    io.emit('play_sound', { sound: 'eliminated' });
  }

  gameState.phase = 'elimination';
  gameState.tieBreak.active = false;

  broadcastGameState({
    tieBreak: { active: false },
    eliminatedTeams: gameState.teams.filter(t => t.eliminated).map(t => t.id),
    advancingTeams: gameState.teams.filter(t => !t.eliminated).map(t => t.id)
  });
  saveState();
  console.log('[Phase] → ELIMINATION (after tie-break)');
}

function finalizeTieBreakByCurrentOrder() {
  const tieBreak = gameState.tieBreak;
  if (!tieBreak?.active) return;
  const participantTeams = gameState.teams
    .filter(t => tieBreak.participants.includes(t.id))
    .sort((a, b) => (tieBreak.scores[b.id] || 0) - (tieBreak.scores[a.id] || 0));
  const selected = participantTeams.slice(0, tieBreak.slotsLeft).map(t => t.id);
  tieBreak.lockedAdvancers = [...new Set([...tieBreak.lockedAdvancers, ...selected])];
  tieBreak.slotsLeft = 0;
  continueTieBreak();
}

function nextRound() {
  gameState.currentRound++;
  gameState.currentQuestionIndex = 0;
  gameState.teams.forEach(t => { t.roundScore = 0; });

  if (gameState.currentRound >= config.rounds.length) {
    showFinal();
  } else {
    startQuestion();
  }
}

function showFinal() {
  gameState.phase = 'final';
  clearTimer();

  const rankedTeams = [...gameState.teams].sort((a, b) => b.score - a.score);

  broadcastGameState({ rankedTeams: rankedTeams.map(teamPublicData) });
  io.emit('play_sound', { sound: 'victory' });

  saveHistory({
    date: new Date().toISOString(),
    teams: rankedTeams.map(teamPublicData),
    rounds: config.rounds.length
  });
  saveState();
  console.log('[Phase] → FINAL');
}

function showSummary() {
  gameState.phase = 'summary';
  const rankedTeams = [...gameState.teams].sort((a, b) => b.score - a.score);
  broadcastGameState({
    rankedTeams: rankedTeams.map(teamPublicData),
    slideImage: getConfiguredSlideImage('summary_slide', '/assets/slides/summary_slide.jpg')
  });
  saveState();
  console.log('[Phase] → SUMMARY');
}

function showThankYou() {
  gameState.phase = 'thankyou';
  broadcastGameState({ slideImage: getConfiguredSlideImage('thank_slide', '/assets/slides/thank_slide.svg') });
  saveState();
  console.log('[Phase] → THANKYOU');
}

function goToLobby() {
  // After thankyou, go back to lobby (keep host connection, clear teams)
  clearTimer();
  const hostSid = gameState.hostSocketId;
  gameState = {
    phase: 'lobby',
    teams: [],
    currentRound: 0,
    currentQuestionIndex: 0,
    currentQuestion: null,
    shuffledAnswers: null,
    timeLeft: 0,
    totalTime: 0,
    paused: false,
    answersSubmitted: {},
    hostSocketId: hostSid,
    slideIndex: 0,
    tieBreak: null
  };
  io.emit('game_reset');
  broadcastGameState();
  saveState();
  console.log('[Phase] → LOBBY');
}

function resetGame() {
  clearTimer();
  const hostSid = gameState.hostSocketId;
  gameState = {
    phase: 'main_slide',
    teams: [],
    currentRound: 0,
    currentQuestionIndex: 0,
    currentQuestion: null,
    shuffledAnswers: null,
    timeLeft: 0,
    totalTime: 0,
    paused: false,
    answersSubmitted: {},
    hostSocketId: hostSid,
    slideIndex: 0,
    tieBreak: null
  };
  io.emit('game_reset');
  broadcastGameState();
  saveState();
  console.log('[Phase] → RESET → MAIN_SLIDE');
}

// ── Socket.IO ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Init ──
  socket.emit('init', {
    phase: gameState.phase,
    teams: gameState.teams.map(teamPublicData),
    config: config,
    state: buildGameStatePayload(),
    slideImages: getSlideImages(),
    lanIP: getLanIP(),
    port: PORT
  });

  socket.emit('game_state', buildGameStatePayload());

  // ── Host Join ──
  socket.on('host_join', async () => {
    gameState.hostSocketId = socket.id;
    const lanIP = getLanIP();
    const allIPs = getAllLanIPs();
    const url = `http://${lanIP}:${PORT}`;

    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    } catch (e) {
      console.error('QR generation failed:', e.message);
    }

    socket.emit('host_ready', {
      qrDataUrl,
      url,
      allIPs,
      port: PORT,
      teams: gameState.teams.map(teamPublicData),
      config,
      state: buildGameStatePayload(),
      slideImages: getSlideImages()
    });
  });

  // ── Host Regen QR ──
  socket.on('host_regen_qr', async ({ ip }) => {
    const url = `http://${ip}:${PORT}`;
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    } catch (e) {
      console.error('QR regen failed:', e.message);
    }
    socket.emit('qr_updated', { qrDataUrl, url });
  });

  // ── Team Join ──
  socket.on('join_team', ({ name, icon }) => {
    if (!name || name.trim().length === 0 || name.trim().length > 20) {
      socket.emit('join_rejected', { reason: 'Tên đội phải từ 1-20 ký tự.' });
      return;
    }

    if (gameState.phase !== 'lobby' && gameState.phase !== 'main_slide') {
      socket.emit('join_rejected', { reason: 'Trò chơi đã bắt đầu.' });
      return;
    }

    if (gameState.teams.length >= config.maxTeams) {
      socket.emit('join_rejected', { reason: 'Phòng đã đầy (tối đa 4 đội).' });
      return;
    }

    if (gameState.teams.some(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
      socket.emit('join_rejected', { reason: 'Tên đội đã được sử dụng.' });
      return;
    }

    const teamId = `team_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const colorIndex = gameState.teams.length;

    const team = {
      id: teamId,
      name: name.trim(),
      icon: icon || config.icons[0],
      color: config.teamColors[colorIndex % config.teamColors.length],
      score: 0,
      roundScore: 0,
      eliminated: false,
      socketId: socket.id,
      answers: {}
    };

    gameState.teams.push(team);

    socket.emit('join_success', {
      team: { id: team.id, name: team.name, icon: team.icon, color: team.color },
      id: teamId
    });

    io.emit('team_update', {
      teams: gameState.teams.map(teamPublicData)
    });

    saveState();
    console.log(`[Team] ${team.name} (${team.icon}) joined`);
  });

  // ── Submit Answer ──
  socket.on('submit_answer', ({ answer }) => {
    if (gameState.phase !== 'question') return;
    if (gameState.paused) return;

    const team = gameState.teams.find(t => t.socketId === socket.id);
    if (!team || team.eliminated) return;
    if (gameState.tieBreak?.active && !gameState.tieBreak.participants.includes(team.id)) return;

    // Only allow one submission per question
    if (gameState.answersSubmitted[team.id]) return;

    gameState.answersSubmitted[team.id] = {
      answerIndex: answer,
      timeLeft: gameState.timeLeft,
      timestamp: Date.now()
    };

    socket.emit('answer_received', { answer });

    // Notify all about submission status (do NOT reveal result)
    const activeTeams = gameState.tieBreak?.active
      ? gameState.teams.filter(t => gameState.tieBreak.participants.includes(t.id))
      : gameState.teams.filter(t => !t.eliminated);
    const submittedCount = Object.keys(gameState.answersSubmitted).length;

    io.emit('submission_status', {
      submitted: submittedCount,
      total: activeTeams.length,
      teamId: team.id
    });

    // *** KEY CHANGE: Do NOT end question early ***
    // Timer must always run to 0. Host can still skip manually.
    console.log(`[Answer] ${team.name} submitted (${submittedCount}/${activeTeams.length})`);
  });

  // ── Host Actions ──
  socket.on('host_action', ({ action, data }) => {
    console.log(`[Host Action] ${action}`, data || '');

    switch (action) {
      case 'advance_main_slide':
        if (gameState.phase === 'main_slide') {
          gameState.phase = 'lobby';
          broadcastGameState();
          saveState();
          console.log('[Phase] → LOBBY');
        }
        break;

      case 'start_game':
        if (gameState.teams.length < config.minTeamsToStart) {
          socket.emit('host_error', { message: `Cần ít nhất ${config.minTeamsToStart} đội để bắt đầu.` });
          return;
        }
        gameState.currentRound = 0;
        gameState.currentQuestionIndex = 0;
        gameState.tieBreak = null;
        gameState.teams.forEach(t => { t.score = 0; t.roundScore = 0; t.eliminated = false; });
        startQuestion();
        break;

      case 'pause':
        gameState.paused = !gameState.paused;
        io.emit('game_paused', { paused: gameState.paused });
        break;

      case 'skip':
        if (gameState.phase === 'question') {
          clearTimer();
          endQuestion();
        }
        break;

      case 'next_after_reveal':
        if (gameState.phase === 'reveal') {
          showScoreboard();
        }
        break;

      case 'show_slide':
        if (gameState.phase === 'scoreboard') {
          showSlide();
        }
        break;

      case 'next_question':
        if (gameState.phase === 'slide' || gameState.phase === 'scoreboard') {
          nextQuestion();
        }
        break;

      case 'next_round':
        if (gameState.phase === 'elimination') {
          nextRound();
        }
        break;

      case 'show_final':
        showFinal();
        break;

      case 'show_summary':
        if (gameState.phase === 'final') {
          showSummary();
        }
        break;

      case 'show_thankyou':
        if (gameState.phase === 'summary') {
          showThankYou();
        }
        break;

      case 'go_to_lobby':
        if (gameState.phase === 'thankyou') {
          goToLobby();
        }
        break;

      case 'reset':
        resetGame();
        break;

      default:
        console.log(`[Host Action] Unknown: ${action}`);
    }
  });

  // ── Reconnection ──
  socket.on('reconnect_team', ({ teamId }) => {
    const team = gameState.teams.find(t => t.id === teamId);
    if (team) {
      team.socketId = socket.id;
      console.log(`[Team] ${team.name} reconnected`);
      socket.emit('reconnect_success', {
        team: teamPublicData(team),
        phase: gameState.phase
      });
    }
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const team = gameState.teams.find(t => t.socketId === socket.id);
    if (team) {
      team.socketId = null;
      console.log(`[Team] ${team.name} disconnected (kept in game)`);
    }
  });
});

// ── Start Server ────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIP();
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║        🎮 QUIZ GAME SERVER           ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Host  : http://${ip}:${PORT}/host`);
  console.log(`║  Client: http://${ip}:${PORT}`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
