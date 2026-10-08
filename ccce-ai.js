(() => {
  const STORAGE_ENDPOINT = 'ccce_ai_endpoint_v1';
  const MEMORY_KEY = 'ccce_npc_memory_v2';
  const DEFAULT_ENDPOINT = 'https://wangjie-foodtruck-ai-proxy.vercel.app/api/npc';
  const DEFAULT_HEALTH_ENDPOINT = 'https://wangjie-foodtruck-ai-proxy.vercel.app/api/health';
  const JUDGE_FLAG = 'ccce_judge_mode_v1';
  const AI_TIMEOUT = 6500;
  const HEALTH_TIMEOUT = 3500;
  let aiHealth = { state: 'checking', checkedAt: 0, latency: null, detail: '尚未檢查' };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const configuredEndpoint = () => {
    try {
      const override = (localStorage.getItem(STORAGE_ENDPOINT) || '').trim();
      return override || DEFAULT_ENDPOINT;
    } catch {
      return DEFAULT_ENDPOINT;
    }
  };

  const isEndpointConfigured = () => /^https:\/\//i.test(configuredEndpoint()) || /^http:\/\/localhost(?::\d+)?/i.test(configuredEndpoint());
  const healthEndpoint = () => {
    const endpoint = configuredEndpoint();
    if (endpoint === DEFAULT_ENDPOINT) return DEFAULT_HEALTH_ENDPOINT;
    return endpoint.replace(/\/api\/npc(?:\?.*)?$/i, '/api/health');
  };
  const relationshipLevel = (visits = 0, served = 0) => served >= 5 || visits >= 6 ? '熟客夥伴' : served >= 2 || visits >= 3 ? '熟悉常客' : '初識';
  const storageAvailable = () => {
    try { const key = '__ccce_storage_probe__'; localStorage.setItem(key, '1'); localStorage.removeItem(key); return true; } catch { return false; }
  };

  async function checkAIHealth(force = false) {
    if (!force && aiHealth.checkedAt && Date.now() - aiHealth.checkedAt < 15000) return aiHealth;
    if (!isEndpointConfigured()) {
      aiHealth = { state: 'fallback', checkedAt: Date.now(), latency: null, detail: '未設定 HTTPS AI 端點' };
      updateAIStatusElements();
      return aiHealth;
    }
    aiHealth = { state: 'checking', checkedAt: 0, latency: null, detail: '正在檢查後端' };
    updateAIStatusElements();
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);
    try {
      const response = await fetch(healthEndpoint(), { method: 'GET', cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => null);
      const latency = Math.round(performance.now() - started);
      if (!response.ok || !data?.ok || data?.aiConfigured !== true) throw new Error('health_not_ready');
      aiHealth = { state: 'live', checkedAt: Date.now(), latency, detail: `${data.provider || 'AI backend'} · ${latency}ms` };
    } catch {
      aiHealth = { state: 'fallback', checkedAt: Date.now(), latency: null, detail: location.protocol === 'file:' ? 'file:// 模式不呼叫遠端 AI，請使用 START_GAME_WINDOWS.bat' : 'AI 後端暫時不可用，Fallback 已待命' };
    } finally {
      clearTimeout(timer);
      updateAIStatusElements();
    }
    return aiHealth;
  }

  function updateAIStatusElements() {
    document.querySelectorAll('[data-ai-health-status]').forEach(el => {
      el.classList.remove('live','fallback','checking');
      el.classList.add(aiHealth.state);
      el.textContent = aiHealth.state === 'live' ? '● AI NPC 已連線' : aiHealth.state === 'checking' ? '● AI 連線檢查中…' : '● Fallback 備援模式';
    });
    document.querySelectorAll('[data-ai-health-detail]').forEach(el => { el.textContent = aiHealth.detail || ''; });
  }

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
  function readMemoryStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }

  function recentMemoryFor(npcKey) {
    const store = readMemoryStore();
    return Array.isArray(store[npcKey]) ? store[npcKey].slice(-6) : [];
  }

  function recordBridgeMemory(currentOrder) {
    if (!currentOrder?.result || !currentOrder.npcKey) return;
    try {
      const store = readMemoryStore();
      const list = Array.isArray(store[currentOrder.npcKey]) ? store[currentOrder.npcKey] : [];
      const npc = NPCS[currentOrder.npcKey];
      const key = currentOrder.chosen || currentOrder.dishKey;
      list.push({
        day: Number(state.day || 1),
        dishKey: key,
        dish: DISHES[key]?.name || '',
        satisfaction: Number(currentOrder.result.satisfaction || 0),
        rating: currentOrder.result.rating || '',
        cookingQuality: currentOrder.quality || '',
        liked: Boolean(npc?.love?.includes(key)),
        elapsed: Number(currentOrder.result.elapsed || 0)
      });
      store[currentOrder.npcKey] = list.slice(-6);
      localStorage.setItem(MEMORY_KEY, JSON.stringify(store));
    } catch {}
  }

  function buildContext(currentOrder) {
    const npc = NPCS[currentOrder.npcKey];
    const dish = DISHES[currentOrder.chosen || currentOrder.dishKey];
    const orderedDish = DISHES[currentOrder.dishKey];
    const result = currentOrder.result || {};
    const log = state.npcLog[currentOrder.npcKey] || {};
    const visits = Number.isFinite(currentOrder.aiVisits) ? currentOrder.aiVisits : (log.visits || 0);
    const served = Number.isFinite(currentOrder.aiServed) ? currentOrder.aiServed : (log.served || 0);
    const storedHistory = Array.isArray(log.history) && log.history.length ? log.history : recentMemoryFor(currentOrder.npcKey);
    const previousHistory = Array.isArray(currentOrder.aiHistory)
      ? currentOrder.aiHistory
      : storedHistory.slice(0, Math.max(0, storedHistory.length - 1));
    const recentVisits = previousHistory.slice(-3).map(item => ({
      day: Number(item.day || 1),
      dish: item.dish || DISHES[item.dishKey]?.name || '',
      satisfaction: Number(item.satisfaction || 0),
      rating: item.rating || '',
      cookingQuality: item.cookingQuality || item.quality || '',
      liked: Boolean(item.liked)
    }));
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
        visits,
        served,
        bestSatisfaction: Number.isFinite(currentOrder.aiBest) ? currentOrder.aiBest : (log.best || 0),
        lastSatisfaction: currentOrder.aiLast ?? log.last ?? null,
        relationshipLevel: currentOrder.aiRelationship || relationshipLevel(visits, served),
        recentVisits
      },
      constraints: {
        maxTraditionalChineseCharacters: 55,
        keepCharacterVoice: true,
        useOnlyProvidedMemories: true,
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
    const memory = context.history.recentVisits?.at(-1);
    if (memory && score >= 75) line += ` 上次的${memory.dish}我也記得。`;
    else if (score >= 90 && context.history.visits >= 2) line += ' 我有記得你上次的手藝喔！';
    else if (score < 60 && context.npc.mood) line += ' 今天我本來還很期待呢。';
    return line.slice(0, 120);
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
      return { text: fallbackReply(context, currentOrder), source: 'fallback', memoryUsed: Boolean(context.history.recentVisits?.length), context };
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
      return { text: text.slice(0, 120), source: 'ai', memoryUsed: Boolean(data?.memoryUsed ?? context.history.recentVisits?.length), context };
    } catch (error) {
      console.warn('AI NPC 暫時不可用，已切換 Fallback。', error);
      return { text: fallbackReply(context, currentOrder), source: 'fallback', memoryUsed: Boolean(context.history.recentVisits?.length), context };
    } finally {
      clearTimeout(timer);
    }
  }

  function statusMarkup() {
    const label = aiHealth.state === 'live' ? '● AI NPC 已連線' : aiHealth.state === 'checking' ? '● AI 連線檢查中…' : '● Fallback 備援模式';
    return '<span class="ccce-ai-status ' + aiHealth.state + '" data-ai-health-status>' + label + '</span>';
  }

  function enhanceTitle() {
    const panel = document.querySelector('main.panel');
    const hero = panel?.querySelector('.title-hero');
    if (!panel || !hero || panel.querySelector('.ccce-ai-panel')) return;
    const section = document.createElement('section');
    section.className = 'ccce-ai-panel';
    section.innerHTML = '<div class="ccce-ai-kicker">🏆 建議評審先從這裡開始</div>' +
      '<div class="ccce-ai-head"><strong>2026 CCCE｜AI NPC 評審入口</strong>' + statusMarkup() + '</div>' +
      '<p class="ccce-ai-copy">3 分鐘內完成「接單 → 固定規則評分 → 熟客記憶 → AI NPC 回應」。AI 不決定分數，但會依角色人格與最近用餐記憶產生不同回應；AI 失效時遊戲立即切換 Fallback。</p>' +
      '<div class="ccce-ai-steps"><span><b>1</b> 阿柴指定訂單</span><span><b>2</b> 固定規則評分</span><span><b>3</b> AI 讀取熟客記憶</span></div>' +
      '<div class="ccce-health-row"><strong>現場 AI 狀態</strong><span data-ai-health-detail class="ccce-health-meta">' + escapeHtml(aiHealth.detail) + '</span></div>' +
      '<div class="ccce-ai-actions">' +
      '<button id="ccce-judge-ai" class="ccce-judge-button" type="button">⚡ 開始 3 分鐘 AI 評審體驗</button>' +
      '<button id="ccce-ai-tech" class="ccce-ai-tech-button" type="button">AI 技術證據</button>' +
      '<button id="ccce-ai-ab" class="ccce-ai-tech-button" type="button">A/B 記憶與人格驗證</button>' +
      '<button id="ccce-stability" class="ccce-ai-tech-button" type="button">現場穩定性檢查</button>' +
      '</div>';
    const featureStrip = panel.querySelector('.feature-strip');
    if (featureStrip) featureStrip.insertAdjacentElement('afterend', section);
    else hero.insertAdjacentElement('afterend', section);
    document.getElementById('ccce-judge-ai')?.addEventListener('click', startJudgeDemo);
    document.getElementById('ccce-ai-tech')?.addEventListener('click', showTechDialog);
    document.getElementById('ccce-ai-ab')?.addEventListener('click', showABDialog);
    document.getElementById('ccce-stability')?.addEventListener('click', showStabilityDialog);
    checkAIHealth(true);
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

  function addResultBadge(source = 'pending', memoryUsed = false) {
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
    badge.classList.toggle('memory', source === 'ai' && memoryUsed);
    badge.textContent = source === 'ai'
      ? (memoryUsed ? 'AI NPC · 生成式情境回應 · 熟客記憶已參與' : 'AI NPC · 生成式情境回應 · 初次互動')
      : source === 'fallback'
        ? (memoryUsed ? 'Fallback · 離線備援 · 熟客記憶規則' : 'Fallback · 離線備援回應')
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

  function currentMemoryEvidence() {
    const store = readMemoryStore();
    return Object.entries(store).flatMap(([key, history]) => {
      const npc = NPCS[key];
      return (Array.isArray(history) ? history : []).slice(-2).map(item => `${npc?.name || key}｜第${item.day || '?'}天｜${item.dish || '料理'}｜${item.satisfaction ?? '?'}%`);
    }).slice(-5);
  }

  function showTechDialog() {
    const memory = currentMemoryEvidence();
    const overlay = showOverlay(
      '<h2>AI 技術證據｜評審可直接驗證</h2>' +
      '<div class="ccce-health-row"><strong>後端健康檢查</strong><span class="ccce-ai-status ' + aiHealth.state + '" data-ai-health-status>' + (aiHealth.state === 'live' ? '● AI NPC 已連線' : aiHealth.state === 'checking' ? '● AI 連線檢查中…' : '● Fallback 備援模式') + '</span><small data-ai-health-detail class="ccce-health-meta">' + escapeHtml(aiHealth.detail) + '</small></div>' +
      '<div class="ccce-evidence-grid">' +
        '<div class="ccce-evidence-card"><strong>① 固定 JavaScript 規則</strong><p>料理正確、喜愛料理、正確食材＋完美火候、速度、Combo 決定滿意度；AI 不得修改分數、金幣、口碑或勝負。</p></div>' +
        '<div class="ccce-evidence-card"><strong>② 生成式 AI NPC</strong><p>只負責角色台詞，讀取人格、心情、本次料理結果，以及最近 3 次具體用餐記憶，形成熟客連續性。</p></div>' +
        '<div class="ccce-evidence-card"><strong>③ Fallback 備援</strong><p>斷網、逾時、額度或服務異常時，不阻斷送餐與結算；立即改用本機角色規則與熟客記憶。</p></div>' +
      '</div>' +
      '<div class="ccce-rule-formula">公平評分公式：正確料理 +40｜喜愛料理 +20｜正確食材＋完美火候 +20｜快速 +10｜Combo +10＝最高 100 分</div>' +
      '<div class="ccce-ai-flow"><span>玩家料理</span><span>固定規則評分</span><span>最近 3 次熟客記憶</span><span>Vercel 安全後端</span><span>AI 回應／Fallback</span></div>' +
      '<div class="ccce-memory-box"><strong>目前裝置的熟客記憶證據：</strong><br>' + (memory.length ? memory.map(item => '<span class="ccce-memory-chip">🧠 ' + escapeHtml(item) + '</span>').join('') : '尚未累積；完成幾筆訂單後會在此顯示具體料理與滿意度。') + '</div>' +
      '<div class="ccce-ai-note"><strong>安全：</strong>API 金鑰只存在 Vercel 伺服器端環境變數；前端只知道公開 HTTPS 代理網址。<br><strong>可驗證：</strong>請按「A/B 記憶與人格驗證」，同一分數下直接比較熟客記憶與角色人格造成的台詞差異。</div>' +
      '<div class="center"><button id="ccce-health-refresh" class="green" type="button">重新檢查 AI</button><button id="ccce-tech-ab" type="button">開啟 A/B 驗證</button><button data-ccce-close type="button">關閉</button></div>'
    );
    overlay.querySelector('#ccce-health-refresh')?.addEventListener('click', () => checkAIHealth(true));
    overlay.querySelector('#ccce-tech-ab')?.addEventListener('click', () => { overlay.remove(); showABDialog(); });
    checkAIHealth(true);
  }

  async function showABDialog() {
    const base = { dishKey:'riceball', chosen:'riceball', mood:'觀察中', items:['白飯','海苔','生菜'], quality:'perfect', result:{satisfaction:100,rating:'非常滿意 😍',elapsed:18.5,coins:60} };
    const firstShiba = { ...base, npcKey:'shiba', aiVisits:1, aiServed:0, aiRelationship:'初識', aiHistory:[] };
    const regularShiba = { ...base, npcKey:'shiba', aiVisits:6, aiServed:5, aiRelationship:'熟客夥伴', aiBest:100, aiLast:88, aiHistory:[
      {day:2,dish:'月光果汁',satisfaction:82,rating:'滿意 😊',cookingQuality:'perfect',liked:true},
      {day:4,dish:'蔬菜飯糰',satisfaction:95,rating:'非常滿意 😍',cookingQuality:'perfect',liked:true},
      {day:5,dish:'月光果汁',satisfaction:88,rating:'滿意 😊',cookingQuality:'perfect',liked:true}
    ]};
    const firstSamoyed = { ...base, npcKey:'samoyed', mood:'期待', aiVisits:1, aiServed:0, aiRelationship:'初識', aiHistory:[] };
    const fallbackRegular = fallbackReply(buildContext(regularShiba), regularShiba);
    const overlay = showOverlay(
      '<h2>A/B 驗證｜AI 記憶深度＋角色人格</h2><p>以下全部固定為「同一份蔬菜飯糰、100% 滿意、完美火候」，只改變熟客記憶或 NPC 人格。</p>' +
      '<div class="ccce-ab-section"><h3>實驗 A｜同角色、同分數：首次 vs 第 6 次熟客</h3><div class="ccce-ab-grid four"><div class="ccce-ab-card"><strong>A1｜阿柴・首次</strong><span class="scenario">初識｜無過往記憶</span><div id="ab-first" class="ccce-ab-output">等待執行…</div></div><div class="ccce-ab-card"><strong>A2｜阿柴・熟客</strong><span class="scenario">第 6 次來店｜有 3 筆用餐記憶</span><div id="ab-regular" class="ccce-ab-output">等待執行…</div></div></div></div>' +
      '<div class="ccce-ab-section"><h3>實驗 B｜同料理、同分數：阿柴 vs 奶霜</h3><div class="ccce-ab-grid four"><div class="ccce-ab-card"><strong>B1｜阿柴</strong><span class="scenario">慢熟、外冷內熱</span><div id="ab-shiba" class="ccce-ab-output">等待執行…</div></div><div class="ccce-ab-card"><strong>B2｜奶霜</strong><span class="scenario">溫柔細心、重視外觀</span><div id="ab-samoyed" class="ccce-ab-output">等待執行…</div></div></div></div>' +
      '<div class="ccce-ai-note"><strong>離線證據：</strong>熟客情境的 Fallback：「' + escapeHtml(fallbackRegular) + '」</div>' +
      '<div class="center"><button id="run-ab" class="green" type="button">▶ 執行 4 組 AI 驗證</button><button data-ccce-close type="button">關閉</button></div>'
    );
    overlay.querySelector('#run-ab')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'AI 驗證中…';
      ['ab-first','ab-regular','ab-shiba','ab-samoyed'].forEach(id => { const el = overlay.querySelector('#'+id); if (el) el.textContent = '產生中…'; });
      const [r1,r2,r3,r4] = await Promise.all([generateReply(firstShiba),generateReply(regularShiba),generateReply(firstShiba),generateReply(firstSamoyed)]);
      const put=(id,result)=>{const el=overlay.querySelector('#'+id);if(el)el.textContent=result.text+(result.source==='fallback'?'（Fallback）':'');};
      put('ab-first',r1);put('ab-regular',r2);put('ab-shiba',r3);put('ab-samoyed',r4);
      button.disabled=false;button.textContent='↻ 再執行一次';
    });
  }

  function showStabilityDialog() {
    const protocolOk = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const storageOk = storageAvailable();
    const overlay = showOverlay(
      '<h2>現場穩定性檢查</h2><p>AI 正常時展示生成式回應；網路或 API 出問題時仍能完整玩完。</p>' +
      '<div class="ccce-stability-list"><div class="ccce-stability-item"><span>'+(storageOk?'✅':'⚠️')+'</span><div><b>本機存檔 localStorage</b><small>'+(storageOk?'可用：回首頁或重新整理後可繼續。':'目前瀏覽器限制存檔。')+'</small></div></div><div class="ccce-stability-item"><span>'+(protocolOk?'✅':'⚠️')+'</span><div><b>啟動方式</b><small>'+(protocolOk?'目前來源可用於正式 AI 串接。':'file:// 模式會自動使用 Fallback。')+'</small></div></div><div class="ccce-stability-item"><span>🩺</span><div><b>AI 後端 Health Check</b><small data-ai-health-detail>'+escapeHtml(aiHealth.detail)+'</small><span class="ccce-ai-status '+aiHealth.state+'" data-ai-health-status>'+ (aiHealth.state==='live'?'● AI NPC 已連線':aiHealth.state==='checking'?'● AI 連線檢查中…':'● Fallback 備援模式') +'</span></div></div><div class="ccce-stability-item"><span>🛟</span><div><b>Fallback 備援</b><small>AI 失敗不影響送餐、評分、結算與升級。</small></div></div></div>' +
      '<div id="fallback-demo" class="ccce-memory-box"><strong>Fallback 實測：</strong>尚未執行。</div>' +
      '<div class="center"><button id="stability-health" class="green" type="button">重新檢查 AI</button><button id="force-fallback" type="button">強制 Fallback 示範</button><button data-ccce-close type="button">關閉</button></div>'
    );
    overlay.querySelector('#stability-health')?.addEventListener('click',()=>checkAIHealth(true));
    overlay.querySelector('#force-fallback')?.addEventListener('click',()=>{
      const sample={npcKey:'shiba',dishKey:'riceball',chosen:'riceball',mood:'觀察中',items:['白飯','海苔','生菜'],quality:'perfect',result:{satisfaction:100,rating:'非常滿意 😍',elapsed:18.5,coins:60},aiVisits:6,aiServed:5,aiRelationship:'熟客夥伴',aiHistory:[{day:5,dish:'月光果汁',satisfaction:88,rating:'滿意 😊',cookingQuality:'perfect',liked:true}]};
      const target=overlay.querySelector('#fallback-demo'); if(target) target.innerHTML='<strong>Fallback 實測成功：</strong><br>「'+escapeHtml(fallbackReply(buildContext(sample),sample))+'」<br><small>此按鈕完全不呼叫 AI API。</small>';
    });
    checkAIHealth(true);
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
      queueMicrotask(() => addResultBadge(order.result.aiSource, Boolean(order.result.aiMemoryUsed)));
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
      currentOrder.result.aiMemoryUsed = Boolean(reply.memoryUsed);
      recordBridgeMemory(currentOrder);
      try { saveGame(); } catch {}
      if (order !== currentOrder || gameScreen !== 'result') return;
      const bubble = document.querySelector('.result-details .bubble');
      if (bubble) bubble.textContent = '💬 ' + reply.text;
      addResultBadge(reply.source, Boolean(reply.memoryUsed));
    });
  };

  window.CCCEAIBridge = {
    generateReply,
    buildContext,
    configuredEndpoint,
    startJudgeDemo,
    version: '2026-10-08-ai-depth-stability'
  };

  if (gameScreen === 'title') showTitle();
})();
