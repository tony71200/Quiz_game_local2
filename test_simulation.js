// ============================================================
// Quiz Game — Test Simulation
// Simulates 4 clients joining and playing through the game
// Usage: node test_simulation.js
// ============================================================

const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

const TEAM_DATA = [
  { name: 'Đội Rồng', icon: '🐉' },
  { name: 'Đội Sư Tử', icon: '🦁' },
  { name: 'Đội Đại Bàng', icon: '🦅' },
  { name: 'Đội Cáo', icon: '🦊' }
];

// Track state
let host = null;
let clients = [];
let phase = 'lobby';
let questionCount = 0;
let roundInfo = '';

function log(prefix, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${prefix}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Create Host ─────────────────────────────────
function createHost() {
  return new Promise((resolve) => {
    host = io(SERVER_URL);

    host.on('connect', () => {
      log('HOST', '✅ Connected');
      host.emit('host_join');
    });

    host.on('host_ready', (data) => {
      log('HOST', `📱 QR URL: ${data.url}`);
      log('HOST', `🔗 Teams: ${data.teams.length}`);
      resolve();
    });

    host.on('game_state', (state) => {
      phase = state.phase;
      log('HOST', `📍 Phase: ${state.phase.toUpperCase()}`);

      if (state.question) {
        log('HOST', `  ❓ Q${state.question.questionNumber}/${state.question.totalQuestions}: "${state.question.questionText.substring(0, 50)}..."`);
      }

      if (state.rankedTeams) {
        state.rankedTeams.forEach((t, i) => {
          log('HOST', `  ${['🥇','🥈','🥉','4️⃣'][i]} ${t.name}: ${t.score} pts${t.eliminated ? ' ❌ ELIMINATED' : ''}`);
        });
      }

      if (state.answerStats) {
        state.answerStats.forEach(s => {
          log('HOST', `  ${s.isCorrect ? '✅' : '  '} Option ${s.index}: ${s.percent}%`);
        });
      }
    });

    host.on('team_update', (data) => {
      log('HOST', `👥 Team update: ${data.teams.length} teams`);
      data.teams.forEach(t => {
        log('HOST', `  ${t.icon} ${t.name} (${t.color})`);
      });
    });

    host.on('timer_tick', ({ timeLeft }) => {
      if (timeLeft % 10 === 0 || timeLeft <= 5) {
        log('HOST', `  ⏱️ Timer: ${timeLeft}s`);
      }
    });

    host.on('game_paused', ({ paused }) => {
      log('HOST', `${paused ? '⏸ PAUSED' : '▶ RESUMED'}`);
    });

    host.on('game_reset', () => {
      log('HOST', '🔄 Game reset');
      phase = 'main_slide';
    });

    host.on('host_error', ({ message }) => {
      log('HOST', `⚠️ Error: ${message}`);
    });

    host.on('disconnect', () => {
      log('HOST', '❌ Disconnected');
    });
  });
}

// ── Create Client ───────────────────────────────
function createClient(teamData, index) {
  return new Promise((resolve) => {
    const client = io(SERVER_URL);
    const prefix = `CLIENT-${index + 1}`;
    let teamId = null;
    let eliminated = false;

    client.on('connect', () => {
      log(prefix, `✅ Connected (${teamData.icon} ${teamData.name})`);
    });

    client.on('init', () => {
      // Join after a small delay
      setTimeout(() => {
        log(prefix, `📤 Joining as "${teamData.name}" ${teamData.icon}`);
        client.emit('join_team', { name: teamData.name, icon: teamData.icon });
      }, 500 + index * 300);
    });

    client.on('join_success', ({ team, id }) => {
      teamId = id;
      log(prefix, `✅ Joined! Team: ${team.name} Color: ${team.color}`);
      resolve({ client, teamId, teamData, prefix, eliminated: false });
    });

    client.on('join_rejected', ({ reason }) => {
      log(prefix, `❌ Join rejected: ${reason}`);
      resolve(null);
    });

    client.on('game_state', (state) => {
      if (eliminated) return;

      switch (state.phase) {
        case 'main_slide':
        case 'lobby':
          // Clients wait on join/lobby screen
          break;

        case 'question':
          if (state.question) {
            // Submit a random answer after 2-8 seconds
            const delay = 2000 + Math.random() * 6000;
            const answerIdx = Math.floor(Math.random() * 4);
            log(prefix, `❓ Received question. Will answer "${['A','B','C','D'][answerIdx]}" in ${(delay/1000).toFixed(1)}s`);

            setTimeout(() => {
              if (!eliminated) {
                client.emit('submit_answer', { answer: answerIdx });
                log(prefix, `📤 Submitted answer: ${'ABCD'[answerIdx]}`);
              }
            }, delay);
          }
          break;

        case 'elimination':
          const myInfo = state.teams?.find(t => t.id === teamId);
          if (myInfo && myInfo.eliminated) {
            eliminated = true;
            log(prefix, '💀 ELIMINATED');
          }
          break;

        case 'final':
          log(prefix, '🎉 Game over!');
          break;

        case 'thankyou':
          log(prefix, '🙏 Thank you!');
          break;
      }
    });

    client.on('personal_result', ({ isCorrect, score, totalScore }) => {
      log(prefix, `${isCorrect ? '✅ CORRECT' : '❌ WRONG'} +${score} pts (Total: ${totalScore})`);
    });

    client.on('answer_received', () => {
      log(prefix, '📨 Answer confirmed, waiting for timer...');
    });

    client.on('eliminated', ({ message }) => {
      eliminated = true;
      log(prefix, `💀 ${message}`);
    });

    client.on('game_reset', () => {
      eliminated = false;
      log(prefix, '🔄 Game reset');
    });

    client.on('disconnect', () => {
      log(prefix, '❌ Disconnected');
    });
  });
}

// ── Host Action Helper ──────────────────────────
function hostAction(action, data = {}) {
  log('HOST', `🕹️ Sending action: ${action}`);
  host.emit('host_action', { action, data });
}

// ── Wait for Phase ──────────────────────────────
function waitForPhase(targetPhase, timeout = 60000) {
  return new Promise((resolve, reject) => {
    if (phase === targetPhase) return resolve();

    const checkInterval = setInterval(() => {
      if (phase === targetPhase) {
        clearInterval(checkInterval);
        clearTimeout(timer);
        resolve();
      }
    }, 200);

    const timer = setTimeout(() => {
      clearInterval(checkInterval);
      log('TEST', `⚠️ Timeout waiting for phase: ${targetPhase} (current: ${phase})`);
      resolve(); // Don't reject, continue test
    }, timeout);
  });
}

// ── Main Test Sequence ──────────────────────────
async function runTest() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🧪 QUIZ GAME — AUTOMATED TEST SIMULATION');
  console.log('═'.repeat(60) + '\n');

  // Step 1: Create host
  log('TEST', '📡 Step 1: Creating host...');
  await createHost();
  await sleep(1000);

  // Step 2: Create 4 clients
  log('TEST', '📱 Step 2: Creating 4 clients...');
  const clientPromises = TEAM_DATA.map((td, i) => createClient(td, i));
  const clientResults = await Promise.all(clientPromises);
  clients = clientResults.filter(c => c !== null);
  log('TEST', `✅ ${clients.length} clients joined successfully`);
  await sleep(2000);

  // Step 3: Advance from main slide to lobby
  log('TEST', '▶ Step 3: Advancing from main slide to lobby...');
  hostAction('advance_main_slide');
  await waitForPhase('lobby');
  await sleep(2000);

  // Step 4: Start game (goes directly to question)
  log('TEST', '🚀 Step 4: Starting game...');
  hostAction('start_game');
  await waitForPhase('question');
  await sleep(1000);

  // Step 5: Game loop — process questions
  let safetyCounter = 0;
  const maxIterations = 30;

  while (phase !== 'final' && safetyCounter < maxIterations) {
    safetyCounter++;

    if (phase === 'question') {
      log('TEST', '⏳ Waiting for timer to end...');
      await waitForPhase('reveal', 40000);
      await sleep(1500);
    }

    if (phase === 'reveal') {
      log('TEST', '→ Advancing to scoreboard...');
      hostAction('next_after_reveal');
      await waitForPhase('scoreboard');
      await sleep(1500);
    }

    if (phase === 'scoreboard') {
      log('TEST', '→ Advancing to slide...');
      hostAction('show_slide');
      await waitForPhase('slide');
      await sleep(1500);
    }

    if (phase === 'slide') {
      log('TEST', '→ Next question...');
      hostAction('next_question');
      await sleep(2000);
    }

    if (phase === 'elimination') {
      log('TEST', '→ Advancing to next round...');
      await sleep(2000);
      hostAction('next_round');
      await sleep(2000);
    }
  }

  // Step 6: Final results
  if (phase === 'final') {
    log('TEST', '🏆 FINAL RESULTS DISPLAYED');
    await sleep(3000);

    // Show summary
    log('TEST', '→ Showing summary...');
    hostAction('show_summary');
    await waitForPhase('summary');
    await sleep(3000);

    // Show thank you
    log('TEST', '→ Showing thank you...');
    hostAction('show_thankyou');
    await waitForPhase('thankyou');
    await sleep(3000);

    // Go back to lobby
    log('TEST', '→ Going back to lobby...');
    hostAction('go_to_lobby');
    await waitForPhase('lobby', 5000);
    await sleep(2000);
  }

  // Step 7: Reset to main slide
  log('TEST', '🔄 Step 7: Testing reset to main slide...');
  hostAction('reset');
  await waitForPhase('main_slide', 5000);
  await sleep(2000);

  // Done
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ TEST COMPLETE');
  console.log('═'.repeat(60) + '\n');

  // Cleanup
  clients.forEach(c => c.client.disconnect());
  host.disconnect();

  setTimeout(() => process.exit(0), 1000);
}

// ── Run ─────────────────────────────────────────
runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
