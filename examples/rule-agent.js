// 具身规则智能体示例。
// 打开 index.html，等标题画面出现后，把本文件贴进浏览器控制台，再执行：
//   runEmbodiedAgent()
//
// 它只做三件事：看一段距离内的障碍、选一个身体动作、让世界向前走一步。
// 不改分数，不改坐标，不删障碍。

(function () {
  var SENSE_FAR = -28;
  var DT = 1 / 30;

  function perceive(raw) {
    var ahead = [];
    for (var i = 0; i < raw.obs.length; i++) {
      var o = raw.obs[i];
      if (o.z < -0.3 && o.z > SENSE_FAR) ahead.push(o);
    }
    return {
      lane: raw.lane,
      speed: raw.speed,
      energy: raw.energy,
      boost: raw.boost,
      grounded: raw.grounded,
      sliding: raw.sliding,
      ahead: ahead
    };
  }

  function closestOnLane(ahead, lane) {
    var best = null;
    for (var i = 0; i < ahead.length; i++) {
      var o = ahead[i];
      if (o.l !== lane) continue;
      if (!best || o.z > best.z) best = o;
    }
    return best;
  }

  // 只把「不比当前这堵墙更远」的障碍算进目标车道。
  // 远处另一排的墙不能把角色再劝回眼前这排。
  function laneCost(ahead, lane, z, speed) {
    var cost = 0;
    for (var i = 0; i < ahead.length; i++) {
      var o = ahead[i];
      if (o.l !== lane || o.z < z - 7) continue;
      var eta = -o.z / Math.max(speed, 1);
      var c = o.t === 'wall' || eta < 0.22 ? 2 : 1;
      if (c > cost) cost = c;
    }
    return cost;
  }

  function escapeDir(view, threat) {
    var best = 0;
    var bestRank = 99;
    for (var lane = 0; lane < 3; lane++) {
      if (lane === view.lane) continue;
      var dir = lane - view.lane;
      var mid = view.lane + (dir > 0 ? 1 : -1);
      if (Math.abs(dir) === 2 && laneCost(view.ahead, mid, threat.z, view.speed) > 0) continue;
      var cost = laneCost(view.ahead, lane, threat.z, view.speed);
      if (cost >= 2) continue;
      var rank = cost * 10 + Math.abs(dir);
      if (rank < bestRank) {
        bestRank = rank;
        best = dir;
      }
    }
    return best;
  }

  function decide(view) {
    var threat = closestOnLane(view.ahead, view.lane);
    if (!threat) return 'none';
    var eta = -threat.z / Math.max(view.speed, 1);

    if (threat.t === 'wall') {
      if (eta > 1) return 'none';
      var dir = escapeDir(view, threat);
      if (dir === 0 && view.energy >= 100 && view.boost <= 0 && eta < 0.45) return 'boost';
      if (dir === 0) return 'none';
      return { type: 'lane', dir: dir };
    }

    if (!view.grounded) return 'none';
    if (threat.t === 'low' && eta < 0.42) return 'jump';
    if (threat.t === 'high' && view.sliding <= 0 && eta < 0.48) return 'slide';
    return 'none';
  }

  function act(action, api) {
    if (action && action.type === 'lane') api.moveLane(action.dir);
    else if (action === 'jump') api.jump();
    else if (action === 'slide') api.slide();
    else if (action === 'boost') api.boost();
  }

  function actionName(action) {
    if (action && action.type === 'lane') return action.dir < 0 ? 'left' : 'right';
    return action;
  }

  async function runEpisode(options) {
    var api = window.__NEON;
    if (!api) throw new Error('等游戏加载完再运行');
    var realtime = !options || options.realtime !== false;
    var maxSeconds = (options && options.seconds) || 90;
    var steps = Math.round(maxSeconds / DT);
    var log = [];

    api.setManual(true);
    try {
      api.start();
      for (var i = 0; i < steps; i++) {
        var raw = api.state();
        if (raw.state === 'crash' || raw.state === 'over') {
          api.advance(1.3);
          break;
        }
        if (raw.state !== 'playing') break;
        var view = perceive(raw);
        var action = decide(view);
        if (action !== 'none') {
          log.push({
            t: Math.round(i * DT * 10) / 10,
            action: actionName(action),
            lane: view.lane,
            threat: closestOnLane(view.ahead, view.lane)
          });
          act(action, api);
        }
        api.advance(DT);
        if (realtime && i % 2 === 0) {
          await new Promise(function (resolve) { requestAnimationFrame(resolve); });
        }
      }
    } finally {
      api.setManual(false);
    }

    var end = api.state();
    console.log('本局结束', {
      state: end.state,
      score: end.score,
      coins: end.coins,
      best: end.best,
      decisions: log.length
    });
    console.table(log.slice(-12));
    return { state: end, log: log };
  }

  window.runEmbodiedAgent = runEpisode;
})();
