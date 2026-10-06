(() => {
  const STORAGE_ENDPOINT = 'ccce_ai_endpoint_v1';
  const JUDGE_FLAG = 'ccce_judge_mode_v1';
  const AI_TIMEOUT = 6500;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const configuredEndpoint = () => {
    try { return localStorage.getItem(STORAGE_ENDPOINT) || ''; }
    catch { return ''; }
  };

  const isEndpointConfigured = () => /^https:\/\//i.test(configuredEndpoint()) || /^http:\/\/localhost(?::\d+)?/i.test(configuredEndpoint());

  const judgeMode = () => {
    try { return sessionStorage.getItem(JUDGE_FLAG) === '1'; }
    catch { return false; }
  };

  const setJudgeMode = (enabled) => {
    try {
      if (enabled) sessionStorage.setItem(JUDGE_FLAG, '1');
      else sessionStorage.removeItem(JUDGE_FLAG);
    } catch {}
  };

  function buildContext(currentOrder) {
    const npc = NPCS[currentOrder.npcKey];
    const dish = DISHES[currentOrder.chosen || currentOrder.dishKey];
    const orderedDish = DISHES[currentOrder.dishKey];
    const result = currentOrder.result || {};
    const log = state.npcLog[currentOrder.npcKey] || {};
    return {
      game: '汪界王牌餐車日記',
      task: 'npc_reaction',
      language: 'zh-Hant-TW',
      npc: {
        id: currentOrder.npcKey,
        name: npc.name,
        breed: npc.breed,
        personality: npc.trait,
        mood: currentOrder.mood,
        loves: npc.love.map(key => DISHES[key].name),
        dislikes: npc.hate.map(key => DISHES[key].name)
      },
      order: {
        orderedDish: orderedDish?.name,
        servedDish: dish?.name,
        ingredients: [...(currentOrder.items || [])],
        cookingQuality: currentOrder.quality
      },
      result: {
        satisfaction: result.satisfaction,
        rating: result.rating,
        elapsedSeconds: result.elapsed,
        coins: result.coins
      },
      history: {
        visits: log.visits || 0,
        served: log.served || 0,
        bestSatisfaction: log.best || 0,
        lastSatisfaction: log.last ?? null
      },
      constraints: {
        maxTraditionalChineseCharacters: 55,
        keepCharacterVoice: true,
        noHealthOrFeedingAdvice: true,
        oneOrTwoSentences: true
      }
    };
  }

  function fallbackReply(context, currentOrder) {
    const npc = NPCS[currentOrder.npcKey];
    const score = Number(context.result.satisfaction || 0);
    const pool = score >= 90 ? npc.great : score >= 60 ? npc.ok : npc.bad;
    const index = Math.abs((context.history.visits || 0) + Math.round(score / 10)) % pool.length;
    let line = pool[index];
    if (score >= 90 && context.history.visits >= 2) line += ' 我有記得你上次的手藝喔！';
    else if (score < 60 && context.npc.mood) line += ' 今天我本來還很期待呢。';
    return line;
  }

  function extractText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data.trim();
    if (typeof data.reply === 'string') return data.reply.trim();
    if (typeof data.text === 'string') return data.text.trim();
    if (typeof data.message === 'string') return data.message.trim();
    if (typeof data.output_text === 'string') return data.output_text.trim();
    const chat = data?.choices?.[0]?.message?.content;
    if (typeof chat === 'string') return chat.trim();
    if (Array.isArray(data?.output)) {
      const candidate = data.output.flatMap(item => item?.content || []).find(item => typeof item?.text === 'string');
      if (candidate?.text) return candidate.text.trim();
    }
    return '';
  }

  async function generateReply(currentOrder) {
    const context = buildContext(currentOrder);
    const endpoint = configuredEndpoint();
    if (!isEndpointConfigured()) {
      return { text: fallbackReply(context, currentOrder), source: 'fallback', context };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: controller.signal
      });
      if (!response.ok) throw new Error('AI endpoint HTTP ' + response.status);
      const data = await response.json();
      const text = extractText(data);
      if (!text) throw new Error('AI endpoint returned empty text');
      return { text: text.slice(0, 120), source: 'ai', context };
    } catch (error) {
      console.warn('AI NPC 暫時不可用，已切換 Fallback。', error);
      return { text: fallbackReply(context, currentOrder), source: 'fallback', context };
    } finally {
      clearTimeout(timer);
    }
  }

  function statusMarkup() {
    const live = isEndpointConfigured();
    return '<span class="ccce-ai-status ' + (live ? 'live' : 'fallback') + '">' +
      (live ? '● AI 端點已設定' : '● Fallback 備援模式') + '</span>';
  }

  function enhanceTitle() {
    const panel = document.querySelector('main.panel');
    const hero = panel?.querySelector('.title-hero');
    if (!panel || !hero || panel.querySelector('.ccce-ai-panel')) return;
    const section = document.createElement('section');
    section.className = 'ccce-ai-panel';
    section.innerHTML = '<div class="ccce-ai-head"><strong>2026 CCCE｜AI NPC 評審入口</strong>' + statusMarkup() + '</div>' +
      '<p class="ccce-ai-copy">評審可直接用阿柴完成一輪料理，送餐後由「角色個性＋心情＋餐點＋料理結果＋熟客紀錄」組成 AI 情境；AI 端點失敗時自動切換 Fallback，遊戲流程不中斷。</p>' +
      '<div class="ccce-ai-actions">' +
      '<button id="ccce-judge-ai" class="ccce-judge-button" type="button">⚡ 3 分鐘 AI 快速體驗</button>' +
      '<button id="ccce-ai-tech" class="ccce-ai-tech-button" type="button">AI 技術說明</button>' +
      '<button id="ccce-ai-ab" class="ccce-ai-tech-button" type="button">A/B 回應對照</button>' +
      '</div>';
    hero.insertAdjacentElement('afterend', section);
    document.getElementById('ccce-judge-ai')?.addEventListener('click', startJudgeDemo);
    document.getElementById('ccce-ai-tech')?.addEventListener('click', showTechDialog);
    document.getElementById('ccce-ai-ab')?.addEventListener('click', showABDialog);
  }

  function startJudgeDemo() {
    clearTimers();
    setJudgeMode(true);
    day = createDay();
    day.strategy = 'precision';
    day.queue = ['shiba', ...Object.keys(NPCS).filter(key => key !== 'shiba')];
    day.index = 0;
    order = null;
    nextCustomer();
    if (order?.npcKey === 'shiba') {
      order.dishKey = 'riceball';
      order.mood = '觀察中';
      order.greeting = '嗯……今天想吃「蔬菜飯糰」。讓我看看你的手藝。';
      showCustomer();
    }
  }

  function addJudgeGuide() {
    if (!judgeMode() || gameScreen === 'title') return;
    const panel = document.querySelector('main.panel');
    if (!panel || panel.querySelector('.ccce-judge-guide')) return;
    const guide = document.createElement('div');
    guide.className = 'ccce-judge-guide';
    const steps = gameScreen === 'customer'
      ? '評審快速路線：接單 → 選「蔬菜飯糰」→ 選白飯、海苔、生菜 → 抓綠色火候 → 送餐。'
      : 'CCCE 快速體驗進行中：完成這份訂單後，結果頁會標示 AI NPC 或 Fallback 回應來源。';
    guide.innerHTML = '<strong>⚡ 3 分鐘 AI 體驗</strong><br>' + steps;
    panel.prepend(guide);
  }

  function addResultBadge(source = 'pending') {
    const details = document.querySelector('.result-details');
    if (!details) return null;
    let badge = details.querySelector('.ccce-ai-result-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ccce-ai-result-badge';
      const bubble = details.querySelector('.bubble');
      if (bubble) bubble.insertAdjacentElement('beforebegin', badge);
      else details.prepend(badge);
    }
    badge.classList.toggle('fallback', source === 'fallback');
    badge.textContent = source === 'ai'
      ? 'AI NPC · 生成式情境回應'
      : source === 'fallback'
        ? 'Fallback · 離線備援回應'
        : 'AI NPC · 正在產生角色回應…';
    return badge;
  }

  function showOverlay(innerHtml) {
    document.querySelector('.ccce-ai-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ccce-ai-dialog';
    overlay.innerHTML = '<section class="ccce-ai-dialog-card" role="dialog" aria-modal="true">' + innerHtml + '</section>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-ccce-close]').forEach(btn => btn.addEventListener('click', close));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    return overlay;
  }

  function showTechDialog() {
    const overlay = showOverlay(
      '<h2>AI NPC 技術說明</h2>' +
      '<p>AI 只負責「角色回應文字」。滿意度、金幣、口碑、目標、火候與勝負判定仍由固定 JavaScript 規則計算，避免 AI 改變遊戲公平性。</p>' +
      '<div class="ccce-ai-flow"><span>玩家料理</span><span>固定規則評分</span><span>組合 NPC 情境</span><span>安全 AI 端點</span><span>角色回應／Fallback</span></div>' +
      '<div class="ccce-ai-note"><strong>送給 AI 的資料：</strong>角色個性、當下心情、點餐與實際餐點、料理結果、滿意度，以及該熟客過往來店紀錄。<br><strong>安全設計：</strong>API 金鑰不放在 GitHub Pages。瀏覽器只呼叫自有的 HTTPS 代理端點；斷網、逾時或錯誤時自動使用原本角色台詞。</div>' +
      '<div class="ccce-ai-config"><strong>開發者端點設定</strong><small>這裡只存代理服務網址，不存任何 API key。比賽正式版需要把 AI 金鑰放在後端環境變數。</small><input id="ccce-endpoint-input" type="url" inputmode="url" placeholder="https://your-secure-ai-proxy.example/api/npc" value="' + escapeHtml(configuredEndpoint()) + '"><div class="ccce-ai-actions"><button id="ccce-save-endpoint" class="green" type="button">儲存端點</button><button data-ccce-close type="button">關閉</button></div></div>'
    );
    overlay.querySelector('#ccce-save-endpoint')?.addEventListener('click', () => {
      const value = overlay.querySelector('#ccce-endpoint-input')?.value.trim() || '';
      if (value && !/^https:\/\//i.test(value) && !/^http:\/\/localhost(?::\d+)?/i.test(value)) {
        alert('正式端點請使用 HTTPS。');
        return;
      }
      try { localStorage.setItem(STORAGE_ENDPOINT, value); } catch {}
      overlay.remove();
      if (gameScreen === 'title') showTitle();
    });
  }

  async function showABDialog() {
    const sampleOrder = {
      npcKey: 'shiba', dishKey: 'riceball', chosen: 'riceball',
      mood: '觀察中', items: ['白飯','海苔','生菜'], quality: 'perfect',
      result: { satisfaction: 100, rating: '非常滿意 😍', elapsed: 18.5, coins: 60 }
    };
    const context = buildContext(sampleOrder);
    const fallback = fallbackReply(context, sampleOrder);
    const overlay = showOverlay(
      '<h2>A/B 回應對照</h2><p>同一個情境：阿柴、蔬菜飯糰、正確食材、完美火候、100% 滿意。</p>' +
      '<div class="ccce-ab-grid"><div class="ccce-ab-card"><strong>A｜AI NPC</strong><p id="ccce-ab-ai">' + (isEndpointConfigured() ? '產生中…' : '尚未設定安全 AI 端點') + '</p></div>' +
      '<div class="ccce-ab-card"><strong>B｜Fallback</strong><p>' + escapeHtml(fallback) + '</p></div></div>' +
      '<p class="ccce-ai-note">A 使用生成式模型時，內容可依熟客紀錄與當下情境變化；B 是離線備援，確保 API 失效時仍可完成訂單。</p>' +
      '<div class="center"><button data-ccce-close type="button">關閉</button></div>'
    );
    if (isEndpointConfigured()) {
      const reply = await generateReply(sampleOrder);
      const target = overlay.querySelector('#ccce-ab-ai');
      if (target) target.textContent = reply.text + (reply.source === 'fallback' ? '（本次已切換 Fallback）' : '');
    }
  }

  const originalShowTitle = showTitle;
  showTitle = function () {
    setJudgeMode(false);
    originalShowTitle();
    enhanceTitle();
  };

  const originalRender = render;
  render = function (html, nextScreen = gameScreen) {
    originalRender(html, nextScreen);
    queueMicrotask(addJudgeGuide);
    if (nextScreen === 'result' && order?.result?.aiSource) {
      queueMicrotask(() => addResultBadge(order.result.aiSource));
    }
  };

  const originalServe = serve;
  serve = function () {
    const currentOrder = order;
    originalServe();
    if (!currentOrder?.result) return;
    addResultBadge('pending');
    generateReply(currentOrder).then(reply => {
      if (!currentOrder.result) return;
      currentOrder.result.dialogue = reply.text;
      currentOrder.result.aiSource = reply.source;
      try { saveGame(); } catch {}
      if (order !== currentOrder || gameScreen !== 'result') return;
      const bubble = document.querySelector('.result-details .bubble');
      if (bubble) bubble.textContent = '💬 ' + reply.text;
      addResultBadge(reply.source);
    });
  };

  window.CCCEAIBridge = {
    generateReply,
    buildContext,
    configuredEndpoint,
    startJudgeDemo,
    version: '2026-10-06'
  };

  if (gameScreen === 'title') showTitle();
})();
