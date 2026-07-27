// DAILY GOAL ASSESSMENT + BEHAVIORAL FEEDBACK ENGINE
// Reflects on winning streaks and banked profit to encourage discipline and
// discourage overtrading (after a goal is hit) and revenge trading (after a loss).

function groupPnlByDate(tradeList) {
  const map = {};
  tradeList.forEach(t => {
    if (t.pnl === null || t.pnl === undefined) return; // open positions haven't realized P&L yet
    map[t.date] = (map[t.date] || 0) + t.pnl;
  });
  return map;
}

function fmtMoney(n) {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `($${abs})` : `$${abs}`;
}

/**
 * Computes the daily-goal assessment for a given "today" date, using every
 * prior trading day in `tradeList` to derive streaks and banked reserve.
 */
function computeGoalAssessment(tradeList, dailyGoal, todayDate) {
  const byDate = groupPnlByDate(tradeList);
  const allDates = Object.keys(byDate).sort();

  if (!dailyGoal || dailyGoal <= 0) {
    return { hasGoal: false };
  }

  const priorDates = allDates.filter(d => d < todayDate);
  const todayPnl = byDate[todayDate] || 0;
  const hasTradedToday = Object.prototype.hasOwnProperty.call(byDate, todayDate);

  // Streak: consecutive prior trading days (most recent first) that met the goal.
  let streak = 0;
  for (let i = priorDates.length - 1; i >= 0; i--) {
    if (byDate[priorDates[i]] >= dailyGoal) streak++;
    else break;
  }

  // Reserve: cumulative surplus/deficit vs. goal pace across prior trading days.
  let reserve = 0;
  priorDates.forEach(d => { reserve += (byDate[d] - dailyGoal); });
  reserve = parseFloat(reserve.toFixed(2));

  const metGoal = todayPnl >= dailyGoal;
  const progressPct = Math.max(0, Math.min(100, (todayPnl / dailyGoal) * 100));

  let tone = 'neutral';
  let title = '';
  let message = '';

  if (!hasTradedToday) {
    tone = 'neutral';
    title = 'No trades logged today';
    message = priorDates.length
      ? `Your daily goal is ${fmtMoney(dailyGoal)}. ${streak >= 2 ? `You're on a ${streak}-day streak of hitting it — nice consistency going in.` : `Log today's trades to see how you're tracking.`}`
      : `Your daily goal is set to ${fmtMoney(dailyGoal)}. Log a trade to start tracking your progress.`;
  } else if (metGoal) {
    tone = 'success';
    title = '🎯 Daily goal hit!';
    const extra = todayPnl - dailyGoal;
    message = `You're ${fmtMoney(todayPnl)} today, ${extra > 0 ? `${fmtMoney(extra)} over your ${fmtMoney(dailyGoal)} target` : `right at your ${fmtMoney(dailyGoal)} target`}. Nice discipline. `
      + `This is exactly when overtrading creeps in — consider calling it here and protecting the win rather than pushing for more size or "one more trade."`;
  } else if (todayPnl < 0) {
    if (streak >= 3) {
      tone = 'encourage';
      title = '📉 Red day — but keep perspective';
      message = `You've hit your ${fmtMoney(dailyGoal)} goal ${streak} day${streak === 1 ? '' : 's'} in a row coming into today. One losing day doesn't undo that consistency. `
        + `Resist the urge to revenge trade to "get it back" today — close the platform, review your notes, and let the streak speak for itself. You're still winning the bigger picture.`;
    } else if (reserve > 0 && reserve >= Math.abs(todayPnl)) {
      tone = 'encourage';
      title = '🛡️ Still on track';
      message = `Today is down ${fmtMoney(Math.abs(todayPnl))}, but you've banked ${fmtMoney(reserve)} of extra reserve above your goal pace recently. `
        + `Net-net you're still on track. There's no need to force trades to make today "green" — the bigger trend is intact.`;
    } else {
      tone = 'warning';
      title = '⚠️ Avoid revenge trading';
      message = `Today is down ${fmtMoney(Math.abs(todayPnl))} with no cushion banked above your goal pace. This is the highest-risk moment for a revenge trade. `
        + `Consider stopping for the day, stepping away from the screen, and coming back with a clear head tomorrow. Protecting capital beats forcing it back.`;
    }
  } else {
    tone = 'neutral';
    title = 'Below goal, still positive';
    const gap = dailyGoal - todayPnl;
    message = `You're up ${fmtMoney(todayPnl)} today, ${fmtMoney(gap)} short of your ${fmtMoney(dailyGoal)} goal. That's still a controlled, positive day — `
      + `don't force extra trades just to close the gap. A green day within your plan beats an overtraded one chasing a number.`;
  }

  return {
    hasGoal: true,
    dailyGoal,
    todayDate,
    todayPnl: parseFloat(todayPnl.toFixed(2)),
    hasTradedToday,
    metGoal,
    progressPct,
    streak,
    reserve,
    tone,
    title,
    message,
    recentDays: allDates.slice(-7).map(d => ({ date: d, pnl: parseFloat(byDate[d].toFixed(2)), met: byDate[d] >= dailyGoal })),
  };
}
