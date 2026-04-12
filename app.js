(function () {
  'use strict';

  // ─── State ───
  var state = {
    customers: [],
    visits: [],
    deposits: [],
    budgets: [],
    todayGuests: [],      // 当日来客情報
    tomorrowGuests: [],   // 翌日来客情報（CSV取り込み時に設定、7時に当日へ移行）
    calendarData: {},     // 営業カレンダー { "2026-04-09": { open: true, staff: 3, memo: "" }, ... }
    calendarMonth: '',    // カレンダー表示月 "2026-04"
    gasUrl: '',
    currentPage: 'guests',
    dashboardMonth: '',
    // 発注関連
    suppliers: [],        // [{ id, name }]
    supplierItems: {},    // { supplierId: [{ name, unit }] }
    orders: [],           // [{ id, date, supplierId, supplierName, items: [{name, qty, unit}], memo }]
    currentOrder: [],     // 作成中の発注品目リスト
  };

  // ─── Utilities ───
  function fmt(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('ja-JP');
  }

  function fmtYen(n) {
    if (n == null || isNaN(n)) return '-';
    return '¥' + fmt(n);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function monthOf(dateStr) {
    return dateStr ? dateStr.slice(0, 7) : '';
  }

  function addMonths(dateStr, months) {
    var d = new Date(dateStr);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  function isExpired(deposit) {
    if (!deposit.expiresAt) return false;
    return deposit.expiresAt < today();
  }

  function daysUntilExpiry(deposit) {
    if (!deposit.expiresAt) return Infinity;
    var diff = new Date(deposit.expiresAt) - new Date(today());
    return Math.ceil(diff / 86400000);
  }

  function showToast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  // ─── Data Layer ───
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyTruy8ytFc-ISXOeCVRCdg3ao1860NxEGavVNiQ486pYPeuLL3aXI-8kIovX-M9Ar2/exec';

  function getGasUrl() {
    return localStorage.getItem('inai-gas-url') || DEFAULT_GAS_URL;
  }

  function setGasUrl(url) {
    if (url) localStorage.setItem('inai-gas-url', url);
    else localStorage.removeItem('inai-gas-url');
  }

  // Local storage fallback
  function saveLocal() {
    localStorage.setItem('inai-data', JSON.stringify({
      customers: state.customers,
      visits: state.visits,
      deposits: state.deposits,
      budgets: state.budgets,
      todayGuests: state.todayGuests,
      tomorrowGuests: state.tomorrowGuests,
      calendarData: state.calendarData,
      suppliers: state.suppliers,
      supplierItems: state.supplierItems,
      orders: state.orders,
    }));
  }

  function loadLocal() {
    var raw = localStorage.getItem('inai-data');
    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d.todayGuests) state.todayGuests = d.todayGuests;
        if (d.tomorrowGuests) state.tomorrowGuests = d.tomorrowGuests;
        if (d.calendarData) state.calendarData = d.calendarData;
        if (d.suppliers) state.suppliers = d.suppliers;
        if (d.supplierItems) state.supplierItems = d.supplierItems;
        if (d.orders) state.orders = d.orders;
        return d;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  async function fetchGas(action) {
    var res = await fetch(state.gasUrl + '?action=' + action, { redirect: 'follow' });
    return res.json();
  }

  async function loadData() {
    state.gasUrl = getGasUrl();

    if (state.gasUrl) {
      try {
        // 順次取得（GASリダイレクトの競合を避けるため）
        var custRes = await fetchGas('customers');
        state.customers = custRes.customers || [];
        var visitRes = await fetchGas('visits');
        state.visits = visitRes.visits || [];
        var depRes = await fetchGas('deposits');
        state.deposits = depRes.deposits || [];
        // 来客予定をGASから取得
        try {
          var guestRes = await fetchGas('guests');
          if (guestRes.guests) {
            if (guestRes.guests.today && guestRes.guests.today.length > 0) state.todayGuests = guestRes.guests.today;
            if (guestRes.guests.tomorrow && guestRes.guests.tomorrow.length > 0) state.tomorrowGuests = guestRes.guests.tomorrow;
          }
        } catch (ge) { console.warn('来客予定取得失敗:', ge); }
        // ローカルの予算・カレンダーデータを維持
        var local = loadLocal();
        state.budgets = (local && local.budgets) ? local.budgets : [];
        if (local && local.calendarData) state.calendarData = local.calendarData;
        // GASに来客データがなければローカルから復元
        if ((!state.todayGuests || state.todayGuests.length === 0) && local && local.todayGuests) state.todayGuests = local.todayGuests;
        if ((!state.tomorrowGuests || state.tomorrowGuests.length === 0) && local && local.tomorrowGuests) state.tomorrowGuests = local.tomorrowGuests;
        updateConnectionStatus(true);
        saveLocal();
        return;
      } catch (e) {
        console.warn('GAS接続失敗:', e);
        showToast('スプレッドシート接続に失敗しました。ローカルデータを使用します。', true);
      }
    }

    // Try local storage
    var local = loadLocal();
    if (local && local.customers && local.customers.length > 0) {
      state.customers = local.customers;
      state.visits = local.visits || [];
      state.deposits = local.deposits || [];
      state.budgets = local.budgets || [];
      if (local.todayGuests) state.todayGuests = local.todayGuests;
      if (local.tomorrowGuests) state.tomorrowGuests = local.tomorrowGuests;
      if (local.calendarData) state.calendarData = local.calendarData;
      updateConnectionStatus(false);
      return;
    }

    // Fallback to sample data
    try {
      var res2 = await fetch('sample-data.json');
      if (res2.ok) {
        var sample = await res2.json();
        state.customers = sample.customers || [];
        state.visits = sample.visits || [];
        state.deposits = sample.deposits || [];
        state.budgets = sample.budgets || [];
        saveLocal();
      }
    } catch (e) {
      console.warn('サンプルデータ取得失敗:', e);
    }
    updateConnectionStatus(false);
  }

  async function postToGas(action, data) {
    if (!state.gasUrl) return false;
    try {
      await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: action, data: data }),
      });
      return true;
    } catch (e) {
      console.warn('GAS POST失敗:', e);
      return false;
    }
  }

  function updateConnectionStatus(online) {
    var el = document.getElementById('connection-status');
    var dot = el.querySelector('.status-dot');
    var text = el.querySelector('span:last-child');
    dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    text.textContent = online ? 'スプレッドシート連携中' : 'ローカルデータ';
  }

  // ─── 単価マスタ（makuake3 支払い後単価） ───
  // ランク名に含まれるキーワードで割引タイプを判定
  // 単価 = 顧客が支払った金額（1人あたり）
  // makuake3: 販売金額 ÷ 使用枚数
  var PRICE_TABLE = {
    '通常/単品':          { '超早割': 13300, '早割': 13800, '通常': 14300, '追加': 14300 },
    '通常/インクルーシブ': { '超早割': 16600, '早割': 17100, '通常': 17600, '追加': 17600 },
    '会食プラン':         { '早割': 10000, '通常': 11000 },
    // 尾崎牛系（2025年の旧メニュー、stripeメンバー等）
    '尾崎牛/単品':          { 'ブラック': 16500, 'プラチナ': 17600, 'ゴールド': 13200, '早割ゴールド': 13200, '通常': 17600 },
    '尾崎牛/インクルーシブ': { 'ブラック': 16500, 'プラチナ': 17600, 'ゴールド': 14300, '早割ゴールド': 14300, '通常': 17600 },
    '尾崎牛/ペアリング':    { 'ブラック': 16500, 'プラチナ': 17600, 'ゴールド': 14300, '通常': 17600 },
    // デポジット
  };

  function resolveUnitPrice(v) {
    // 明示的に設定されていればそのまま使う
    if (v.unitPrice && v.unitPrice > 0) return v.unitPrice;

    var cust = getCustomerById(v.customerId);

    // Makuake顧客: 入金データから1人あたり単価を算出
    if (cust && (cust.channel || '').startsWith('makuake')) {
      var fromDeposit = calcUnitPriceFromDeposits(cust);
      if (fromDeposit > 0) return fromDeposit;
    }

    var plan = v.plan || '';
    var rank = cust ? (cust.rank || '') : '';

    var priceMap = PRICE_TABLE[plan];
    if (!priceMap) return 0;

    // ランク名から割引タイプを判定
    var rankLower = rank.toLowerCase();
    if (rankLower.indexOf('超早割') >= 0) return priceMap['超早割'] || priceMap['通常'] || 0;
    if (rankLower.indexOf('早割') >= 0) return priceMap['早割'] || priceMap['通常'] || 0;
    if (rankLower.indexOf('ブラック') >= 0 || rank.indexOf('ブラック') >= 0) return priceMap['ブラック'] || priceMap['通常'] || 0;
    if (rankLower.indexOf('プラチナ') >= 0 || rank.indexOf('プラチナ') >= 0) return priceMap['プラチナ'] || priceMap['通常'] || 0;
    if (rankLower.indexOf('ゴールド') >= 0 || rank.indexOf('ゴールド') >= 0) return priceMap['ゴールド'] || priceMap['通常'] || 0;
    if (rank.indexOf('超早割') >= 0) return priceMap['超早割'] || priceMap['通常'] || 0;
    if (rank.indexOf('早割') >= 0) return priceMap['早割'] || priceMap['通常'] || 0;
    return priceMap['通常'] || Object.values(priceMap)[0] || 0;
  }

  // Makuake顧客の入金データから1人あたり単価を計算
  // 入金合計 ÷ 購入枚数 = 1人あたり単価
  function calcUnitPriceFromDeposits(cust) {
    // 会員一覧の購入枚数があればそれを使う
    if (cust.ticketCount && cust.ticketCount > 0) {
      var totalDeposit = 0;
      state.deposits.forEach(function (d) {
        if (d.customerId === cust.id && (d.channel || '').startsWith('makuake')) {
          // デポジット（お食事券）は除外して、コース分のみで計算
          if ((d.memo || '').indexOf('お食事券') >= 0) return;
          totalDeposit += d.amount;
        }
      });
      if (totalDeposit > 0) return Math.round(totalDeposit / cust.ticketCount);
    }
    // 購入枚数がない場合: 入金メモからチケット枚数を合算して推測
    var deposits = state.deposits.filter(function (d) {
      return d.customerId === cust.id && (d.channel || '').startsWith('makuake')
        && (d.memo || '').indexOf('お食事券') < 0;
    });
    if (deposits.length === 0) return 0;
    var totalAmount = 0;
    var totalTickets = 0;
    for (var i = 0; i < deposits.length; i++) {
      var memo = deposits[i].memo || '';
      var match = memo.match(/[《【](\d+)名[分》】]/);
      if (match) {
        totalTickets += parseInt(match[1]);
        totalAmount += deposits[i].amount;
      }
    }
    if (totalTickets > 0 && totalAmount > 0) {
      return Math.round(totalAmount / totalTickets);
    }
    // デポジット顧客（メモに「デポジット」含む）→ 固定単価 ¥17,600
    for (var i = 0; i < deposits.length; i++) {
      if ((deposits[i].memo || '').indexOf('デポジット') >= 0) {
        return 17600;
      }
    }
    return 0;
  }

  // ─── Computed Data ───
  // 来店レコードから売上を計算
  // preSaleRevenue = X列「前売→売上額」（前売消費分）
  // sameDayRevenue = Y列「実費金額」（合計売上 = 前売 + 当日追加）
  // → 当日売上 = 実費金額 - 前売売上
  function calcVisitRevenue(v) {
    var preSale = (v.preSaleRevenue || 0);
    var total = (v.sameDayRevenue || 0); // Y列 = 実費金額 = 合計

    if (total > 0 && total >= preSale) {
      // 旧シートの確定値: Y列(O列)が合計、X列(N列)が前売分
      var sameDay = total - preSale;
      return { preSale: preSale, sameDay: sameDay, total: total };
    }

    // 確定値なし（新規入力時）: 計算で補完
    var preSaleGuests = v.preSaleGuests || 0;

    // Makuake顧客で前売人数が未入力の場合: 自動推定
    if (preSaleGuests === 0) {
      var cust = getCustomerById(v.customerId);
      if (cust && (cust.channel || '').startsWith('makuake')) {
        // Makuake顧客は基本的に前売利用
        // Airpay金額がある場合はドリンク等の追加分と判断
        preSaleGuests = v.guestCount || 0;
      }
    }

    if (!preSale && preSaleGuests > 0) {
      var unitPrice = resolveUnitPrice(v);
      preSale = preSaleGuests * unitPrice;
    }
    // 当日売上: O列に値があればそれを使う（新フォーマットの当日額）
    // なければAirpay金額を当日売上として使う
    var sameDay = 0;
    if (total > 0) {
      // O列に当日額が直接入っている（ただしpreSaleより小さいケース）
      sameDay = total;
    } else {
      // O列が0: Airpay金額を当日売上とする
      sameDay = (v.airpayAmount || 0);
    }
    return { preSale: preSale, sameDay: sameDay, total: preSale + sameDay };
  }

  // 会員IDから顧客情報を取得
  function getCustomerById(id) {
    return state.customers.find(function (c) { return c.id === id; });
  }

  // チケット残数の内訳を計算（経路別）
  function getTicketBreakdown(customerId) {
    var cust = getCustomerById(customerId);
    if (!cust) return { items: [], totalTickets: 0, usedTickets: 0, remainingTickets: 0 };

    // 経路別の入金をグループ化
    var groups = {};
    state.deposits.forEach(function (d) {
      if (d.customerId !== customerId) return;
      var ch = d.channel || cust.channel || 'stripe';
      if (!groups[ch]) groups[ch] = { channel: ch, deposits: [], totalAmount: 0, tickets: 0, isDeposit: false, expired: 0, expiredTickets: 0 };
      groups[ch].deposits.push(d);
      groups[ch].totalAmount += (d.amount || 0);
      if ((d.memo || '').indexOf('デポジット') >= 0) groups[ch].isDeposit = true;
      if (isExpired(d)) groups[ch].expired += (d.amount || 0);
    });

    // 顧客の基本単価を取得（ランクに基づくインクルーシブ単価）
    function getBaseUnitPrice() {
      var up = resolveUnitPrice({ customerId: customerId, plan: '尾崎牛/インクルーシブ', date: '' });
      if (up > 0) return up;
      up = resolveUnitPrice({ customerId: customerId, plan: '通常/インクルーシブ', date: '' });
      return up > 0 ? up : 17600;
    }

    // 各グループのチケット枚数を算出
    for (var ch in groups) {
      var g = groups[ch];
      g.unit = '人前';

      if (g.isDeposit) {
        // デポジット: 金額ベース（¥17,600単位）
        g.tickets = Math.floor(g.totalAmount / 17600);
        g.expiredTickets = Math.floor(g.expired / 17600);
        g.unit = '人前(金額)';
        continue;
      }

      // メモからチケット枚数を取得
      var memoTickets = 0;
      var memoExpiredTickets = 0;
      for (var i = 0; i < g.deposits.length; i++) {
        var memo = g.deposits[i].memo || '';
        var match = memo.match(/(\d+)名[分》】]/);
        if (!match) match = memo.match(/コース(\d+)名/);
        if (!match) match = memo.match(/コース\D*(\d+)/);
        var cnt = match ? parseInt(match[1]) : 0;
        if (cnt > 0) {
          memoTickets += cnt;
          if (isExpired(g.deposits[i])) memoExpiredTickets += cnt;
        }
      }

      if (memoTickets > 0) {
        g.tickets = memoTickets;
        g.expiredTickets = memoExpiredTickets;
      } else {
        // メモにない場合: 入金額 ÷ 単価 で算出
        var unitPrice = 0;
        if (ch.startsWith('makuake')) {
          unitPrice = calcUnitPriceFromDeposits(cust);
        }
        if (unitPrice <= 0) unitPrice = getBaseUnitPrice();
        if (unitPrice > 0) {
          g.tickets = Math.round(g.totalAmount / unitPrice);
          g.expiredTickets = g.expired > 0 ? Math.round(g.expired / unitPrice) : 0;
        }
      }
    }

    // ticketCountがある場合、単一経路ならそれで上書き（最も信頼できるソース）
    var channelKeys = Object.keys(groups);
    if (cust.ticketCount && cust.ticketCount > 0 && channelKeys.length === 1) {
      groups[channelKeys[0]].tickets = cust.ticketCount;
    }

    // 利用済みチケット数を計算
    // preSaleGuestsがあればそれを使い、なければ preSaleRevenue ÷ 単価 で逆算
    var totalUsedTickets = 0;
    state.visits.forEach(function (v) {
      if (v.customerId !== customerId) return;
      var pg = v.preSaleGuests || 0;
      if (pg > 0) {
        totalUsedTickets += pg;
      } else {
        // preSaleGuestsが未設定の場合: 前売売上から逆算
        var rev = calcVisitRevenue(v);
        if (rev.preSale > 0) {
          var up = v.unitPrice || resolveUnitPrice(v);
          if (up > 0) {
            totalUsedTickets += Math.round(rev.preSale / up);
          }
        }
      }
    });

    // 利用を古い経路から消費（期限切れ分を先に差し引く）
    var remaining = totalUsedTickets;
    var sortedChannels = channelKeys.sort();
    for (var s = 0; s < sortedChannels.length; s++) {
      var g2 = groups[sortedChannels[s]];
      var activeTickets = g2.tickets - g2.expiredTickets;
      var used = Math.min(remaining, activeTickets);
      g2.usedTickets = used;
      g2.remainingTickets = activeTickets - used;
      remaining -= used;
    }

    var items = sortedChannels.map(function (ch) { return groups[ch]; });
    var totalTickets = items.reduce(function (s, g) { return s + g.tickets; }, 0);
    var totalExpired = items.reduce(function (s, g) { return s + g.expiredTickets; }, 0);
    var remainingTickets = items.reduce(function (s, g) { return s + g.remainingTickets; }, 0);

    return {
      items: items,
      totalTickets: totalTickets,
      usedTickets: totalUsedTickets,
      expiredTickets: totalExpired,
      remainingTickets: remainingTickets,
    };
  }

  function getMonths() {
    var set = {};
    state.visits.forEach(function (v) { set[monthOf(v.date)] = true; });
    state.deposits.forEach(function (d) { set[monthOf(d.date)] = true; });
    return Object.keys(set).sort();
  }

  function getCustomerBalance(customerId) {
    var totalDeposit = 0;
    var expiredTotal = 0;
    var totalUsed = 0;
    var expiringDeposits = [];
    state.deposits.forEach(function (d) {
      if (d.customerId !== customerId) return;
      totalDeposit += (d.amount || 0);
      if (isExpired(d)) {
        expiredTotal += (d.amount || 0);
      } else if (d.expiresAt) {
        var days = daysUntilExpiry(d);
        if (days <= 30) expiringDeposits.push({ deposit: d, days: days });
      }
    });
    state.visits.forEach(function (v) {
      if (v.customerId !== customerId) return;
      var rev = calcVisitRevenue(v);
      totalUsed += rev.preSale;
    });
    // 消失額 = 期限切れ額のうち未使用分のみ
    // 利用はまず期限切れ分から消費したとみなす
    // 残高 = 入金総額 - 利用総額 - 消失額  ≥ 0
    var usedFromExpired = Math.min(totalUsed, expiredTotal);
    var lostAmount = expiredTotal - usedFromExpired; // 使わずに失効した分
    var balance = totalDeposit - totalUsed - lostAmount;
    if (balance < 0) balance = 0; // 残高はマイナスにならない
    return {
      totalDeposit: totalDeposit,
      expiredAmount: lostAmount,
      totalUsed: totalUsed,
      balance: balance,
      expiringDeposits: expiringDeposits,
    };
  }

  function getMonthlyStats(month) {
    var monthVisits = state.visits.filter(function (v) { return monthOf(v.date) === month; });
    var preSaleRevenue = 0;
    var sameDayRevenue = 0;
    var totalGuests = 0;
    var groups = monthVisits.length;

    // Channel breakdown
    var channels = { stripe: { preSale: 0, sameDay: 0 }, makuake: { preSale: 0, sameDay: 0 }, '紹介': { preSale: 0, sameDay: 0 }, '身内': { preSale: 0, sameDay: 0 } };

    monthVisits.forEach(function (v) {
      var rev = calcVisitRevenue(v);
      preSaleRevenue += rev.preSale;
      sameDayRevenue += rev.sameDay;
      totalGuests += (v.guestCount || 0);

      // チャネルは会員IDから取得
      var cust = getCustomerById(v.customerId);
      var ch = (cust ? cust.channel : (v.channel || 'stripe')).toLowerCase();
      if (ch.startsWith('makuake')) ch = 'makuake';
      if (!channels[ch]) channels[ch] = { preSale: 0, sameDay: 0 };
      channels[ch].preSale += rev.preSale;
      channels[ch].sameDay += rev.sameDay;
    });

    var totalRevenue = preSaleRevenue + sameDayRevenue;
    var budget = state.budgets.find(function (b) { return b.month === month; });
    var budgetRevenue = budget ? budget.budgetRevenue : 0;

    return {
      totalRevenue: totalRevenue,
      preSaleRevenue: preSaleRevenue,
      sameDayRevenue: sameDayRevenue,
      totalGuests: totalGuests,
      groups: groups,
      avgGuests: groups > 0 ? (totalGuests / groups).toFixed(2) : 0,
      unitPrice: totalGuests > 0 ? Math.round(totalRevenue / totalGuests) : 0,
      budgetRevenue: budgetRevenue,
      channels: channels,
    };
  }

  // 4カテゴリ残高計算
  // 1. Stripe前売券残高（stripe経路の入金 − 利用）
  // 2. デポジット残高（stripe/振込の入金シートデータ、期限なし）
  // 3. Makuake前売券残高（makuake系の有効期限内入金 − 利用）
  // 4. Makuake期限切れ消滅額
  function getBalanceCategories() {
    var stripePreSale = 0;  // Stripe前売残高
    var deposit = 0;        // デポジット残高
    var makuakeActive = 0;  // Makuake有効残高
    var makuakeExpired = 0; // Makuake期限切れ消滅額

    // 入金をカテゴリ別に集計
    var depositByCustomer = {}; // customerId → { stripe: amount, makuake: amount, deposit: amount }
    state.deposits.forEach(function (d) {
      var cid = d.customerId;
      if (!cid) return;
      if (!depositByCustomer[cid]) depositByCustomer[cid] = { stripe: 0, makuake: 0, makuakeExpired: 0, deposit: 0 };

      var ch = (d.channel || '').toLowerCase();
      var isMakuake = ch.startsWith('makuake');
      var isDeposit = ch === '振込' || (ch === 'stripe' && (d.memo || '').indexOf('デポジット') >= 0);

      // デポジット（振込 or stripeデポジット）は独立カテゴリ
      // ただしmakuake_3のデポジット（10万円/20万円）も期限なしでデポジット扱い
      if (ch === '振込') {
        depositByCustomer[cid].deposit += (d.amount || 0);
      } else if (isMakuake) {
        if (isExpired(d)) {
          depositByCustomer[cid].makuakeExpired += (d.amount || 0);
        } else {
          depositByCustomer[cid].makuake += (d.amount || 0);
        }
      } else {
        // stripe
        depositByCustomer[cid].stripe += (d.amount || 0);
      }
    });

    // 来店での前売利用をカテゴリ別に差し引き
    // 前売利用は入金の経路に応じて差し引く（stripeメンバーならstripe、makuakeならmakuake）
    state.customers.forEach(function (c) {
      var cid = c.id;
      var bal = depositByCustomer[cid];
      if (!bal) return;

      // この顧客の前売利用合計
      var totalUsed = 0;
      state.visits.forEach(function (v) {
        if (v.customerId !== cid) return;
        var rev = calcVisitRevenue(v);
        totalUsed += rev.preSale;
      });

      // 利用をカテゴリ順に消費（古いものから）:
      // 期限切れMakuake → 有効Makuake → Stripe → デポジット
      var remaining = totalUsed;
      if (remaining > 0 && bal.makuakeExpired > 0) {
        var use = Math.min(remaining, bal.makuakeExpired);
        bal.makuakeExpired -= use;
        remaining -= use;
      }
      if (remaining > 0 && bal.makuake > 0) {
        var use = Math.min(remaining, bal.makuake);
        bal.makuake -= use;
        remaining -= use;
      }
      if (remaining > 0 && bal.stripe > 0) {
        var use = Math.min(remaining, bal.stripe);
        bal.stripe -= use;
        remaining -= use;
      }
      if (remaining > 0 && bal.deposit > 0) {
        var use = Math.min(remaining, bal.deposit);
        bal.deposit -= use;
        remaining -= use;
      }

      stripePreSale += bal.stripe;
      deposit += bal.deposit;
      makuakeActive += bal.makuake;
      makuakeExpired += bal.makuakeExpired;
    });

    return {
      stripePreSale: stripePreSale,
      deposit: deposit,
      makuakeActive: makuakeActive,
      makuakeExpired: makuakeExpired,
      total: stripePreSale + deposit + makuakeActive,
    };
  }

  // ─── Navigation ───
  function navigateTo(page) {
    state.currentPage = page;
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.mobile-nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.getElementById('page-' + page).classList.add('active');
    // サイドバーナビ
    var navEl = document.querySelector('.sidebar [data-page="' + page + '"]');
    if (navEl) navEl.classList.add('active');
    // モバイルナビ
    var mobEl = document.querySelector('.mobile-nav [data-page="' + page + '"]');
    if (mobEl) mobEl.classList.add('active');
    renderPage(page);
  }

  function renderPage(page) {
    switch (page) {
      case 'guests': renderGuestsPage(); break;
      case 'dashboard': renderDashboard(); break;
      case 'visits': renderVisitsPage(); break;
      case 'customers': renderCustomersPage(); break;
      case 'calendar': renderCalendarPage(); break;
      case 'orders': renderOrdersPage(); break;
      case 'settings': renderSettingsPage(); break;
    }
  }

  // ─── 来客情報ページ ───
  // ─── 来客情報ページ: CSV取り込み初期化 ───
  function initCsvImportForSuffix(suffix) {
    // 取り込みボタン
    document.getElementById('btn-tc-import' + suffix).addEventListener('click', function () {
      importTableCheckCSV(suffix);
    });

    // ファイル選択
    document.getElementById('tc-csv-file' + suffix).addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      document.getElementById('tc-file-name' + suffix).textContent = file.name;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById('tc-csv-input' + suffix).value = ev.target.result;
      };
      reader.readAsText(file, 'UTF-8');
    });

    // ドラッグ＆ドロップ
    var dropZone = document.getElementById('tc-drop-zone' + suffix);
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = '#4f46e5';
      dropZone.style.background = '#f0f0ff';
    });
    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = '#ccc';
      dropZone.style.background = '';
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.borderColor = '#ccc';
      dropZone.style.background = '';
      var file = e.dataTransfer.files[0];
      if (!file) return;
      document.getElementById('tc-file-name' + suffix).textContent = file.name;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById('tc-csv-input' + suffix).value = ev.target.result;
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function initGuestsCsvImport() {
    initCsvImportForSuffix('-guests');
    initCsvImportForSuffix('-today');

    // 当日セクション全体へのドラッグ＆ドロップ対応
    var todaySection = document.querySelector('#guests-list').parentElement;
    todaySection.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      todaySection.style.outline = '2px dashed var(--accent)';
      todaySection.style.outlineOffset = '-2px';
    });
    todaySection.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      todaySection.style.outline = '';
      todaySection.style.outlineOffset = '';
    });
    todaySection.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      todaySection.style.outline = '';
      todaySection.style.outlineOffset = '';
      var file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.csv')) return;
      // 折りたたみを開く
      var details = document.getElementById('today-csv-section');
      if (details) details.open = true;
      document.getElementById('tc-file-name-today').textContent = file.name;
      var reader = new FileReader();
      reader.onload = function (ev) {
        document.getElementById('tc-csv-input-today').value = ev.target.result;
        importTableCheckCSV('-today');
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  // 翌日→当日の自動移行チェック（7:00トリガー）
  function checkGuestTransition() {
    var tomorrow = state.tomorrowGuests || [];
    if (tomorrow.length === 0) return;

    var tomorrowDate = tomorrow[0].date;
    var todayStr = today();

    // 翌日データの日付が今日以前なら移行する
    if (tomorrowDate <= todayStr) {
      state.todayGuests = tomorrow;
      state.tomorrowGuests = [];
      saveLocal();
      syncGuestsToGas();
      if (state.currentPage === 'guests') renderGuestsPage();
    }
  }

  // 7:00トリガーのタイマー設定
  function scheduleGuestTransition() {
    function setNext() {
      var now = new Date();
      var next = new Date(now);
      next.setHours(7, 0, 0, 0);
      if (now >= next) next.setDate(next.getDate() + 1);
      var delay = next.getTime() - now.getTime();
      setTimeout(function () {
        checkGuestTransition();
        setNext(); // 次の7:00を再スケジュール
      }, delay);
    }
    // 起動時にもチェック（7:00過ぎに開いた場合）
    checkGuestTransition();
    setNext();
  }

  // ゲストカード1件分のHTMLを生成（当日/翌日共通）
  function renderGuestCard(g, idx, isToday) {
    var prefix = isToday ? 'today' : 'tomorrow';

    // メモ整形
    var memoDisplay = '';
    var isUrgent = false;
    if (g.memo) {
      var memoLines = g.memo.split(/[\n\r]+/).filter(function(l) { return l.trim(); });
      var cleanLines = [];
      memoLines.forEach(function(line) {
        if (/回答\d*:\s*なし/.test(line)) return;
        if (line.indexOf('ご利用回数') >= 0) return;
        var clean = line.replace(/質問\d+:\s*[^…]*…\s*回答\d+:\s*/, '').trim();
        if (clean) cleanLines.push(clean);
      });
      memoDisplay = cleanLines.join('\n');
      isUrgent = /アレルギー|妊娠|控え|火を通|ご希望|苦手/.test(memoDisplay);
    }

    var alertIcon = isUrgent ? ' <span style="color:var(--red);font-size:16px" title="要確認メモあり">⚠️</span>' : '';
    var balanceTag = '';
    if (g.matched) {
      if (g.balanceAmount > 0) {
        var up = g.unitPrice || 17600;
        var remain = Math.floor(g.balanceAmount / up);
        balanceTag = '<span class="tag" style="background:#e8f5e9;color:#2e7d32">前売あり 残' + remain + '枚</span>';
      } else {
        balanceTag = '<span class="tag" style="background:var(--red-light);color:var(--red)">残高なし</span>';
      }
    } else {
      balanceTag = '<span class="tag" style="background:#f5f5f5;color:var(--text-tertiary)">非会員</span>';
    }

    var orderShort = (g.order || g.plan || '').replace(/\d+\s*×\s*/g, '').trim();
    if (orderShort.length > 30) orderShort = orderShort.substring(0, 30) + '...';

    var isCancelled = !!g.cancelled;
    var cardClass = 'guest-card' + (isCancelled ? ' guest-card--cancelled' : '');

    // キャンセル/復元ボタン
    var cancelBtn = '';
    if (isCancelled) {
      cancelBtn = '<button class="btn guest-restore-btn" data-prefix="' + prefix + '" data-idx="' + idx + '" title="予約を復元">復元</button>';
    } else {
      cancelBtn = '<button class="guest-cancel-btn" data-prefix="' + prefix + '" data-idx="' + idx + '" title="キャンセル">&times;</button>';
    }

    // 人数表示（タップで変更可能）
    var countTag = '<span class="tag guest-count-tag" data-prefix="' + prefix + '" data-idx="' + idx + '" style="cursor:pointer">' +
      (g.guestCount || 0) + '名' + (g.childCount > 0 ? ' + 子供' + g.childCount : '') + '</span>';

    var nameStyle = isCancelled ? 'font-size:18px;font-weight:600;text-decoration:line-through;color:var(--text-tertiary)' : 'font-size:18px;font-weight:600';
    var timeStyle = isCancelled ? 'font-size:20px;font-weight:700;color:var(--text-tertiary)' : 'font-size:20px;font-weight:700;color:var(--accent)';

    var html = '<div class="' + cardClass + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
        '<div style="flex:1;min-width:200px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
            '<span style="' + timeStyle + '">' + (g.time || '-') + '</span>' +
            '<span style="' + nameStyle + '">' + (g.nameKana || g.customerName) + '</span>' +
            alertIcon +
            (isCancelled ? '<span class="tag" style="background:var(--red-light);color:var(--red);font-size:11px">キャンセル</span>' : '') +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px">' +
            '<span class="tag" style="background:var(--accent-light);color:var(--accent)">テーブル ' + (g.table || '-') + '</span>' +
            countTag +
            balanceTag +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
          cancelBtn +
          '<div style="text-align:right;font-size:13px;color:var(--text-secondary)">' +
            '<div style="font-weight:500">' + (g.plan || '') + '</div>' +
            '<div style="font-size:12px;margin-top:2px;color:var(--text-tertiary)">' + orderShort + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (memoDisplay) {
      var memoBg = isUrgent ? 'background:#fff3e0;color:#e65100' : 'background:#f5f5f5;color:var(--text-secondary)';
      var memoIcon = isUrgent ? '⚠️ ' : '📝 ';
      html += '<div style="margin-top:8px;padding:8px 10px;border-radius:6px;font-size:12px;white-space:pre-wrap;' + memoBg + '">' +
        memoIcon + memoDisplay +
      '</div>';
    }

    // 当日のみ売上入力エリアを表示（キャンセル時は非表示）
    if (isToday && !isCancelled) {
      var visitRecord = state.visits.find(function(v) { return v.id === g.id; });
      var currentAirpay = visitRecord ? (visitRecord.airpayAmount || 0) : (g.airpayAmount || 0);
      var currentDrinks = visitRecord ? (visitRecord.sameDayDrinks || 0) : (g.sameDayDrinks || 0);
      var currentAdditional = visitRecord ? (visitRecord.additionalCharges || 0) : (g.additionalCharges || 0);

      html += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px">' +
          '<label style="color:var(--text-tertiary)">当日会計:</label>' +
          '<input type="number" class="guest-airpay" data-idx="' + idx + '" value="' + currentAirpay + '" style="width:80px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px">' +
          '<label style="color:var(--text-tertiary)">ドリンク:</label>' +
          '<input type="number" class="guest-drinks" data-idx="' + idx + '" value="' + currentDrinks + '" style="width:80px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px">' +
          '<label style="color:var(--text-tertiary)">追加料理:</label>' +
          '<input type="number" class="guest-additional" data-idx="' + idx + '" value="' + currentAdditional + '" style="width:80px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px">' +
          '<button class="btn btn-secondary guest-save-btn" data-idx="' + idx + '" style="padding:4px 10px;font-size:12px">保存</button>' +
        '</div>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderGuestsPage() {
    // --- 当日来客情報 ---
    var todayContainer = document.getElementById('guests-list');
    var todayList = state.todayGuests || [];
    var todayDateLabel = todayList.length > 0 ? todayList[0].date : today();
    document.getElementById('guests-date-label').textContent = todayDateLabel;

    var todayActive = todayList.filter(function(g) { return !g.cancelled; });
    var todayCancelled = todayList.filter(function(g) { return !!g.cancelled; });
    var todayTotal = todayActive.reduce(function(s, g) { return s + (g.guestCount || 0); }, 0);
    // プラン別人数集計（キャンセル除外）
    var planCounts = {};
    todayActive.forEach(function(g) {
      var plan = g.plan || '';
      var label = '';
      if (plan.indexOf('尾崎牛') >= 0 || plan.indexOf('尾崎') >= 0) label = '尾崎牛';
      else if (plan.indexOf('会食') >= 0) label = '会食';
      else if (plan.indexOf('中華') >= 0) label = '中華';
      else if (plan.indexOf('鍋') >= 0) label = '鍋';
      else if (plan) label = plan.split('/')[0];
      if (label) planCounts[label] = (planCounts[label] || 0) + (g.guestCount || 0);
    });
    var planBreakdown = Object.keys(planCounts).map(function(k) { return k + planCounts[k] + '名'; }).join('、');
    var cancelNote = todayCancelled.length > 0 ? '（取消' + todayCancelled.length + '組）' : '';
    document.getElementById('guests-total-count').textContent = todayActive.length + '組 / ' + todayTotal + '名' + (planBreakdown ? '　' + planBreakdown : '') + cancelNote;

    if (todayList.length === 0) {
      todayContainer.innerHTML = '<div style="text-align:center;padding:32px 20px;color:var(--text-tertiary)"><p style="font-size:14px;margin:0">当日の来客情報がありません</p><p style="font-size:12px;margin-top:6px;color:var(--text-tertiary)">翌日分のCSVを取り込むと、7:00に自動で当日へ移行します</p></div>';
    } else {
      // キャンセル済みを下に、それ以外は時間順
      todayList.sort(function(a, b) {
        if (!!a.cancelled !== !!b.cancelled) return a.cancelled ? 1 : -1;
        return (a.time || '').localeCompare(b.time || '');
      });
      var todayHtml = '';
      todayList.forEach(function(g, idx) { todayHtml += renderGuestCard(g, idx, true); });
      todayContainer.innerHTML = todayHtml;
      bindGuestCardEvents();
    }

    // --- CSV取り込みセクションの表示切替 ---
    var csvSection = document.getElementById('tc-import-section-guests');
    var tmrwContainer = document.getElementById('tomorrow-guests-list');
    var tmrwList = state.tomorrowGuests || [];
    var hasTomorrow = tmrwList.length > 0;

    // 翌日データがあればCSVセクションを非表示
    csvSection.style.display = hasTomorrow ? 'none' : '';

    var tmrwDate = hasTomorrow ? tmrwList[0].date : '';
    document.getElementById('tomorrow-date-label').textContent = tmrwDate || '';

    var tmrwActive = tmrwList.filter(function(g) { return !g.cancelled; });
    var tmrwCancelled = tmrwList.filter(function(g) { return !!g.cancelled; });
    var tmrwTotal = tmrwActive.reduce(function(s, g) { return s + (g.guestCount || 0); }, 0);
    // プラン別人数集計（翌日、キャンセル除外）
    var tmrwPlanCounts = {};
    tmrwActive.forEach(function(g) {
      var plan = g.plan || '';
      var label = '';
      if (plan.indexOf('尾崎牛') >= 0 || plan.indexOf('尾崎') >= 0) label = '尾崎牛';
      else if (plan.indexOf('会食') >= 0) label = '会食';
      else if (plan.indexOf('中華') >= 0) label = '中華';
      else if (plan.indexOf('鍋') >= 0) label = '鍋';
      else if (plan) label = plan.split('/')[0];
      if (label) tmrwPlanCounts[label] = (tmrwPlanCounts[label] || 0) + (g.guestCount || 0);
    });
    var tmrwPlanBreakdown = Object.keys(tmrwPlanCounts).map(function(k) { return k + tmrwPlanCounts[k] + '名'; }).join('、');
    var tmrwCancelNote = tmrwCancelled.length > 0 ? '（取消' + tmrwCancelled.length + '組）' : '';
    document.getElementById('tomorrow-total-count').textContent = hasTomorrow ? tmrwActive.length + '組 / ' + tmrwTotal + '名' + (tmrwPlanBreakdown ? '　' + tmrwPlanBreakdown : '') + tmrwCancelNote : '';

    if (!hasTomorrow) {
      tmrwContainer.innerHTML = '<div style="text-align:center;padding:32px 20px;color:var(--text-tertiary)"><p style="font-size:14px;margin:0">翌日の予約はまだ取り込まれていません</p><p style="font-size:12px;margin-top:6px;color:var(--text-tertiary)">上のCSV取り込みから予約情報を追加してください</p></div>';
    } else {
      tmrwList.sort(function(a, b) {
        if (!!a.cancelled !== !!b.cancelled) return a.cancelled ? 1 : -1;
        return (a.time || '').localeCompare(b.time || '');
      });
      var tmrwHtml = '<div style="margin-bottom:10px;text-align:right">' +
        '<button class="btn btn-secondary" id="btn-reset-tomorrow" style="font-size:12px;padding:4px 12px">再取り込み</button>' +
        '</div>';
      tmrwList.forEach(function(g, idx) { tmrwHtml += renderGuestCard(g, idx, false); });
      tmrwHtml += '<div style="text-align:center;padding:40px 20px;margin-top:16px">' +
        '<p style="font-size:48px;font-weight:900;color:#e53e3e">今日もおつかれさんでした！！</p>' +
        '</div>';
      tmrwContainer.innerHTML = tmrwHtml;

      // 再取り込みボタン
      document.getElementById('btn-reset-tomorrow').addEventListener('click', function() {
        if (!confirm('翌日の来客情報をリセットして再取り込みしますか？')) return;
        state.tomorrowGuests = [];
        saveLocal();
        syncGuestsToGas();
        renderGuestsPage();
      });
      bindGuestCardEvents();
    }
  }

  // ゲストカードのイベント（キャンセル・復元・人数変更・保存）
  function bindGuestCardEvents() {
    // 保存ボタン
    document.querySelectorAll('.guest-save-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.getAttribute('data-idx'));
        saveGuestSameDay(idx);
      });
    });

    // キャンセルボタン
    document.querySelectorAll('.guest-cancel-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prefix = this.getAttribute('data-prefix');
        var idx = parseInt(this.getAttribute('data-idx'));
        var list = prefix === 'today' ? state.todayGuests : state.tomorrowGuests;
        var g = list[idx];
        if (!g) return;
        if (!confirm((g.nameKana || g.customerName) + ' 様の予約をキャンセルしますか？')) return;
        g.cancelled = true;
        saveLocal();
        syncGuestsToGas();
        renderGuestsPage();
      });
    });

    // 復元ボタン
    document.querySelectorAll('.guest-restore-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prefix = this.getAttribute('data-prefix');
        var idx = parseInt(this.getAttribute('data-idx'));
        var list = prefix === 'today' ? state.todayGuests : state.tomorrowGuests;
        var g = list[idx];
        if (!g) return;
        g.cancelled = false;
        saveLocal();
        syncGuestsToGas();
        renderGuestsPage();
      });
    });

    // 人数変更（タップで入力に切替）
    document.querySelectorAll('.guest-count-tag').forEach(function(tag) {
      tag.addEventListener('click', function() {
        var prefix = this.getAttribute('data-prefix');
        var idx = parseInt(this.getAttribute('data-idx'));
        var list = prefix === 'today' ? state.todayGuests : state.tomorrowGuests;
        var g = list[idx];
        if (!g || g.cancelled) return;

        var input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.inputMode = 'numeric';
        input.value = g.guestCount || 0;
        input.style.cssText = 'width:50px;padding:2px 4px;border:2px solid var(--accent);border-radius:4px;font-size:13px;text-align:center';
        this.replaceWith(input);
        input.focus();
        input.select();

        function saveCount() {
          var newCount = parseInt(input.value) || 0;
          if (newCount < 0) newCount = 0;
          if (newCount !== g.guestCount) {
            g.guestCount = newCount;
            // 前売人数が人数を超えないよう調整
            if (g.preSaleGuests > newCount) g.preSaleGuests = newCount;
            saveLocal();
            syncGuestsToGas();
          }
          renderGuestsPage();
        }

        input.addEventListener('blur', saveCount);
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); saveCount(); }
        });
      });
    });
  }

  // 来客予定をGASに同期
  function syncGuestsToGas() {
    if (!state.gasUrl) return;
    fetch(state.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'saveGuests',
        data: {
          today: state.todayGuests || [],
          tomorrow: state.tomorrowGuests || [],
        }
      }),
    }).catch(function(e) { console.warn('来客予定の同期失敗:', e); });
  }

  async function saveGuestSameDay(idx) {
    var g = state.todayGuests[idx];
    if (!g) return;

    var airpay = Number(document.querySelector('.guest-airpay[data-idx="' + idx + '"]').value) || 0;
    var drinks = Number(document.querySelector('.guest-drinks[data-idx="' + idx + '"]').value) || 0;
    var additional = Number(document.querySelector('.guest-additional[data-idx="' + idx + '"]').value) || 0;

    // todayGuestsを更新
    g.airpayAmount = airpay;
    g.sameDayDrinks = drinks;
    g.additionalCharges = additional;

    // 来店レコードも更新
    var visit = state.visits.find(function(v) { return v.id === g.id; });
    if (visit) {
      visit.airpayAmount = airpay;
      visit.sameDayDrinks = drinks;
      visit.additionalCharges = additional;
      // GASに送信
      try {
        await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'updateVisit', data: {
            id: visit.id,
            airpayAmount: airpay,
            sameDayDrinks: drinks,
            additionalCharges: additional,
          }}),
        });
        showToast((g.nameKana || g.customerName) + ' の売上を保存しました');
      } catch (e) {
        showToast('保存に失敗しました', true);
      }
    }
    saveLocal();
    syncGuestsToGas();
  }

  // ─── Dashboard ───

  function renderDashboard() {
    var todayStr = today();

    // --- 昨日売上 ---
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.toISOString().slice(0, 10);
    var yesterdayVisits = state.visits.filter(function (v) { return v.date === yesterdayStr; });
    var yesterdayRevenue = 0;
    var yesterdayGuests = 0;
    var yesterdayPreSale = 0;
    var yesterdaySameDay = 0;
    yesterdayVisits.forEach(function (v) {
      var rev = calcVisitRevenue(v);
      yesterdayRevenue += rev.total;
      yesterdayPreSale += rev.preSale;
      yesterdaySameDay += rev.sameDay;
      yesterdayGuests += (v.guestCount || 0);
    });
    document.getElementById('kpi-yesterday').textContent = fmtYen(yesterdayRevenue);
    document.getElementById('kpi-yesterday-sub').textContent = yesterdayVisits.length + '組 / ' + yesterdayGuests + '名　前売 ' + fmtYen(yesterdayPreSale) + ' / 当日 ' + fmtYen(yesterdaySameDay);

    // --- 週次売上（今週 月曜〜日曜）---
    var now = new Date();
    var dayOfWeek = now.getDay(); // 0=日, 1=月, ...
    var mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var monday = new Date(now);
    monday.setDate(monday.getDate() - mondayOffset);
    var mondayStr = monday.toISOString().slice(0, 10);
    var weekVisits = state.visits.filter(function (v) { return v.date >= mondayStr && v.date <= todayStr; });
    var weekRevenue = 0;
    var weekGuests = 0;
    var weekPreSale = 0;
    var weekSameDay = 0;
    weekVisits.forEach(function (v) {
      var rev = calcVisitRevenue(v);
      weekRevenue += rev.total;
      weekPreSale += rev.preSale;
      weekSameDay += rev.sameDay;
      weekGuests += (v.guestCount || 0);
    });
    document.getElementById('kpi-weekly').textContent = fmtYen(weekRevenue);
    document.getElementById('kpi-weekly-sub').textContent = weekVisits.length + '組 / ' + weekGuests + '名　前売 ' + fmtYen(weekPreSale) + ' / 当日 ' + fmtYen(weekSameDay);

    // --- 月次売上（今月）---
    var currentMonth = todayStr.slice(0, 7);
    var monthStats = getMonthlyStats(currentMonth);
    document.getElementById('kpi-monthly').textContent = fmtYen(monthStats.totalRevenue);
    document.getElementById('kpi-monthly-sub').textContent = monthStats.groups + '組 / ' + monthStats.totalGuests + '名　前売 ' + fmtYen(monthStats.preSaleRevenue) + ' / 当日 ' + fmtYen(monthStats.sameDayRevenue);

    // --- 客単価（今月）---
    document.getElementById('kpi-unit-price').textContent = fmtYen(monthStats.unitPrice);
    var totalDrinks = 0;
    state.visits.filter(function (v) { return monthOf(v.date) === currentMonth; }).forEach(function (v) {
      totalDrinks += (v.sameDayDrinks || 0);
    });
    var drinkUnit = monthStats.totalGuests > 0 ? Math.round(totalDrinks / monthStats.totalGuests) : 0;
    document.getElementById('kpi-unit-sub').textContent = 'ドリンク単価 ' + fmtYen(drinkUnit);

    // --- 残営業日（カレンダーデータを参照）---
    var todayDate = new Date();
    var lastDay = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
    var remaining = 0;
    var totalOpen = 0;
    for (var d = 1; d <= lastDay; d++) {
      var chkStr = currentMonth + '-' + String(d).padStart(2, '0');
      var calInfo = getCalDay(chkStr);
      if (calInfo.open) {
        totalOpen++;
        if (d > todayDate.getDate()) remaining++;
      }
    }
    document.getElementById('kpi-remaining-days').textContent = remaining + '日';
    document.getElementById('kpi-remaining-sub').textContent = '営業日 ' + totalOpen + '日 / ' + lastDay + '日';

    // --- 年間売上（8月始まり）---
    var fy = todayDate.getMonth() >= 7 ? todayDate.getFullYear() : todayDate.getFullYear() - 1; // 8月=7
    var fyStart = fy + '-08-01';
    var fyEnd = (fy + 1) + '-07-31';
    var yearVisits = state.visits.filter(function (v) { return v.date >= fyStart && v.date <= fyEnd; });
    var yearRevenue = 0;
    var yearGuests = 0;
    var yearPreSale = 0;
    var yearSameDay = 0;
    yearVisits.forEach(function (v) {
      var rev = calcVisitRevenue(v);
      yearRevenue += rev.total;
      yearPreSale += rev.preSale;
      yearSameDay += rev.sameDay;
      yearGuests += (v.guestCount || 0);
    });
    document.getElementById('kpi-yearly').textContent = fmtYen(yearRevenue);
    document.getElementById('kpi-yearly-sub').textContent = yearVisits.length + '組 / ' + yearGuests + '名　前売 ' + fmtYen(yearPreSale) + ' / 当日 ' + fmtYen(yearSameDay);
    var periodEl = document.getElementById('kpi-yearly-period');
    if (periodEl) periodEl.textContent = fy + '年8月 〜 ' + (fy + 1) + '年7月';

    // --- リピート率（既存顧客の来店回数分布）---
    var custVisitCount = {};
    state.visits.forEach(function (v) {
      if (!v.customerId) return;
      custVisitCount[v.customerId] = (custVisitCount[v.customerId] || 0) + 1;
    });
    var totalCust = Object.keys(custVisitCount).length;
    var repeat2 = 0, repeat3 = 0, repeat4 = 0;
    Object.keys(custVisitCount).forEach(function (id) {
      var c = custVisitCount[id];
      if (c >= 2) repeat2++;
      if (c >= 3) repeat3++;
      if (c >= 4) repeat4++;
    });
    var r2pct = totalCust > 0 ? (repeat2 / totalCust * 100).toFixed(1) : 0;
    var r3pct = totalCust > 0 ? (repeat3 / totalCust * 100).toFixed(1) : 0;
    var r4pct = totalCust > 0 ? (repeat4 / totalCust * 100).toFixed(1) : 0;
    document.getElementById('kpi-repeat2').textContent = r2pct + '%';
    document.getElementById('kpi-repeat2-sub').textContent = repeat2 + '人 / ' + totalCust + '人';
    document.getElementById('kpi-repeat3').textContent = r3pct + '%';
    document.getElementById('kpi-repeat3-sub').textContent = repeat3 + '人 / ' + totalCust + '人';
    document.getElementById('kpi-repeat4').textContent = r4pct + '%';
    document.getElementById('kpi-repeat4-sub').textContent = repeat4 + '人 / ' + totalCust + '人';

    // --- 直近の来店（2日間）---
    renderRecentVisits();
  }

  function renderRecentVisits() {
    // 直近5日分の日付を取得
    var allDates = [];
    state.visits.forEach(function (v) {
      if (allDates.indexOf(v.date) < 0) allDates.push(v.date);
    });
    allDates.sort(function (a, b) { return b.localeCompare(a); });
    var recentDates = allDates.slice(0, 5);

    var monthVisits = state.visits
      .filter(function (v) { return recentDates.indexOf(v.date) >= 0; })
      .sort(function (a, b) { return b.date.localeCompare(a.date) || (a.customerId || '').localeCompare(b.customerId || ''); });

    var tbody = document.querySelector('#recent-visits-table tbody');
    tbody.innerHTML = monthVisits.map(function (v) {
      var rev = calcVisitRevenue(v);
      var cust = getCustomerById(v.customerId);
      var name = cust ? cust.name : (v.customerName || v.customerId || '');
      var rank = cust ? cust.rank : (v.rank || '');
      var sameDayVal = rev.sameDay;
      var noSales = (v.airpayAmount || 0) === 0 && (v.sameDayDrinks || 0) === 0 && (v.additionalCharges || 0) === 0;
      var sameDayCell = noSales
        ? '<span style="color:var(--red);font-weight:600">未入力</span>'
        : fmtYen(sameDayVal);
      return '<tr' + (noSales ? ' style="background:var(--amber-light)"' : '') + '>' +
        '<td>' + v.date + '</td>' +
        '<td style="font-weight:500">' + name + '</td>' +
        '<td><span class="tag tag-rank">' + rank + '</span></td>' +
        '<td class="num">' + (v.guestCount || 0) + '名</td>' +
        '<td>' + (v.plan || '') + '</td>' +
        '<td class="num">' + fmtYen(rev.preSale) + '</td>' +
        '<td class="num">' + sameDayCell + '</td>' +
        '<td><button class="row-btn recent-edit-btn" data-id="' + v.id + '">編集</button></td>' +
        '</tr>';
    }).join('');

    // 編集ボタンのイベント
    tbody.querySelectorAll('.recent-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openSalesEditModal(this.dataset.id);
      });
    });
  }

  // 売上簡易編集モーダル
  function openSalesEditModal(visitId) {
    var v = state.visits.find(function (x) { return x.id === visitId; });
    if (!v) return;
    var cust = getCustomerById(v.customerId);
    var name = cust ? cust.name : (v.customerName || v.customerId || '');

    // 既存モーダルを流用せず、動的に作成
    var existing = document.getElementById('sales-edit-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'sales-edit-modal';
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-backdrop" id="sales-edit-backdrop"></div>' +
      '<div class="modal-content" style="max-width:400px">' +
        '<div class="modal-header">' +
          '<h2>売上入力</h2>' +
          '<button class="modal-close" id="sales-edit-close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '</div>' +
        '<div style="margin-bottom:16px">' +
          '<div style="font-size:14px;font-weight:600">' + name + '</div>' +
          '<div style="font-size:12px;color:var(--text-tertiary)">' + v.date + '　' + (v.guestCount || 0) + '名　' + (v.plan || '') + '</div>' +
        '</div>' +
        '<div class="form-grid" style="grid-template-columns:1fr">' +
          '<div class="form-group">' +
            '<label>Airpay金額（当日会計）</label>' +
            '<input type="number" id="se-airpay" value="' + (v.airpayAmount || 0) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>当日ドリンク</label>' +
            '<input type="number" id="se-drinks" value="' + (v.sameDayDrinks || 0) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>追加料理</label>' +
            '<input type="number" id="se-additional" value="' + (v.additionalCharges || 0) + '">' +
          '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" id="se-cancel">キャンセル</button>' +
          '<button class="btn btn-primary" id="se-save">保存</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // イベント
    var close = function () { modal.remove(); };
    document.getElementById('sales-edit-backdrop').addEventListener('click', close);
    document.getElementById('sales-edit-close').addEventListener('click', close);
    document.getElementById('se-cancel').addEventListener('click', close);

    document.getElementById('se-save').addEventListener('click', async function () {
      var airpay = parseInt(document.getElementById('se-airpay').value) || 0;
      var drinks = parseInt(document.getElementById('se-drinks').value) || 0;
      var additional = parseInt(document.getElementById('se-additional').value) || 0;

      v.airpayAmount = airpay;
      v.sameDayDrinks = drinks;
      v.additionalCharges = additional;
      saveLocal();

      // GASに保存
      if (state.gasUrl) {
        try {
          await fetch(state.gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              action: 'updateVisit',
              data: {
                id: v.id,
                airpayAmount: airpay,
                sameDayDrinks: drinks,
                additionalCharges: additional,
              }
            }),
          });
        } catch (e) {
          console.warn('GAS更新失敗:', e);
        }
      }

      close();
      showToast(name + ' の売上を保存しました');
      renderDashboard();
    });
  }

  // ─── Expiry Warnings ───

  // ─── Makuake CSV Import ───
  function initMakuakeImport() {
    var btn = document.getElementById('btn-import-makuake');
    var fileInput = document.getElementById('makuake-csv-file');
    if (!btn || !fileInput) return;

    btn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        parseMakuakeCSV(ev.target.result);
      };
      reader.readAsText(file, 'Shift_JIS');
      e.target.value = '';
    });
  }

  function parseMakuakeCSV(csvText) {
    var lines = csvText.split(/\r?\n/);
    if (lines.length < 2) { showToast('CSVが空です', true); return; }

    var headers = lines[0].split(',').map(function (h) { return h.replace(/"/g, '').trim(); });
    var added = 0;
    var skipped = 0;

    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var cols = lines[i].split(',').map(function (c) { return c.replace(/"/g, '').trim(); });
      var row = {};
      headers.forEach(function (h, idx) { row[h] = cols[idx] || ''; });

      // Try to find relevant columns (Makuake CSV varies, adapt as needed)
      var name = row['お名前'] || row['氏名'] || row['名前'] || row['支援者名'] || '';
      var amount = parseInt(row['支援金額'] || row['金額'] || row['リターン金額'] || '0', 10);
      var date = row['支援日時'] || row['購入日'] || row['申込日'] || '';
      var memo = row['リターン名'] || row['リターン'] || row['コース名'] || '';

      if (!name || !amount) { skipped++; continue; }

      // Normalize date to YYYY-MM-DD
      date = normalizeDate(date);
      if (!date) { skipped++; continue; }

      // Check for duplicates
      var isDup = state.deposits.some(function (d) {
        return d.customerName === name && d.amount === amount && d.date === date && d.channel.startsWith('makuake');
      });
      if (isDup) { skipped++; continue; }

      // Find or create customer
      var customer = state.customers.find(function (c) { return c.name === name; });
      if (!customer) {
        customer = { id: 'M-' + uid(), name: name, nameKana: '', rank: 'ノーマル', channel: 'makuake', phone: '', memo: memo };
        state.customers.push(customer);
      }

      state.deposits.push({
        id: 'd-' + uid(),
        date: date,
        customerId: customer.id,
        customerName: name,
        channel: 'makuake',
        amount: amount,
        memo: memo,
        expiresAt: addMonths(date, 6),
      });
      added++;
    }

    saveLocal();
    updateCustomerDatalist();
    showToast(added + '件の入金を取り込みました' + (skipped ? '（' + skipped + '件スキップ）' : ''));
    renderPage(state.currentPage);
  }

  function normalizeDate(str) {
    if (!str) return '';
    // Handle various formats: 2025/03/15, 2025-03-15, 2025年3月15日, etc.
    var m = str.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    return '';
  }

  // (Airpay突合は削除済み — ダッシュボード簡素化)

  // ─── Visits Page ───
  function renderVisitsPage() {
    renderVisitsMonthFilter();
    renderVisitsTable();
  }

  function renderVisitsMonthFilter() {
    var months = getMonths();
    var sel = document.getElementById('visits-month-filter');
    sel.innerHTML = '<option value="">全期間</option>' +
      months.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
    sel.onchange = renderVisitsTable;
    document.getElementById('visits-search').oninput = renderVisitsTable;
  }

  function renderVisitsTable() {
    var monthFilter = document.getElementById('visits-month-filter').value;
    var search = (document.getElementById('visits-search').value || '').toLowerCase();

    var filtered = state.visits.filter(function (v) {
      if (monthFilter && monthOf(v.date) !== monthFilter) return false;
      var cust = getCustomerById(v.customerId);
      var name = cust ? cust.name : (v.customerName || v.customerId || '');
      if (search && !name.toLowerCase().includes(search)) return false;
      return true;
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });

    var tbody = document.querySelector('#visits-table tbody');
    tbody.innerHTML = filtered.map(function (v) {
      var rev = calcVisitRevenue(v);
      var cust = getCustomerById(v.customerId);
      var name = cust ? cust.name : (v.customerName || v.customerId || '');
      var rank = cust ? cust.rank : (v.rank || '');
      var ch = cust ? cust.channel : (v.channel || '');
      var isPreSale = (v.preSaleGuests || 0) > 0;
      return '<tr>' +
        '<td>' + v.date + '</td>' +
        '<td style="font-weight:500">' + name + '</td>' +
        '<td><span class="tag tag-rank">' + rank + '</span></td>' +
        '<td>' + ch + '</td>' +
        '<td class="num">' + (v.guestCount || 0) + '</td>' +
        '<td>' + (isPreSale ? '<span class="tag tag-presale">前売</span>' : '<span class="tag tag-sameday">当日</span>') + '</td>' +
        '<td>' + (v.plan || '') + '</td>' +
        '<td class="num">' + fmtYen(rev.preSale) + '</td>' +
        '<td class="num">' + fmtYen(rev.sameDay) + '</td>' +
        '<td class="num" style="font-weight:600">' + fmtYen(rev.total) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="row-btn" onclick="INAI.editVisit(\'' + v.id + '\')">編集</button>' +
          '<button class="row-btn danger" onclick="INAI.deleteVisit(\'' + v.id + '\')">削除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  // ─── Customers Page ───
  function renderCustomersPage() {
    renderCustomerFilters();
    renderCustomersTable();
  }

  function renderCustomerFilters() {
    var sel = document.getElementById('customers-rank-filter');
    sel.innerHTML = '<option value="">全経路</option>' +
      '<option value="stripe">stripe</option>' +
      '<option value="makuake">makuake</option>' +
      '<option value="makuake_2">makuake_2</option>' +
      '<option value="makuake_3">makuake_3</option>' +
      '<option value="紹介">invitation</option>' +
      '<option value="身内">family</option>';
    sel.onchange = renderCustomersTable;
    document.getElementById('customers-search').oninput = renderCustomersTable;
  }

  function renderCustomersTable() {
    var search = (document.getElementById('customers-search').value || '').toLowerCase();
    var channelFilter = document.getElementById('customers-rank-filter').value;

    var filtered = state.customers.filter(function (c) {
      if (channelFilter && (c.channel || '') !== channelFilter) return false;
      if (search) {
        var hay = ((c.name || '') + ' ' + (c.nameKana || '') + ' ' + (c.id || '')).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    var tbody = document.querySelector('#customers-table tbody');
    tbody.innerHTML = filtered.map(function (c) {
      var b = getCustomerBalance(c.id);
      var tb = getTicketBreakdown(c.id);
      var visitCount = state.visits.filter(function (v) { return v.customerId === c.id; }).length;
      // チケット残数のサマリー表示
      var ticketSummary = '';
      if (tb.items.length > 0) {
        ticketSummary = tb.items.map(function (item) {
          var label = item.channel.replace('makuake_', 'M').replace('makuake', 'M1');
          if (item.channel === 'stripe') label = 'S';
          if (item.channel === '紹介') label = '紹介';
          if (item.channel === '身内') label = '身内';
          var color = item.remainingTickets > 0 ? 'var(--accent)' : 'var(--text-tertiary)';
          return '<span style="color:' + color + '">' + label + ':' + item.remainingTickets + '</span>';
        }).join(' ');
      }
      return '<tr style="cursor:pointer" onclick="INAI.showCustomerDetail(\'' + c.id + '\')">' +
        '<td>' + c.id + '</td>' +
        '<td style="font-weight:500">' + c.name + '</td>' +
        '<td style="font-size:12px;color:var(--text-tertiary)">' + (c.nameKana || '') + '</td>' +
        '<td><span class="tag tag-rank">' + (c.rank || '') + '</span></td>' +
        '<td>' + (c.channel || '') + '</td>' +
        '<td class="num">' + fmtYen(b.totalDeposit) + '</td>' +
        '<td class="num">' + fmtYen(b.totalUsed) + '</td>' +
        '<td class="num" style="' + (b.expiredAmount > 0 ? 'color:var(--red)' : '') + '">' + fmtYen(b.expiredAmount) + '</td>' +
        '<td class="num" style="font-weight:700;color:' + (b.balance > 0 ? 'var(--accent)' : 'inherit') + '">' + fmtYen(b.balance) + '</td>' +
        '<td class="num" style="font-size:12px;white-space:nowrap">' + (ticketSummary || '-') + '</td>' +
        '<td class="num">' + visitCount + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="row-btn" onclick="event.stopPropagation();INAI.editCustomer(\'' + c.id + '\')">編集</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  // ─── Calendar Page ───
  var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  var STAFF_MEMBERS = ['里', '近友', '土井', '成田', '池本', '本澤'];
  var STAFF_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444'];

  function initCalendarPage() {
    document.getElementById('cal-prev-month').addEventListener('click', function () {
      var parts = state.calendarMonth.split('-');
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 2, 1);
      state.calendarMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderCalendarPage();
    });
    document.getElementById('cal-next-month').addEventListener('click', function () {
      var parts = state.calendarMonth.split('-');
      var d = new Date(parseInt(parts[0]), parseInt(parts[1]), 1);
      state.calendarMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderCalendarPage();
    });
  }

  function getCalDay(dateStr) {
    if (!state.calendarData[dateStr]) {
      var d = new Date(dateStr);
      state.calendarData[dateStr] = {
        open: d.getDay() !== 0,  // デフォルト: 日曜定休
        staffNames: [],          // 営業スタッフ名の配列（最大4名）
        catering: false,         // ケータリングフラグ
        cateringStaff: [],       // ケータリングスタッフ名の配列（最大4名）
        memo: '',
      };
    }
    var info = state.calendarData[dateStr];
    if (!info.staffNames) info.staffNames = [];
    if (!info.cateringStaff) info.cateringStaff = [];
    return info;
  }

  // カレンダーセル1つ分のHTML生成
  function buildCalCell(cellDay, col, month) {
    var dateStr = month + '-' + String(cellDay).padStart(2, '0');
    var info = getCalDay(dateStr);
    var todayStr = today();
    var isToday = dateStr === todayStr;
    var isSunday = col === 6;
    var isSaturday = col === 5;

    var cellBg = '';
    if (!info.open) cellBg = 'background:#e0e0e0;';
    else if (isToday) cellBg = 'background:#e8f0fe;';

    var dayColor = isSunday ? 'color:#e53e3e;' : isSaturday ? 'color:#2563eb;' : '';
    if (!info.open) dayColor = 'color:#999;';

    var visitCount = state.visits.filter(function (v) { return v.date === dateStr; }).length;
    var names = info.staffNames || [];

    var html = '<td class="cal-cell" data-date="' + dateStr + '" style="' + cellBg + '">';

    // 日付ヘッダー行
    html += '<div class="cal-day-header">';
    html += '<span class="cal-day-num" style="' + dayColor + (isToday ? 'background:var(--accent);color:#fff;border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;' : '') + '">' + cellDay + '</span>';
    if (!info.open) html += '<span style="font-size:10px;color:#888;font-weight:600">休</span>';
    if (visitCount > 0) html += '<span style="font-size:10px;color:var(--text-tertiary)">🍽' + visitCount + '</span>';
    html += '</div>';

    // スタッフ名リスト（横並び）
    if (info.open && names.length > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">';
      names.forEach(function (name, i) {
        var color = STAFF_COLORS[i % STAFF_COLORS.length];
        html += '<span class="cal-staff-tag" style="border-left:3px solid ' + color + '">' + name + '</span>';
      });
      html += '</div>';
    }

    // ケータリング
    var cNames = info.cateringStaff || [];
    if (info.catering) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:3px;align-items:center">';
      html += '<span style="font-size:10px;color:#d32f2f;font-weight:700">※</span>';
      cNames.forEach(function (name) {
        html += '<span style="font-size:11px;color:#d32f2f;font-weight:500">' + name + '</span>';
      });
      html += '</div>';
    }

    // メモ
    if (info.memo) {
      var short = info.memo.length > 8 ? info.memo.substring(0, 8) + '..' : info.memo;
      html += '<div style="font-size:9px;color:#e65100;margin-top:2px;line-height:1.2">' + short + '</div>';
    }

    html += '</td>';
    return html;
  }

  function renderCalendarPage() {
    if (!state.calendarMonth) state.calendarMonth = today().slice(0, 7);
    var month = state.calendarMonth;
    var parts = month.split('-');
    var year = parseInt(parts[0]);
    var mon = parseInt(parts[1]);

    document.getElementById('cal-month-label').textContent = year + '年' + mon + '月';

    var firstDate = new Date(year, mon - 1, 1);
    var lastDay = new Date(year, mon, 0).getDate();
    var firstDow = firstDate.getDay();
    var startOffset = firstDow === 0 ? 6 : firstDow - 1;

    var calBody = document.getElementById('cal-body');
    var html = '';

    for (var row = 0; row < 6; row++) {
      var hasDay = false;
      var rowHtml = '<tr>';
      for (var col = 0; col < 7; col++) {
        var cellDay = row * 7 + col - startOffset + 1;
        if (cellDay < 1 || cellDay > lastDay) {
          rowHtml += '<td class="cal-cell cal-empty"></td>';
        } else {
          hasDay = true;
          rowHtml += buildCalCell(cellDay, col, month);
        }
      }
      rowHtml += '</tr>';
      if (hasDay) html += rowHtml;
    }
    calBody.innerHTML = html;

    // セルクリック
    calBody.querySelectorAll('td[data-date]').forEach(function (td) {
      td.addEventListener('click', function () {
        editCalendarDay(td.getAttribute('data-date'));
      });
    });

    // シフト一覧テーブル描画
    renderShiftTable(year, mon, lastDay);
  }

  function renderShiftTable(year, mon, lastDay) {
    var shiftBody = document.getElementById('shift-body');
    var todayStr = today();
    var html = '';

    for (var d = 1; d <= lastDay; d++) {
      var dateStr = state.calendarMonth + '-' + String(d).padStart(2, '0');
      var info = getCalDay(dateStr);
      var dt = new Date(year, mon - 1, d);
      var dow = DAY_NAMES[dt.getDay()];
      var isSunday = dt.getDay() === 0;
      var isSaturday = dt.getDay() === 6;
      var isToday = dateStr === todayStr;
      var names = info.staffNames || [];

      var rowStyle = '';
      if (isToday) rowStyle = 'background:#fef9c3;font-weight:700;';
      else if (!info.open) rowStyle = 'background:#e0e0e0;color:#888;';

      var dowStyle = isSunday ? 'color:#e53e3e' : isSaturday ? 'color:#2563eb' : '';

      html += '<tr style="' + rowStyle + 'border-bottom:1px solid #f0f0f0">';
      html += '<td style="padding:6px 8px;white-space:nowrap">' + d + '日</td>';
      html += '<td style="padding:6px 8px;' + dowStyle + '">' + dow + '</td>';
      html += '<td style="padding:6px 8px;text-align:center">';
      html += '<input type="checkbox" class="shift-closed" data-date="' + dateStr + '" ' + (!info.open ? 'checked' : '') + '>';
      html += '</td>';

      // スタッフ名プルダウン（4枠）— 休みの日は非表示
      html += '<td style="padding:2px 4px">';
      if (info.open) {
        html += '<div style="display:flex;gap:2px;flex-wrap:wrap">';
        for (var s = 0; s < 4; s++) {
          var val = names[s] || '';
          var borderColor = val ? STAFF_COLORS[s % STAFF_COLORS.length] : '#ddd';
          html += '<select class="shift-name" data-date="' + dateStr + '" data-slot="' + s + '" style="width:55px;padding:1px 1px;border:1px solid ' + borderColor + ';border-left:3px solid ' + borderColor + ';border-radius:4px;font-size:12px;background:#fff">';
          html += '<option value="">-</option>';
          STAFF_MEMBERS.forEach(function (m) {
            html += '<option value="' + m + '"' + (val === m ? ' selected' : '') + '>' + m + '</option>';
          });
          html += '</select>';
        }
        html += '</div>';
      }
      html += '</td>';

      // ケータリングフラグ（スタッフ列とケータリング人員列の間、幅を詰める）
      var hasCatering = !!info.catering;
      html += '<td style="padding:0 2px;text-align:center;width:22px">';
      html += '<input type="checkbox" class="shift-catering-flag" data-date="' + dateStr + '" ' + (hasCatering ? 'checked' : '') + '>';
      html += '</td>';

      // ケータリング人員プルダウン（4枠）— フラグONのみ表示
      var cNames = info.cateringStaff || [];
      html += '<td style="padding:2px 4px">';
      if (hasCatering) {
        html += '<div style="display:flex;gap:2px;flex-wrap:wrap">';
        for (var cs = 0; cs < 4; cs++) {
          var cVal = cNames[cs] || '';
          var cBorder = cVal ? '#d32f2f' : '#ddd';
          html += '<select class="shift-catering-name" data-date="' + dateStr + '" data-slot="' + cs + '" style="width:55px;padding:1px 1px;border:1px solid ' + cBorder + ';border-left:3px solid ' + cBorder + ';border-radius:4px;font-size:12px;background:#fff">';
          html += '<option value="">-</option>';
          STAFF_MEMBERS.forEach(function (m) {
            html += '<option value="' + m + '"' + (cVal === m ? ' selected' : '') + '>' + m + '</option>';
          });
          html += '</select>';
        }
        html += '</div>';
      }
      html += '</td>';

      // メモ
      html += '<td style="padding:4px 6px">';
      html += '<input type="text" class="shift-memo" data-date="' + dateStr + '" value="' + (info.memo || '').replace(/"/g, '&quot;') + '" placeholder="" style="width:100%;padding:2px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px">';
      html += '</td>';
      html += '</tr>';
    }
    shiftBody.innerHTML = html;

    // イベント: 営業ON/OFF
    shiftBody.querySelectorAll('.shift-closed').forEach(function (cb) {
      cb.addEventListener('change', function () {
        getCalDay(cb.getAttribute('data-date')).open = !cb.checked;
        saveLocal();
        renderCalendarPage();
      });
    });
    // イベント: スタッフ名
    shiftBody.querySelectorAll('.shift-name').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var dateStr = inp.getAttribute('data-date');
        var slot = parseInt(inp.getAttribute('data-slot'));
        var info = getCalDay(dateStr);
        // 配列を最大4で維持
        while (info.staffNames.length < 4) info.staffNames.push('');
        info.staffNames[slot] = inp.value.trim();
        // 末尾の空を除去
        while (info.staffNames.length > 0 && !info.staffNames[info.staffNames.length - 1]) info.staffNames.pop();
        saveLocal();
        renderCalendarGrid();
      });
    });
    // イベント: ケータリングフラグ
    shiftBody.querySelectorAll('.shift-catering-flag').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var dateStr = cb.getAttribute('data-date');
        var info = getCalDay(dateStr);
        info.catering = cb.checked;
        if (!cb.checked) info.cateringStaff = [];
        saveLocal();
        renderCalendarPage();
      });
    });
    // イベント: ケータリング人員
    shiftBody.querySelectorAll('.shift-catering-name').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var dateStr = inp.getAttribute('data-date');
        var slot = parseInt(inp.getAttribute('data-slot'));
        var info = getCalDay(dateStr);
        while (info.cateringStaff.length < 4) info.cateringStaff.push('');
        info.cateringStaff[slot] = inp.value.trim();
        while (info.cateringStaff.length > 0 && !info.cateringStaff[info.cateringStaff.length - 1]) info.cateringStaff.pop();
        saveLocal();
        renderCalendarGrid();
      });
    });
    // イベント: メモ
    shiftBody.querySelectorAll('.shift-memo').forEach(function (inp) {
      inp.addEventListener('change', function () {
        getCalDay(inp.getAttribute('data-date')).memo = inp.value;
        saveLocal();
        renderCalendarGrid();
      });
    });
  }

  // カレンダーグリッドだけ再描画（一覧テーブルは維持）
  function renderCalendarGrid() {
    var month = state.calendarMonth;
    var parts = month.split('-');
    var year = parseInt(parts[0]);
    var mon = parseInt(parts[1]);
    var lastDay = new Date(year, mon, 0).getDate();
    var firstDow = new Date(year, mon - 1, 1).getDay();
    var startOffset = firstDow === 0 ? 6 : firstDow - 1;

    var calBody = document.getElementById('cal-body');
    var html = '';

    for (var row = 0; row < 6; row++) {
      var hasDay = false;
      var rowHtml = '<tr>';
      for (var col = 0; col < 7; col++) {
        var cellDay = row * 7 + col - startOffset + 1;
        if (cellDay < 1 || cellDay > lastDay) {
          rowHtml += '<td class="cal-cell cal-empty"></td>';
        } else {
          hasDay = true;
          rowHtml += buildCalCell(cellDay, col, month);
        }
      }
      rowHtml += '</tr>';
      if (hasDay) html += rowHtml;
    }
    calBody.innerHTML = html;

    calBody.querySelectorAll('td[data-date]').forEach(function (td) {
      td.addEventListener('click', function () {
        editCalendarDay(td.getAttribute('data-date'));
      });
    });
  }

  function editCalendarDay(dateStr) {
    // シフト一覧の該当行にスクロール
    var target = document.querySelector('.shift-name[data-date="' + dateStr + '"][data-slot="0"]');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus();
      target.style.boxShadow = '0 0 0 2px var(--accent)';
      setTimeout(function () { target.style.boxShadow = ''; }, 2000);
    }
  }

  // ─── Settings Page ───
  function renderSettingsPage() {
    document.getElementById('settings-gas-url').value = getGasUrl() || '';
    renderBudgetList();
  }

  function renderBudgetList() {
    var container = document.getElementById('budget-list');
    container.innerHTML = state.budgets.map(function (b, i) {
      return '<div class="budget-row">' +
        '<input type="month" value="' + b.month + '" onchange="INAI.updateBudget(' + i + ',\'month\',this.value)">' +
        '<input type="number" value="' + b.budgetRevenue + '" placeholder="売上目標" onchange="INAI.updateBudget(' + i + ',\'budgetRevenue\',Number(this.value))">' +
        '<span style="font-size:0.75rem;color:var(--text-tertiary)">円</span>' +
        '<button class="row-btn danger" onclick="INAI.deleteBudget(' + i + ')">削除</button>' +
        '</div>';
    }).join('');
  }

  // ─── Modal Helpers ───
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  function initModals() {
    document.querySelectorAll('[data-dismiss="modal"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modal = btn.closest('.modal');
        if (modal) modal.classList.add('hidden');
      });
    });
    document.querySelectorAll('.modal-backdrop').forEach(function (bg) {
      bg.addEventListener('click', function () {
        bg.closest('.modal').classList.add('hidden');
      });
    });
  }

  // ─── Customer Datalist ───
  function updateCustomerDatalist() {
    var html = state.customers.map(function (c) {
      return '<option value="' + c.name + '" data-id="' + c.id + '">';
    }).join('');
    document.getElementById('customer-list').innerHTML = html;
    document.getElementById('deposit-customer-list').innerHTML = html;
  }

  function findCustomerByName(name) {
    return state.customers.find(function (c) { return c.name === name; });
  }

  // ─── Visit Form ───
  function initVisitForm() {
    var form = document.getElementById('visit-form');
    var customerInput = document.getElementById('vf-customer');

    customerInput.addEventListener('input', function () {
      var c = findCustomerByName(customerInput.value);
      var info = document.getElementById('vf-customer-info');
      if (c) {
        var b = getCustomerBalance(c.id);
        info.textContent = c.rank + ' | 残高: ' + fmtYen(b.balance);
        document.getElementById('vf-channel').value = c.channel || 'stripe';
      } else {
        info.textContent = '';
      }
      calcVisitPreview();
    });

    // Auto-calculate
    ['vf-guests', 'vf-presale-guests', 'vf-sameday-guests', 'vf-unit-price', 'vf-food-total',
     'vf-child-fee', 'vf-airpay', 'vf-drinks', 'vf-additional'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', calcVisitPreview);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveVisit();
    });

    document.getElementById('btn-add-visit').addEventListener('click', function () {
      resetVisitForm();
      openModal('visit-modal');
    });

    // TC CSV取り込みは来客情報ページに移動済み
  }

  function calcVisitPreview() {
    var preSaleGuests = Number(document.getElementById('vf-presale-guests').value) || 0;
    var unitPrice = Number(document.getElementById('vf-unit-price').value) || 0;
    var foodTotal = Number(document.getElementById('vf-food-total').value) || 0;
    var sameDayGuests = Number(document.getElementById('vf-sameday-guests').value) || 0;
    var airpay = Number(document.getElementById('vf-airpay').value) || 0;
    var drinks = Number(document.getElementById('vf-drinks').value) || 0;
    var additional = Number(document.getElementById('vf-additional').value) || 0;

    var preSaleRevenue = preSaleGuests * unitPrice;
    if (foodTotal > 0 && foodTotal < preSaleRevenue) preSaleRevenue = foodTotal;

    var sameDayRevenue = airpay + drinks + additional;
    if (sameDayGuests > 0 && sameDayRevenue === 0) {
      sameDayRevenue = sameDayGuests * unitPrice;
    }

    var total = preSaleRevenue + sameDayRevenue;

    document.getElementById('vf-calc-presale').textContent = fmtYen(preSaleRevenue);
    document.getElementById('vf-calc-sameday').textContent = fmtYen(sameDayRevenue);
    document.getElementById('vf-calc-total').textContent = fmtYen(total);

    var customerName = document.getElementById('vf-customer').value;
    var c = findCustomerByName(customerName);
    if (c) {
      var b = getCustomerBalance(c.id);
      document.getElementById('vf-calc-balance').textContent = fmtYen(b.balance) + ' → ' + fmtYen(b.balance - preSaleRevenue);
    } else {
      document.getElementById('vf-calc-balance').textContent = '-';
    }
  }

  function resetVisitForm() {
    document.getElementById('vf-id').value = '';
    document.getElementById('vf-date').value = today();
    document.getElementById('vf-customer').value = '';
    document.getElementById('vf-customer-info').textContent = '';
    document.getElementById('vf-channel').value = 'stripe';
    document.getElementById('vf-plan').value = '尾崎牛/インクルーシブ';
    document.getElementById('vf-guests').value = 2;
    document.getElementById('vf-presale-guests').value = 2;
    document.getElementById('vf-sameday-guests').value = 0;
    document.getElementById('vf-unit-price').value = 17600;
    document.getElementById('vf-food-total').value = 0;
    document.getElementById('vf-child-count').value = 0;
    document.getElementById('vf-child-fee').value = 0;
    document.getElementById('vf-airpay').value = 0;
    document.getElementById('vf-drinks').value = 0;
    document.getElementById('vf-additional').value = 0;
    document.getElementById('visit-modal-title').textContent = '来店記録を追加';
    calcVisitPreview();
  }

  function saveVisit() {
    var customerName = document.getElementById('vf-customer').value;
    var c = findCustomerByName(customerName);
    var editId = document.getElementById('vf-id').value;

    var preSaleGuests = Number(document.getElementById('vf-presale-guests').value) || 0;
    var unitPrice = Number(document.getElementById('vf-unit-price').value) || 0;
    var foodTotal = Number(document.getElementById('vf-food-total').value) || 0;
    var sameDayGuests = Number(document.getElementById('vf-sameday-guests').value) || 0;
    var airpay = Number(document.getElementById('vf-airpay').value) || 0;
    var drinks = Number(document.getElementById('vf-drinks').value) || 0;
    var additional = Number(document.getElementById('vf-additional').value) || 0;

    var preSaleRevenue = preSaleGuests * unitPrice;
    if (foodTotal > 0 && foodTotal < preSaleRevenue) preSaleRevenue = foodTotal;
    var sameDayRevenue = airpay + drinks + additional;
    if (sameDayGuests > 0 && sameDayRevenue === 0) sameDayRevenue = sameDayGuests * unitPrice;

    var visit = {
      id: editId || ('v-' + uid()),
      date: document.getElementById('vf-date').value,
      customerId: c ? c.id : '',
      customerName: customerName,
      rank: c ? c.rank : '',
      channel: document.getElementById('vf-channel').value,
      isPreSale: preSaleGuests > 0,
      guestCount: Number(document.getElementById('vf-guests').value) || 0,
      preSaleGuests: preSaleGuests,
      sameDayGuests: sameDayGuests,
      plan: document.getElementById('vf-plan').value,
      preSaleUnitPrice: unitPrice,
      foodTotal: foodTotal,
      childCount: Number(document.getElementById('vf-child-count').value) || 0,
      childFee: Number(document.getElementById('vf-child-fee').value) || 0,
      airpayAmount: airpay,
      sameDayDrinks: drinks,
      additionalCharges: additional,
      preSaleRevenue: preSaleRevenue,
      sameDayRevenue: sameDayRevenue,
    };

    if (editId) {
      var idx = state.visits.findIndex(function (v) { return v.id === editId; });
      if (idx >= 0) state.visits[idx] = visit;
    } else {
      state.visits.push(visit);
    }

    saveLocal();
    postToGas('addVisit', visit);
    closeModal('visit-modal');
    showToast('来店記録を保存しました');
    renderPage(state.currentPage);
  }

  // ─── Customer Form ───
  function initCustomerForm() {
    document.getElementById('customer-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveCustomer();
    });

    document.getElementById('btn-add-customer').addEventListener('click', function () {
      resetCustomerForm();
      openModal('customer-modal');
    });
  }

  function resetCustomerForm() {
    document.getElementById('cf-id').value = '';
    document.getElementById('cf-name').value = '';
    document.getElementById('cf-kana').value = '';
    document.getElementById('cf-rank').value = 'プラチナ2';
    document.getElementById('cf-channel').value = 'stripe';
    document.getElementById('cf-phone').value = '';
    document.getElementById('cf-memo').value = '';
    document.getElementById('customer-modal-title').textContent = '顧客を追加';
  }

  function saveCustomer() {
    var editId = document.getElementById('cf-id').value;
    var customer = {
      id: editId || ('C-' + uid()),
      name: document.getElementById('cf-name').value,
      nameKana: document.getElementById('cf-kana').value,
      rank: document.getElementById('cf-rank').value,
      channel: document.getElementById('cf-channel').value,
      phone: document.getElementById('cf-phone').value,
      memo: document.getElementById('cf-memo').value,
    };

    if (editId) {
      var idx = state.customers.findIndex(function (c) { return c.id === editId; });
      if (idx >= 0) state.customers[idx] = customer;
    } else {
      state.customers.push(customer);
    }

    saveLocal();
    postToGas('addCustomer', customer);
    updateCustomerDatalist();
    closeModal('customer-modal');
    showToast('顧客情報を保存しました');
    renderPage(state.currentPage);
  }

  // ─── Deposit Form ───
  function initDepositForm() {
    document.getElementById('deposit-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveDeposit();
    });

    document.getElementById('btn-add-deposit').addEventListener('click', function () {
      document.getElementById('df-date').value = today();
      document.getElementById('df-customer').value = '';
      document.getElementById('df-channel').value = 'stripe';
      document.getElementById('df-amount').value = '';
      document.getElementById('df-memo').value = '';
      document.getElementById('df-expires').value = '';
      openModal('deposit-modal');
    });

    // Auto-set expiry when channel changes to makuake
    var dfChannel = document.getElementById('df-channel');
    var dfDate = document.getElementById('df-date');
    function autoSetExpiry() {
      var ch = dfChannel.value;
      var expiresInput = document.getElementById('df-expires');
      if (ch.startsWith('makuake') && dfDate.value) {
        expiresInput.value = addMonths(dfDate.value, 6);
      } else if (ch === 'stripe' || ch === '身内') {
        expiresInput.value = '';
      }
    }
    dfChannel.addEventListener('change', autoSetExpiry);
    dfDate.addEventListener('change', autoSetExpiry);
  }

  function saveDeposit() {
    var customerName = document.getElementById('df-customer').value;
    var c = findCustomerByName(customerName);
    var channel = document.getElementById('df-channel').value;
    var dateVal = document.getElementById('df-date').value;

    // Auto-set expiry: Makuake = 6 months, Stripe/身内 = no expiry
    var expiresAt = '';
    if (channel.startsWith('makuake')) {
      expiresAt = addMonths(dateVal, 6);
    }
    var manualExpiry = document.getElementById('df-expires').value;
    if (manualExpiry) expiresAt = manualExpiry;

    var deposit = {
      id: 'd-' + uid(),
      date: dateVal,
      customerId: c ? c.id : '',
      customerName: customerName,
      channel: channel,
      amount: Number(document.getElementById('df-amount').value) || 0,
      memo: document.getElementById('df-memo').value,
      expiresAt: expiresAt,
    };

    state.deposits.push(deposit);
    saveLocal();
    postToGas('addDeposit', deposit);
    closeModal('deposit-modal');
    showToast('入金を登録しました');
    renderPage(state.currentPage);
  }

  // ─── Customer Detail ───
  function showCustomerDetail(customerId) {
    var c = state.customers.find(function (x) { return x.id === customerId; });
    if (!c) return;

    var b = getCustomerBalance(customerId);
    var customerVisits = state.visits.filter(function (v) { return v.customerId === customerId; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var customerDeposits = state.deposits.filter(function (d) { return d.customerId === customerId; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });

    document.getElementById('cd-title').textContent = c.name;
    document.getElementById('cd-rank').textContent = c.rank || '-';
    document.getElementById('cd-channel').textContent = c.channel || '-';
    document.getElementById('cd-total-deposit').textContent = fmtYen(b.totalDeposit);
    document.getElementById('cd-total-used').textContent = fmtYen(b.totalUsed);
    document.getElementById('cd-expired').textContent = fmtYen(b.expiredAmount);
    document.getElementById('cd-expired').style.color = b.expiredAmount > 0 ? 'var(--red)' : '';
    document.getElementById('cd-balance').textContent = fmtYen(b.balance);

    // 有効期限表示（最も近い期限 or 期限切れ or 無期限）
    var expiryEl = document.getElementById('cd-expiry-info');
    var activeDepositsWithExpiry = customerDeposits.filter(function (d) {
      return d.expiresAt && !isExpired(d);
    });
    var expiredDeposits = customerDeposits.filter(function (d) {
      return d.expiresAt && isExpired(d);
    });
    if (activeDepositsWithExpiry.length > 0) {
      // 最も近い有効期限を表示
      activeDepositsWithExpiry.sort(function (a, b2) { return a.expiresAt.localeCompare(b2.expiresAt); });
      var nearest = activeDepositsWithExpiry[0];
      var days = daysUntilExpiry(nearest);
      if (days <= 30) {
        expiryEl.innerHTML = '<span style="color:var(--amber);font-weight:600">' + nearest.expiresAt + '（残' + days + '日）</span>';
      } else {
        expiryEl.textContent = nearest.expiresAt + '（残' + days + '日）';
        expiryEl.style.color = '';
      }
    } else if (expiredDeposits.length > 0 && customerDeposits.length === expiredDeposits.length) {
      expiryEl.innerHTML = '<span style="color:var(--red)">全て期限切れ</span>';
    } else if (customerDeposits.length > 0) {
      expiryEl.textContent = '無期限';
      expiryEl.style.color = '';
    } else {
      expiryEl.textContent = '-';
      expiryEl.style.color = '';
    }

    document.getElementById('cd-visit-count').textContent = customerVisits.length + '回';

    // チケット残数の内訳
    var tb = getTicketBreakdown(customerId);
    var ticketHtml = '';
    if (tb.items.length > 0) {
      ticketHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px">';
      tb.items.forEach(function (item) {
        var barPct = item.tickets > 0 ? Math.round((item.remainingTickets / item.tickets) * 100) : 0;
        var barColor = item.remainingTickets > 0 ? 'var(--accent)' : 'var(--red)';
        var expiredNote = '';
        if (item.expired > 0) expiredNote = '<div style="font-size:11px;color:var(--red)">期限切れ: ' + fmtYen(item.expired) + '</div>';
        ticketHtml += '<div style="flex:1;min-width:160px;background:var(--bg-secondary);border-radius:8px;padding:10px">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:4px">' + item.channel + '</div>' +
          '<div style="font-size:22px;font-weight:700;color:' + (item.remainingTickets > 0 ? 'var(--accent)' : 'var(--red)') + '">' +
            item.remainingTickets + '<span style="font-size:13px;font-weight:400;color:var(--text-tertiary)"> / ' + item.tickets + ' ' + item.unit + '</span></div>' +
          '<div style="background:#e5e7eb;border-radius:4px;height:6px;margin-top:4px">' +
            '<div style="background:' + barColor + ';border-radius:4px;height:6px;width:' + barPct + '%"></div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">消費: ' + item.usedTickets + ' 人前</div>' +
          (item.expiredTickets > 0 ? '<div style="font-size:11px;color:var(--red)">期限切れ: ' + item.expiredTickets + ' 人前</div>' : '') +
        '</div>';
      });
      ticketHtml += '</div>';
    } else {
      ticketHtml = '<p style="color:var(--text-tertiary);font-size:13px">入金記録なし</p>';
    }
    document.getElementById('cd-ticket-breakdown').innerHTML = ticketHtml;

    document.querySelector('#cd-deposits-table tbody').innerHTML = customerDeposits.map(function (d) {
      var expiryInfo = '';
      if (d.expiresAt) {
        if (isExpired(d)) {
          expiryInfo = '<span class="tag" style="background:var(--red-light);color:var(--red)">期限切れ ' + d.expiresAt + '</span>';
        } else {
          var days = daysUntilExpiry(d);
          expiryInfo = days <= 30
            ? '<span class="tag" style="background:var(--amber-light);color:var(--amber)">残' + days + '日 (' + d.expiresAt + ')</span>'
            : '<span style="color:var(--text-tertiary)">' + d.expiresAt + '</span>';
        }
      } else {
        expiryInfo = '<span style="color:var(--text-tertiary)">無期限</span>';
      }
      return '<tr><td>' + d.date + '</td><td>' + (d.channel || '') + '</td><td class="num">' + fmtYen(d.amount) + '</td><td>' + expiryInfo + '</td><td>' + (d.memo || '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" style="color:var(--text-tertiary)">入金記録なし</td></tr>';

    document.querySelector('#cd-visits-table tbody').innerHTML = customerVisits.map(function (v) {
      var rev = calcVisitRevenue(v);
      return '<tr><td>' + v.date + '</td><td class="num">' + (v.guestCount || 0) + '名</td><td>' + (v.plan || '') + '</td><td class="num">' + fmtYen(rev.preSale) + '</td><td class="num">' + fmtYen(rev.sameDay) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" style="color:var(--text-tertiary)">来店記録なし</td></tr>';

    openModal('customer-detail-modal');
  }

  // ─── Edit / Delete ───
  function editVisit(id) {
    var v = state.visits.find(function (x) { return x.id === id; });
    if (!v) return;

    document.getElementById('vf-id').value = v.id;
    document.getElementById('vf-date').value = v.date;
    document.getElementById('vf-customer').value = v.customerName || '';
    document.getElementById('vf-channel').value = v.channel || 'stripe';
    document.getElementById('vf-plan').value = v.plan || '尾崎牛/インクルーシブ';
    document.getElementById('vf-guests').value = v.guestCount || 2;
    document.getElementById('vf-presale-guests').value = v.preSaleGuests || 0;
    document.getElementById('vf-sameday-guests').value = v.sameDayGuests || 0;
    document.getElementById('vf-unit-price').value = v.preSaleUnitPrice || 0;
    document.getElementById('vf-food-total').value = v.foodTotal || 0;
    document.getElementById('vf-child-count').value = v.childCount || 0;
    document.getElementById('vf-child-fee').value = v.childFee || 0;
    document.getElementById('vf-airpay').value = v.airpayAmount || 0;
    document.getElementById('vf-drinks').value = v.sameDayDrinks || 0;
    document.getElementById('vf-additional').value = v.additionalCharges || 0;
    document.getElementById('visit-modal-title').textContent = '来店記録を編集';

    var c = findCustomerByName(v.customerName);
    if (c) {
      var b = getCustomerBalance(c.id);
      document.getElementById('vf-customer-info').textContent = c.rank + ' | 残高: ' + fmtYen(b.balance);
    }

    calcVisitPreview();
    openModal('visit-modal');
  }

  async function deleteVisit(id) {
    if (!confirm('この来店記録を削除しますか？')) return;
    state.visits = state.visits.filter(function (v) { return v.id !== id; });
    // todayGuestsからも削除
    state.todayGuests = (state.todayGuests || []).filter(function (g) { return g.id !== id; });
    state.tomorrowGuests = (state.tomorrowGuests || []).filter(function (g) { return g.id !== id; });
    saveLocal();
    showToast('来店記録を削除しました');
    renderPage(state.currentPage);
    // GASからも削除
    if (state.gasUrl) {
      try {
        await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'deleteVisit', data: { id: id } }),
        });
      } catch (e) {
        console.warn('GAS削除失敗:', e);
      }
    }
  }

  function editCustomer(id) {
    var c = state.customers.find(function (x) { return x.id === id; });
    if (!c) return;

    document.getElementById('cf-id').value = c.id;
    document.getElementById('cf-name').value = c.name || '';
    document.getElementById('cf-kana').value = c.nameKana || '';
    document.getElementById('cf-rank').value = c.rank || 'プラチナ2';
    document.getElementById('cf-channel').value = c.channel || 'stripe';
    document.getElementById('cf-phone').value = c.phone || '';
    document.getElementById('cf-memo').value = c.memo || '';
    document.getElementById('customer-modal-title').textContent = '顧客を編集';

    openModal('customer-modal');
  }

  // ─── Settings Actions ───
  function initSettings() {
    document.getElementById('btn-save-gas').addEventListener('click', async function () {
      var url = document.getElementById('settings-gas-url').value.trim();
      setGasUrl(url);
      if (url) {
        showToast('接続中...');
        await loadData();
        renderDashboard();
        renderPage(state.currentPage);
        showToast('スプレッドシートに接続しました');
      }
    });

    document.getElementById('btn-clear-gas').addEventListener('click', function () {
      setGasUrl('');
      document.getElementById('settings-gas-url').value = '';
      updateConnectionStatus(false);
      showToast('接続を解除しました');
    });

    document.getElementById('btn-import-stripe').addEventListener('click', importStripeDeposits);
    document.getElementById('btn-fix-makuake-presale').addEventListener('click', fixMakuakePreSale);

    document.getElementById('btn-add-budget').addEventListener('click', function () {
      state.budgets.push({ month: today().slice(0, 7), budgetRevenue: 0 });
      saveLocal();
      renderBudgetList();
    });

    document.getElementById('btn-export').addEventListener('click', function () {
      var data = JSON.stringify({ customers: state.customers, visits: state.visits, deposits: state.deposits, budgets: state.budgets }, null, 2);
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'inai-data-' + today() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('データをエクスポートしました');
    });

    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (data.customers) state.customers = data.customers;
          if (data.visits) state.visits = data.visits;
          if (data.deposits) state.deposits = data.deposits;
          if (data.budgets) state.budgets = data.budgets;
          saveLocal();
          updateCustomerDatalist();
          renderDashboard();
          renderPage(state.currentPage);
          showToast('データをインポートしました');
        } catch (err) {
          showToast('JSONの読み込みに失敗しました', true);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ─── Budget Actions (exposed) ───
  function updateBudget(index, field, value) {
    if (state.budgets[index]) {
      state.budgets[index][field] = value;
      saveLocal();
    }
  }

  function deleteBudget(index) {
    state.budgets.splice(index, 1);
    saveLocal();
    renderBudgetList();
  }

  // ─── Chart.js Defaults ───
  function setChartDefaults() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1a1a2e';
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.padding = 10;
  }

  // ─── Init ───
  async function init() {
    setChartDefaults();
    initModals();
    initVisitForm();
    initCustomerForm();
    initDepositForm();
    initMakuakeImport();
    initGuestsCsvImport();
    initCalendarPage();
    initOrders();
    initSettings();
    scheduleGuestTransition();

    // Navigation
    document.querySelectorAll('[data-page]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    });

    // まずローカルデータで画面を即表示
    var local = loadLocal();
    if (local && local.customers) {
      state.customers = local.customers;
      state.visits = local.visits || [];
      state.deposits = local.deposits || [];
      state.budgets = local.budgets || [];
    }
    updateCustomerDatalist();
    renderDashboard();
    navigateTo('guests');

    // GAS接続は遅延して実行（ページ描画後にバックグラウンドで取得）
    state.gasUrl = getGasUrl();
    if (state.gasUrl) {
      setTimeout(async function () {
        try {
          console.log('GAS: 顧客データ取得中...');
          var custRes = await fetchGas('customers');
          state.customers = custRes.customers || [];
          console.log('GAS: 顧客 ' + state.customers.length + '件取得');

          // 来店データを一括取得
          console.log('GAS: 来店データ取得中...');
          var visitRes = await fetchGas('visits');
          state.visits = visitRes.visits || [];
          console.log('GAS: 来店 ' + state.visits.length + '件取得完了');

          // 入金データ取得
          console.log('GAS: 入金データ取得中...');
          var depRes = await fetchGas('deposits');
          state.deposits = depRes.deposits || [];
          console.log('GAS: 入金 ' + state.deposits.length + '件取得');

          updateConnectionStatus(true);
          saveLocal();
          updateCustomerDatalist();
          renderDashboard();
          renderPage(state.currentPage);
          showToast('読み込み完了（' + state.customers.length + '名/' + state.visits.length + '件）');
        } catch (e) {
          console.warn('GAS接続失敗:', e);
          updateConnectionStatus(false);
        }
      }, 1000);
    } else {
      // GAS未設定の場合はサンプルデータをロード
      if (!local || !local.customers || local.customers.length === 0) {
        await loadData();
        updateCustomerDatalist();
        renderDashboard();
        renderPage(state.currentPage);
      }
      updateConnectionStatus(false);
    }
  }

  // ─── Stripe入金一括インポート ───
  var STRIPE_CSV_DATA = [
    {id:"STR_D0001",date:"2025-03-26",amount:37400,memo:"nishii.msy@gmail.com|"},
    {id:"STR_D0002",date:"2025-03-15",amount:27400,memo:"翼 岡坊|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0003",date:"2025-03-14",amount:37400,memo:"takahiro.segawa@iizii.co.jp|"},
    {id:"STR_D0004",date:"2025-03-02",amount:27400,memo:"太一 長嶺|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0005",date:"2025-03-01",amount:27400,memo:"大毅 北山|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0006",date:"2025-02-28",amount:14300,memo:"昂平 夜久|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0007",date:"2025-02-27",amount:14300,memo:"裕太郎 森田|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0008",date:"2025-02-27",amount:14300,memo:"圭祐 井藤|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0009",date:"2025-02-26",amount:27400,memo:"祐介 丸目|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0010",date:"2025-02-26",amount:27400,memo:"正明 森|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0011",date:"2025-02-26",amount:27400,memo:"真子 西内|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0012",date:"2025-02-26",amount:27400,memo:"良樹 馬場|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0013",date:"2025-02-24",amount:66000,memo:"ishiken.t.e.0314.leverages@gmail.com|"},
    {id:"STR_D0014",date:"2025-02-21",amount:14300,memo:"夕衣 松本|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0015",date:"2025-02-21",amount:14300,memo:"絵里華 池澤|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0016",date:"2025-02-20",amount:27400,memo:"太生 西浦|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0017",date:"2025-02-14",amount:27400,memo:"宣光 古林|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0018",date:"2025-02-10",amount:27400,memo:"晴菜 陣川|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0019",date:"2025-02-09",amount:27400,memo:"尭大 三村|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0020",date:"2025-02-07",amount:27400,memo:"功樹 重久|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0021",date:"2025-02-06",amount:27400,memo:"遥佳 永井|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0022",date:"2025-02-05",amount:27400,memo:"航平 能登|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0023",date:"2025-02-04",amount:27400,memo:"諒 西川|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0024",date:"2025-02-03",amount:66000,memo:"優真 齋藤|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0025",date:"2025-02-03",amount:27400,memo:"翔 濱上|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0026",date:"2025-02-03",amount:27400,memo:"智哉 品川|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0027",date:"2025-02-02",amount:27400,memo:"洸希 関谷|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0028",date:"2025-02-01",amount:66000,memo:"健太郎 花田|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0029",date:"2025-02-01",amount:27400,memo:"耀大 松井|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0030",date:"2025-01-31",amount:27400,memo:"有美 加藤|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0031",date:"2025-01-31",amount:27400,memo:"有希子 津留|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0032",date:"2025-01-31",amount:66000,memo:"康平 大村|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0033",date:"2025-01-31",amount:66000,memo:"講典 岩田|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0034",date:"2025-01-28",amount:27400,memo:"純平 髙橋|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0035",date:"2025-01-28",amount:66000,memo:"聡太 岩田|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0036",date:"2025-01-27",amount:27400,memo:"仁美 荻原|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0037",date:"2025-01-24",amount:35200,memo:"toyo4183tamu3150@gmail.com|"},
    {id:"STR_D0038",date:"2025-01-23",amount:27400,memo:"大将 坂元|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0039",date:"2025-01-23",amount:27400,memo:"佑太 三浦|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0040",date:"2025-01-23",amount:27400,memo:"航貴 衣笠|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0041",date:"2025-01-22",amount:66000,memo:"拓哉 奥田|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0042",date:"2025-01-22",amount:35200,memo:"kotaro.terada@ardens.jp|"},
    {id:"STR_D0043",date:"2025-01-20",amount:27400,memo:"淳南 今井|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0044",date:"2025-01-19",amount:27400,memo:"雄策 木下|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0045",date:"2025-01-18",amount:27400,memo:"啓介 須田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0046",date:"2025-01-17",amount:27400,memo:"真鈴 内田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0047",date:"2025-01-15",amount:35200,memo:"konchaso@gmail.com|"},
    {id:"STR_D0048",date:"2025-01-12",amount:27400,memo:"優士朗 中尾|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0049",date:"2025-01-11",amount:66000,memo:"啓輔 松田|【早割】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0050",date:"2025-01-11",amount:27400,memo:"耕平 北口|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0051",date:"2025-01-10",amount:27400,memo:"宏祐 西垣|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0052",date:"2025-01-10",amount:27400,memo:"杏奈 大西|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0053",date:"2025-01-10",amount:27400,memo:"祐希 傳藤|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0054",date:"2025-01-06",amount:35200,memo:"jackman31x.le@gmail.com|"},
    {id:"STR_D0055",date:"2025-01-06",amount:35200,memo:"nono-nono1089@i.softbank.jp|"},
    {id:"STR_D0056",date:"2024-12-31",amount:26400,memo:"加菜 奥山|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0057",date:"2024-12-31",amount:26400,memo:"飛翔 朝倉|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0058",date:"2024-12-30",amount:35200,memo:"a1622542@gmail.com|"},
    {id:"STR_D0059",date:"2024-12-29",amount:26400,memo:"琴萌 本田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0060",date:"2024-12-29",amount:26400,memo:"彩依 室谷|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0061",date:"2024-12-28",amount:35200,memo:"tomohiko.ashida@genbae.jp|"},
    {id:"STR_D0062",date:"2024-12-28",amount:26400,memo:"俊也 田中|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0063",date:"2024-12-27",amount:26400,memo:"俊介 伊藤|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0064",date:"2024-12-27",amount:26400,memo:"健吾 勝見|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0065",date:"2024-12-26",amount:26400,memo:"成美 西岡|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0066",date:"2024-12-26",amount:26400,memo:"恒季 岸本|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0067",date:"2024-12-26",amount:35200,memo:"s.ninomiya1018@gmail.com|"},
    {id:"STR_D0068",date:"2024-12-23",amount:26400,memo:"和樹 横田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0069",date:"2024-12-23",amount:26400,memo:"健太郎 島村|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0070",date:"2024-12-20",amount:26400,memo:"弘貴 潟中|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0071",date:"2024-12-19",amount:26400,memo:"孝弘 江田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0072",date:"2024-12-19",amount:26400,memo:"れい 土屋|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0073",date:"2024-12-18",amount:26400,memo:"敬輔 杉本|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0074",date:"2024-12-18",amount:26400,memo:"真之 北野|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0075",date:"2024-12-15",amount:26400,memo:"リョウマ イワイ|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0076",date:"2024-12-14",amount:35200,memo:"110ryryryry@gmail.com|"},
    {id:"STR_D0077",date:"2024-12-11",amount:26400,memo:"英司 林|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0078",date:"2024-12-10",amount:35200,memo:"yusho0225@gmail.com|"},
    {id:"STR_D0079",date:"2024-12-10",amount:26400,memo:"洋子 岡田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0080",date:"2024-12-09",amount:26400,memo:"悠真 雑賀|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0081",date:"2024-12-09",amount:105600,memo:"randy_0311@outlook.com|"},
    {id:"STR_D0082",date:"2024-12-09",amount:26400,memo:"涼 竹内|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0083",date:"2024-12-09",amount:48400,memo:"健 潮崎|【早割】ゴールド会員権1名分+コース4名分"},
    {id:"STR_D0084",date:"2024-12-08",amount:26400,memo:"崇平 林|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0085",date:"2024-12-07",amount:35200,memo:"miwamami1025@gmail.com|"},
    {id:"STR_D0086",date:"2024-12-07",amount:26400,memo:"研人 金田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0087",date:"2024-12-07",amount:26400,memo:"ゆき おくの|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0088",date:"2024-12-07",amount:26400,memo:"明日香 村上|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0089",date:"2024-12-06",amount:35200,memo:"takuma.kobayashi@defworks.jp|"},
    {id:"STR_D0090",date:"2024-12-06",amount:26400,memo:"崇志 豊田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0091",date:"2024-12-05",amount:26400,memo:"紗永 大沢|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0092",date:"2024-12-05",amount:105600,memo:"大樹 森永|【早割】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0093",date:"2024-12-04",amount:26400,memo:"昂平 中尾|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0094",date:"2024-12-04",amount:35200,memo:"jyun9542@gmail.com|"},
    {id:"STR_D0095",date:"2024-12-04",amount:26400,memo:"達也 川嶋|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0096",date:"2024-12-04",amount:26400,memo:"海泓 閔|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0097",date:"2024-12-03",amount:35200,memo:"daisuke.sns0822@gmail.com|"},
    {id:"STR_D0098",date:"2024-12-03",amount:105600,memo:"祐麻 古谷|【早割】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0099",date:"2024-12-03",amount:105600,memo:"亮介 大伯|【早割】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0100",date:"2024-12-02",amount:35200,memo:"nieve312@gmail.com|"},
    {id:"STR_D0101",date:"2024-12-02",amount:35200,memo:"dudufofinho1997@gmail.com|"},
    {id:"STR_D0102",date:"2024-12-02",amount:26400,memo:"泰志 橋本|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0103",date:"2024-12-02",amount:26400,memo:"拳人 林|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0104",date:"2024-12-02",amount:26400,memo:"奨 前田|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0105",date:"2024-12-01",amount:26400,memo:"翔太 團|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0106",date:"2024-12-01",amount:26400,memo:"博志 後藤|【早割】ゴールド会員権1名分+コース2名分"},
    {id:"STR_D0107",date:"2024-12-01",amount:66000,memo:"利光 曽和|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0108",date:"2024-11-30",amount:105600,memo:"靖揮 増田|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0109",date:"2024-11-30",amount:35200,memo:"竜登 木下|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0110",date:"2024-11-30",amount:132000,memo:"幸治郎 溝口|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0111",date:"2024-11-29",amount:105600,memo:"航大 西田|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0112",date:"2024-11-29",amount:35200,memo:"隆寛 石川|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0113",date:"2024-11-29",amount:105600,memo:"史朗 松村|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0114",date:"2024-11-29",amount:33000,memo:"冠盛 高橋|【早割】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0115",date:"2024-11-28",amount:35200,memo:"亮 松村|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0116",date:"2024-11-27",amount:35200,memo:"亜美 中島|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0117",date:"2024-11-27",amount:66000,memo:"和希 渡部|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0118",date:"2024-11-27",amount:35200,memo:"暁大 田中|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0119",date:"2024-11-27",amount:35200,memo:"駿介 伊藤|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0120",date:"2024-11-26",amount:35200,memo:"雅史 濵野|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0121",date:"2024-11-25",amount:35200,memo:"喬則 木戸脇|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0122",date:"2024-11-25",amount:35200,memo:"圭佑 西本|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0123",date:"2024-11-25",amount:35200,memo:"拓大 桒原|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0124",date:"2024-11-25",amount:66000,memo:"正孝 荒井|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0125",date:"2024-11-25",amount:105600,memo:"亜美 平林|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0126",date:"2024-11-25",amount:35200,memo:"雄介 石井|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0127",date:"2024-11-25",amount:35200,memo:"昇平 新田|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0128",date:"2024-11-25",amount:35200,memo:"健吾 吉田|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0129",date:"2024-11-25",amount:35200,memo:"知広 杉崎|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0130",date:"2024-11-25",amount:105600,memo:"知真 杉本|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0131",date:"2024-11-25",amount:35200,memo:"晃平 衣川|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0132",date:"2024-11-25",amount:35200,memo:"嵩侑 渡辺|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0133",date:"2024-11-24",amount:35200,memo:"周作 南|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0134",date:"2024-11-24",amount:35200,memo:"真維 奥村|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0135",date:"2024-11-23",amount:35200,memo:"菜々子 開|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0136",date:"2024-11-22",amount:132000,memo:"秀 小田原|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0137",date:"2024-11-22",amount:132000,memo:"悠人 高橋|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0138",date:"2024-11-21",amount:105600,memo:"直也 三木|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0139",date:"2024-11-21",amount:132000,memo:"太志 本田|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0140",date:"2024-11-21",amount:132000,memo:"優樹 坂田|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0141",date:"2024-11-20",amount:105600,memo:"敬 森口|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0142",date:"2024-11-20",amount:35200,memo:"哲規 間山|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0143",date:"2024-11-20",amount:35200,memo:"耀介 粂|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0144",date:"2024-11-20",amount:105600,memo:"啓太 福与|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0145",date:"2024-11-20",amount:35200,memo:"一成 村田|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0146",date:"2024-11-19",amount:35200,memo:"太一 中嶋|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0147",date:"2024-11-18",amount:132000,memo:"銀次 原田|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0148",date:"2024-11-18",amount:105600,memo:"大貴 細川|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0149",date:"2024-11-18",amount:66000,memo:"一輝 吉岡|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0150",date:"2024-11-18",amount:35200,memo:"萌子 王|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0151",date:"2024-11-17",amount:132000,memo:"晃 中川|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0152",date:"2024-11-16",amount:66000,memo:"健祐 福間|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0153",date:"2024-11-16",amount:35200,memo:"領紋 國島|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0154",date:"2024-11-13",amount:35200,memo:"壮 奥村|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0155",date:"2024-11-13",amount:132000,memo:"杰 李|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0156",date:"2024-11-12",amount:132000,memo:"昭人 橋元|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0157",date:"2024-11-12",amount:35200,memo:"駿 副島|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0158",date:"2024-11-11",amount:35200,memo:"和真 山根|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0159",date:"2024-11-11",amount:35200,memo:"実来 藤田|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0160",date:"2024-11-11",amount:35200,memo:"圭一 佐藤|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0161",date:"2024-11-11",amount:35200,memo:"長谷川 大騎|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0162",date:"2024-11-11",amount:132000,memo:"邦明 尾崎|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0163",date:"2024-11-10",amount:132000,memo:"匡寛 泉澤|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0164",date:"2024-11-10",amount:132000,memo:"斗南 坂上|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0165",date:"2024-11-10",amount:66000,memo:"美咲 前野|【特別先行枠】プラチナ会員権1名分+コース4名分"},
    {id:"STR_D0166",date:"2024-11-07",amount:132000,memo:"和英 木山|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0167",date:"2024-11-06",amount:35200,memo:"将嵩 山本|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0168",date:"2024-11-06",amount:105600,memo:"宏基 受田|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0169",date:"2024-11-06",amount:35200,memo:"達也 木場|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0170",date:"2024-11-05",amount:132000,memo:"史晃 八松|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0171",date:"2024-11-05",amount:132000,memo:"航輝 廣田|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0172",date:"2024-11-05",amount:35200,memo:"奈央子 南|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0173",date:"2024-11-05",amount:35200,memo:"一甫 橋村|【特別先行枠】プラチナ会員権1名分+コース2名分"},
    {id:"STR_D0174",date:"2024-11-05",amount:105600,memo:"貴太 荻野|【特別先行枠】ブラック会員権1名分+コース6名分"},
    {id:"STR_D0175",date:"2024-11-04",amount:132000,memo:"太亮 中村|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0176",date:"2024-11-04",amount:132000,memo:"智昭 小松|【特別先行枠】ブラック会員権1名分+コース8名分"},
    {id:"STR_D0177",date:"2024-11-03",amount:132000,memo:"直也 藤本|【特別先行枠】ブラック会員権1名分+コース8名分"},
  ];

  // カタカナ→ひらがな変換
  function kataToHira(str) {
    return str.replace(/[\u30A1-\u30F6]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }
  // ひらがな→カタカナ変換
  function hiraToKata(str) {
    return str.replace(/[\u3041-\u3096]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
  }

  function registerNameVariants(map, name, id, noReverse) {
    if (!name) return;
    map[name] = id;
    map[name.replace(/\s+/g, '')] = id;
    // ひらがな版
    var hira = kataToHira(name);
    map[hira] = id;
    map[hira.replace(/\s+/g, '')] = id;
    // カタカナ版
    var kata = hiraToKata(name);
    map[kata] = id;
    map[kata.replace(/\s+/g, '')] = id;
    // 反転版（1回だけ）
    if (!noReverse) {
      var parts = name.split(/\s+/);
      if (parts.length >= 2) {
        var rev = parts.slice(1).join(' ') + ' ' + parts[0];
        registerNameVariants(map, rev, id, true);
      }
    }
  }

  function buildNameMap() {
    var nameToId = {};
    var phoneToId = {};
    state.customers.forEach(function (c) {
      var name = (c.name || '').trim();
      if (!name || !c.id) return;
      registerNameVariants(nameToId, name, c.id);
      // ヨミガナ
      var kana = (c.nameKana || '').trim();
      if (kana) {
        registerNameVariants(nameToId, kana, c.id);
      }
      // 電話番号
      var phone = (c.phone || '').trim().replace(/[-\s]/g, '');
      if (phone) phoneToId[phone] = c.id;
    });
    nameToId._phoneMap = phoneToId;
    return nameToId;
  }

  function matchCustomerId(namePart, nameToId, phone) {
    if (!namePart || namePart.indexOf('@') >= 0) {
      // 名前なしでも電話番号でマッチ試行
      if (phone && nameToId._phoneMap) {
        var pn = phone.replace(/[-\s]/g, '');
        if (nameToId._phoneMap[pn]) return nameToId._phoneMap[pn];
      }
      return '';
    }
    // そのまま＋ひらがな・カタカナ変換
    var variants = [namePart, kataToHira(namePart), hiraToKata(namePart)];
    for (var v = 0; v < variants.length; v++) {
      var id = nameToId[variants[v]] || nameToId[variants[v].replace(/\s+/g, '')] || '';
      if (id) return id;
    }
    // 反転
    var parts = namePart.split(/\s+/);
    if (parts.length >= 2) {
      var rev = parts.slice(1).join(' ') + ' ' + parts[0];
      var revVariants = [rev, kataToHira(rev), hiraToKata(rev)];
      for (var rv = 0; rv < revVariants.length; rv++) {
        var id2 = nameToId[revVariants[rv]] || nameToId[revVariants[rv].replace(/\s+/g, '')] || '';
        if (id2) return id2;
      }
    }
    // 部分一致（全パーツを含むキーを探す）
    for (var key in nameToId) {
      if (key === '_phoneMap') continue;
      var allMatch = true;
      for (var p = 0; p < parts.length; p++) {
        if (parts[p].length < 2) continue;
        if (key.indexOf(parts[p]) < 0) { allMatch = false; break; }
      }
      if (allMatch && parts.length > 0) return nameToId[key];
    }
    // 電話番号フォールバック
    if (phone && nameToId._phoneMap) {
      var pn2 = phone.replace(/[-\s]/g, '');
      if (nameToId._phoneMap[pn2]) return nameToId._phoneMap[pn2];
    }
    return '';
  }

  async function importStripeDeposits() {
    var statusEl = document.getElementById('import-status');
    var btn = document.getElementById('btn-import-stripe');
    btn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.textContent = 'マッチング中...';

    if (!state.gasUrl) {
      statusEl.textContent = 'エラー: GAS URLが未設定です。先にデータソース設定を行ってください。';
      btn.disabled = false;
      return;
    }

    // 既存の入金IDを確認（重複防止）
    var existingIds = {};
    state.deposits.forEach(function (d) { existingIds[d.id] = true; });

    var nameToId = buildNameMap();
    var matched = 0, unmatched = 0, skipped = 0;
    var unmatchedList = [];
    var toSend = [];

    STRIPE_CSV_DATA.forEach(function (rec) {
      if (existingIds[rec.id]) { skipped++; return; }
      var namePart = (rec.memo || '').split('|')[0].trim();
      var customerId = matchCustomerId(namePart, nameToId);
      if (customerId) { matched++; } else {
        unmatched++;
        unmatchedList.push(rec.id + ': ' + namePart + ' (¥' + fmt(rec.amount) + ')');
      }
      toSend.push({
        id: rec.id,
        date: rec.date,
        customerId: customerId,
        channel: 'stripe',
        amount: rec.amount,
        expiresAt: '',
        memo: rec.memo
      });
    });

    statusEl.textContent = 'マッチ結果: ' + matched + '件マッチ / ' + unmatched + '件未マッチ / ' + skipped + '件スキップ(既存)\n';
    if (toSend.length === 0) {
      statusEl.textContent += '\n全件登録済みです。';
      btn.disabled = false;
      return;
    }

    statusEl.textContent += toSend.length + '件をスプレッドシートに送信中...\n';

    try {
      var res = await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'bulkAddDeposits', data: toSend }),
      });
      var result = await res.json();
      statusEl.textContent += '完了! ' + (result.added || toSend.length) + '件を入金シートに追加しました。\n';

      if (unmatchedList.length > 0) {
        statusEl.textContent += '\n--- 未マッチ（会員IDなしで登録） ---\n' + unmatchedList.join('\n');
      }

      // ローカルデータを更新
      var depRes = await fetchGas('deposits');
      state.deposits = depRes.deposits || [];
      saveLocal();
      renderPage(state.currentPage);
      showToast('Stripe入金 ' + toSend.length + '件を登録しました');
    } catch (e) {
      statusEl.textContent += '\nエラー: ' + e.message;
      showToast('送信に失敗しました', true);
    }

    btn.disabled = false;
  }

  async function fixMakuakePreSale() {
    var statusEl = document.getElementById('import-status');
    var btn = document.getElementById('btn-fix-makuake-presale');
    btn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.textContent = 'Makuake前売売上を修正中...\n来店シートのコース単価と前売売上を入金データから一括更新します。';

    if (!state.gasUrl) {
      statusEl.textContent = 'エラー: GAS URLが未設定です。';
      btn.disabled = false;
      return;
    }

    try {
      var res = await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'fixMakuakePreSale', data: {} }),
      });
      var result = await res.json();
      var fix = result.fix || {};
      var noPriceList = fix.noPriceDetails || [];
      var noPriceCount = noPriceList.length || fix.noPrice || 0;
      statusEl.textContent = 'Makuake前売売上 修正完了!\n\n';
      statusEl.textContent += '更新: ' + (fix.updated || 0) + '件\n';
      statusEl.textContent += 'スキップ(確定値あり): ' + (fix.skipped || 0) + '件\n';
      statusEl.textContent += '単価不明: ' + noPriceCount + '件\n';
      if (noPriceList.length > 0) {
        statusEl.textContent += '\n--- 単価不明の詳細 ---\n';
        noPriceList.forEach(function(p) {
          statusEl.textContent += p.name + ' (' + p.customerId + ') ' + p.channel
            + ' | 購入枚数:' + p.ticketCount
            + ' | 入金額:¥' + (p.depositAmount || 0).toLocaleString()
            + (p.depositMemo ? ' | メモ:' + p.depositMemo : ' | 入金なし') + '\n';
        });
      }

      // データ再読み込み
      showToast('修正完了。データを再読み込みします...');
      var depRes = await fetchGas('deposits');
      state.deposits = depRes.deposits || [];

      var allVisits = [];
      var now = new Date();
      var start = new Date(2025, 2, 1);
      for (var d = new Date(now.getFullYear(), now.getMonth(), 1); d >= start; d.setMonth(d.getMonth() - 1)) {
        var m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var vRes = await fetchGas('visits&month=' + m);
        allVisits = allVisits.concat(vRes.visits || []);
      }
      state.visits = allVisits;
      saveLocal();
      renderPage(state.currentPage);
      showToast('修正完了! ' + (fix.updated || 0) + '件更新');
    } catch (e) {
      statusEl.textContent += '\nエラー: ' + e.message;
      showToast('修正に失敗しました', true);
    }
    btn.disabled = false;
  }

  // ─── TableCheck CSV取り込み ───
  // CSV行をクォート対応で分割
  function splitCSVRow(row) {
    var cols = [];
    var current = '';
    var inQuote = false;
    for (var i = 0; i < row.length; i++) {
      var ch = row[i];
      if (ch === '"') {
        if (inQuote && i + 1 < row.length && row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        cols.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current);
    return cols;
  }

  function parseTableCheckCSV(text) {
    // CSVパース（改行がメモ内に含まれるケースに対応）
    var lines = [];
    var current = '';
    var inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        inQuote = !inQuote;
        current += ch;
      } else if ((ch === '\n' || ch === '\r') && !inQuote) {
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        if (current.trim()) lines.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) lines.push(current);

    if (lines.length < 2) return [];

    // 1行目が「予約」等のラベルならスキップ
    var headerIdx = 0;
    for (var h = 0; h < Math.min(3, lines.length); h++) {
      if (lines[h].indexOf('予約ID') >= 0) { headerIdx = h; break; }
    }

    // ヘッダー解析
    var header = splitCSVRow(lines[headerIdx]);
    var colMap = {};
    header.forEach(function(h, idx) { colMap[h.trim()] = idx; });

    var records = [];
    for (var i = headerIdx + 1; i < lines.length; i++) {
      var cols = splitCSVRow(lines[i]);
      // 最低限の列数チェック
      if (cols.length < 10) continue;

      var status = (cols[colMap['ステータス']] || '').trim();
      // キャンセル済みはスキップ
      if (status === 'キャンセル' || status === 'No Show') continue;

      var date = (cols[colMap['開始日']] || '').trim();
      if (!date) continue;

      var adults = Number(cols[colMap['人数:大人']] || 0);
      var children = Number(cols[colMap['人数:子供']] || 0);
      var lastNameKana = (cols[colMap['氏 (あ·ア·A)']] || '').trim();
      var firstNameKana = (cols[colMap['名 (あ·ア·A)']] || '').trim();
      var lastNameKanji = (cols[colMap['氏 (漢字)']] || '').trim();
      var firstNameKanji = (cols[colMap['名 (漢字)']] || '').trim();
      var order = (cols[colMap['注文']] || '').trim();
      var memo = (cols[colMap['予約メモ']] || '').trim().replace(/^"|"$/g, '');
      var phone = (cols[colMap['電話']] || '').trim();
      var reservationId = (cols[colMap['予約ID']] || '').trim();
      var time = (cols[colMap['開始時刻']] || '').trim();
      var table = (cols[colMap['テーブル']] || '').trim();

      // 名前を構築
      var nameKanji = (lastNameKanji + ' ' + firstNameKanji).trim();
      var nameKana = (lastNameKana + ' ' + firstNameKana).trim();
      var displayName = nameKanji || nameKana || (cols[colMap['名前']] || '').trim();

      // 注文からプランを判定
      var plan = detectPlan(order);

      records.push({
        reservationId: reservationId,
        date: date,
        time: time,
        table: table,
        name: displayName,
        nameKana: nameKana,
        nameKanji: nameKanji,
        phone: phone,
        adults: adults,
        children: children,
        order: order,
        plan: plan,
        memo: memo,
        status: status,
      });
    }
    return records;
  }

  function detectPlan(order) {
    if (!order) return '通常/単品';
    var o = order;
    if (o.indexOf('中華') >= 0) return '中華コース';
    if (o.indexOf('鍋') >= 0) return '鍋プラン';
    if (o.indexOf('会食') >= 0) return '会食プラン';
    // 尾崎牛コース（「尾崎牛」または「極」を含む）
    var isOzaki = o.indexOf('尾崎') >= 0 || o.indexOf('極') >= 0;
    // 通常コース（「創作和食」「季節」を含む）
    var isRegular = o.indexOf('創作和食') >= 0 || o.indexOf('季節') >= 0;
    // ドリンク付き判定
    var isInclusive = o.indexOf('インクルーシブ') >= 0;
    var isPairing = o.indexOf('ペアリング') >= 0;

    if (isOzaki || isRegular) {
      var prefix = (isOzaki && !isRegular) ? '尾崎牛' : '通常';
      // 「尾崎牛と季節の創作和食」のようにどちらも含む場合は尾崎牛
      if (isOzaki) prefix = '尾崎牛';
      if (isInclusive) return prefix + '/インクルーシブ';
      if (isPairing) return prefix + '/ペアリング';
      return prefix + '/単品';
    }
    if (isInclusive) return '通常/インクルーシブ';
    if (isPairing) return '通常/ペアリング';
    return '通常/単品';
  }

  async function importTableCheckCSV(suffix) {
    suffix = suffix || '';
    var textarea = document.getElementById('tc-csv-input' + suffix);
    var statusEl = document.getElementById('tc-import-status' + suffix);
    var previewEl = document.getElementById('tc-import-preview' + suffix);
    var csv = textarea.value.trim();

    if (!csv) {
      statusEl.textContent = 'CSVデータを貼り付けてください';
      return;
    }

    statusEl.textContent = '解析中...';
    previewEl.style.display = 'none';

    var records = parseTableCheckCSV(csv);
    if (records.length === 0) {
      statusEl.textContent = 'エラー: 有効な予約データが見つかりません';
      return;
    }

    // 顧客マッチング
    var nameToId = buildNameMap();
    var results = [];

    records.forEach(function(rec) {
      // 名前でマッチ（漢字→かな→電話番号の順で試行）
      var custId = '';
      if (rec.nameKanji) custId = matchCustomerId(rec.nameKanji, nameToId, rec.phone);
      if (!custId && rec.nameKana) custId = matchCustomerId(rec.nameKana, nameToId, rec.phone);
      if (!custId && rec.phone) custId = matchCustomerId('', nameToId, rec.phone);

      var cust = custId ? getCustomerById(custId) : null;
      var channel = cust ? (cust.channel || 'stripe') : '';
      var isMember = !!custId;

      // 残高チェック: 前売残高がある場合のみ前売扱い
      var balance = custId ? getCustomerBalance(custId) : { balance: 0 };
      var hasBalance = balance.balance > 0;
      var isPreSalePlan = rec.plan !== '中華コース' && rec.plan !== '鍋プラン';
      var isPreSale = isMember && hasBalance && isPreSalePlan && (channel.startsWith('makuake') || channel === 'stripe' || channel === '紹介' || channel === '身内');

      // 単価を取得
      var unitPrice = 0;
      if (cust && isPreSale) {
        unitPrice = resolveUnitPrice({
          customerId: custId,
          plan: rec.plan,
          date: rec.date,
        });
      }

      // 前売人数の判定
      // デポジット以外: 残高>0なら全員前売（1人前＝チケット単位）
      // デポジット: 金額ベースで残高÷単価で算出
      var preSaleGuests = 0;
      if (isPreSale) {
        var isDeposit = (channel === 'stripe' || channel === '紹介' || channel === '身内') &&
          state.deposits.some(function(d) {
            return d.customerId === custId && (d.memo || '').indexOf('デポジット') >= 0;
          });
        if (isDeposit && unitPrice > 0) {
          var maxPreSale = Math.floor(balance.balance / unitPrice);
          preSaleGuests = Math.min(rec.adults, maxPreSale);
        } else {
          preSaleGuests = rec.adults;
        }
      }
      var sameDayGuests = rec.adults - preSaleGuests;

      results.push({
        reservationId: rec.reservationId,
        date: rec.date,
        time: rec.time,
        table: rec.table,
        customerId: custId,
        customerName: rec.name,
        nameKana: rec.nameKana,
        channel: channel,
        plan: rec.plan,
        order: rec.order,
        guestCount: rec.adults,
        preSaleGuests: preSaleGuests,
        sameDayGuests: sameDayGuests,
        childCount: rec.children,
        unitPrice: unitPrice,
        memo: rec.memo,
        matched: isMember,
        balanceAmount: balance.balance,
      });
    });

    // プレビュー表示
    var html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<tr style="background:#f5f5f5"><th style="padding:4px;text-align:left">日付</th><th>顧客名</th><th>会員</th><th>残高</th><th>人数</th><th>前売</th><th>プラン</th></tr>';
    results.forEach(function(r) {
      var matchIcon = r.matched ? '✅' : '❌';
      var balText = r.matched ? fmtYen(r.balanceAmount) : '-';
      var balColor = r.balanceAmount <= 0 && r.matched ? 'color:var(--red)' : '';
      html += '<tr style="border-bottom:1px solid #eee">';
      html += '<td style="padding:4px">' + r.date + '</td>';
      html += '<td>' + r.customerName + '</td>';
      html += '<td style="text-align:center">' + matchIcon + '</td>';
      html += '<td style="text-align:center;' + balColor + '">' + balText + '</td>';
      html += '<td style="text-align:center">' + r.guestCount + '名</td>';
      html += '<td style="text-align:center">' + r.preSaleGuests + '名</td>';
      html += '<td>' + r.plan + '</td>';
      html += '</tr>';
    });
    html += '</table>';
    html += '<div style="margin-top:8px"><button class="btn btn-primary" id="btn-tc-confirm">この内容で来店登録する（' + results.length + '件）</button></div>';

    previewEl.innerHTML = html;
    previewEl.style.display = 'block';
    statusEl.textContent = results.length + '件の予約を検出（マッチ: ' + results.filter(function(r){return r.matched}).length + '件）';

    // 来客情報として保存（当日ならtodayGuests、それ以外ならtomorrowGuests）
    var guestData = results.map(function(r) {
      // 既存の来店レコードがあればその当日売上値を引き継ぐ
      var existing = state.visits.find(function(v) { return v.id === 'TC_' + r.reservationId; });
      return {
        id: 'TC_' + r.reservationId,
        date: r.date,
        time: r.time,
        table: r.table,
        customerId: r.customerId,
        customerName: r.customerName,
        nameKana: r.nameKana,
        channel: r.channel,
        plan: r.plan,
        order: r.order,
        guestCount: r.guestCount,
        preSaleGuests: r.preSaleGuests,
        unitPrice: r.unitPrice,
        memo: r.memo,
        matched: r.matched,
        balanceAmount: r.balanceAmount,
        childCount: r.childCount,
        airpayAmount: existing ? (existing.airpayAmount || 0) : 0,
        sameDayDrinks: existing ? (existing.sameDayDrinks || 0) : 0,
        additionalCharges: existing ? (existing.additionalCharges || 0) : 0,
        childFee: existing ? (existing.childFee || 0) : 0,
      };
    });
    // CSVの日付が当日なら todayGuests に直接保存
    var csvDate = results.length > 0 ? results[0].date : '';
    if (csvDate === today()) {
      state.todayGuests = guestData;
    } else {
      state.tomorrowGuests = guestData;
    }
    saveLocal();
    syncGuestsToGas();
    if (state.currentPage === 'guests') renderGuestsPage();

    // 登録ボタン
    document.getElementById('btn-tc-confirm').addEventListener('click', async function() {
      this.disabled = true;
      statusEl.textContent = '登録中...';

      var toSend = results.map(function(r) {
        return {
          id: 'TC_' + r.reservationId,
          date: r.date,
          customerId: r.customerId,
          plan: r.plan,
          guestCount: r.guestCount,
          preSaleGuests: r.preSaleGuests,
          sameDayGuests: r.sameDayGuests,
          unitPrice: r.unitPrice,
          airpayAmount: 0,
          sameDayDrinks: 0,
          childCount: r.childCount,
          childFee: 0,
          additionalCharges: 0,
          memo: r.memo,
        };
      });

      // 既存の来店IDチェック（重複防止）
      var existingIds = {};
      state.visits.forEach(function(v) { existingIds[v.id] = true; });
      toSend = toSend.filter(function(v) { return !existingIds[v.id]; });

      if (toSend.length === 0) {
        statusEl.textContent = '全て登録済みです';
        textarea.value = '';
        renderGuestsPage();
        return;
      }

      try {
        for (var i = 0; i < toSend.length; i++) {
          await fetch(state.gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'addVisit', data: toSend[i] }),
          });
        }
        statusEl.textContent = toSend.length + '件の来店を登録しました！';
        textarea.value = '';
        previewEl.style.display = 'none';
        showToast(toSend.length + '件の来店を登録しました');

        // データ再読み込み
        var vRes = await fetchGas('visits&month=' + toSend[0].date.slice(0, 7));
        var month = toSend[0].date.slice(0, 7);
        state.visits = state.visits.filter(function(v) { return v.date.slice(0, 7) !== month; });
        state.visits = state.visits.concat(vRes.visits || []);
        saveLocal();
        renderGuestsPage();
      } catch (e) {
        statusEl.textContent = 'エラー: ' + e.message;
      }
    });
  }

  // ─── 未マッチStripe入金の顧客ID修正 ───
  async function fixUnmatchedStripe() {
    // StripeCSVのメールアドレス→実名マッピング
    var emailToName = {
      'nishii.msy@gmail.com': 'にしい まさや',
      'takahiro.segawa@iizii.co.jp': '畝川 隆宏',
      'ishiken.t.e.0314.leverages@gmail.com': '石原口 賢太',
      'toyo4183tamu3150@gmail.com': '田村 豊和',
      'kotaro.terada@ardens.jp': '寺田 倖太朗',
      'konchaso@gmail.com': 'こんどう ひろたか',
      'jackman31x.le@gmail.com': '西本 誠治',
      'nono-nono1089@i.softbank.jp': 'てんぱく ののか',
      'a1622542@gmail.com': '柳谷 優成',
      'tomohiko.ashida@genbae.jp': 'あしだ ともひこ',
      's.ninomiya1018@gmail.com': '二宮 智',
      '110ryryryry@gmail.com': 'いとう りょうた',
      'yusho0225@gmail.com': 'やまもと ゆうき',
      'randy_0311@outlook.com': '浜田 陽司',
      'miwamami1025@gmail.com': '増田 美和子',
      'takuma.kobayashi@defworks.jp': '小林 大真',
      'jyun9542@gmail.com': '眞 潤一郎',
      'daisuke.sns0822@gmail.com': '青木 大輔',
      'nieve312@gmail.com': '村田 貴雅',
      'dudufofinho1997@gmail.com': 'ながの えどわるど',
    };

    var nameToId = buildNameMap();
    var updates = [];
    var unmatched = [];

    // customerId が空の入金を探す
    state.deposits.forEach(function(d) {
      if (d.customerId || d.channel !== 'stripe') return;
      var memo = d.memo || '';
      var emailPart = memo.split('|')[0].trim();
      if (emailPart.indexOf('@') < 0) return;

      var realName = emailToName[emailPart];
      if (!realName) { unmatched.push(d.id + ': ' + emailPart + ' (名前不明)'); return; }

      // 名前→IDマッチ（姓名反転も試す）
      var custId = matchCustomerId(realName, nameToId);
      if (custId) {
        updates.push({ depositId: d.id, customerId: custId, name: realName });
      } else {
        unmatched.push(d.id + ': ' + realName + ' (' + emailPart + ') → 会員不明');
      }
    });

    console.log('=== 未マッチStripe修正 ===');
    console.log('マッチ成功:', updates.length);
    console.table(updates);
    if (unmatched.length > 0) {
      console.log('マッチ失敗:', unmatched.length);
      unmatched.forEach(function(u) { console.log('  ' + u); });
    }

    if (updates.length > 0 && state.gasUrl) {
      var gasData = updates.map(function(u) { return { depositId: u.depositId, customerId: u.customerId }; });
      try {
        var res = await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'updateDeposits', data: gasData }),
        });
        var result = await res.json();
        console.log('GAS更新結果:', result);

        // ローカルも更新
        updates.forEach(function(u) {
          var dep = state.deposits.find(function(d) { return d.id === u.depositId; });
          if (dep) dep.customerId = u.customerId;
        });
        saveLocal();
        renderPage(state.currentPage);
        showToast(updates.length + '件のStripe入金を顧客に紐づけました');
      } catch (e) {
        console.error('GAS更新エラー:', e);
      }
    }
    return { matched: updates.length, unmatched: unmatched.length };
  }

  // ─── 残高検証（デバッグ用） ───
  function debugBalanceDetail() {
    var now = new Date();
    console.log('===== 残高検証 =====');
    console.log('入金件数:', state.deposits.length);
    console.log('来店件数:', state.visits.length);
    console.log('顧客件数:', state.customers.length);

    // 入金をカテゴリ別に集計（全体）
    var totalDeposits = { stripe: 0, makuake: 0, makuakeExpired: 0, deposit: 0 };
    state.deposits.forEach(function(d) {
      var ch = (d.channel || '').toLowerCase();
      if (ch === '振込') { totalDeposits.deposit += d.amount; }
      else if (ch.startsWith('makuake')) {
        if (isExpired(d)) { totalDeposits.makuakeExpired += d.amount; }
        else { totalDeposits.makuake += d.amount; }
      } else { totalDeposits.stripe += d.amount; }
    });
    console.log('\n--- 入金合計（消費前） ---');
    console.log('Stripe:', totalDeposits.stripe.toLocaleString());
    console.log('Makuake有効:', totalDeposits.makuake.toLocaleString());
    console.log('Makuake期限切れ:', totalDeposits.makuakeExpired.toLocaleString());
    console.log('デポジット:', totalDeposits.deposit.toLocaleString());
    console.log('入金総計:', (totalDeposits.stripe + totalDeposits.makuake + totalDeposits.makuakeExpired + totalDeposits.deposit).toLocaleString());

    // 前売利用合計
    var totalUsed = 0;
    var usedByChannel = { stripe: 0, makuake: 0 };
    state.visits.forEach(function(v) {
      var rev = calcVisitRevenue(v);
      if (rev.preSale > 0) {
        totalUsed += rev.preSale;
        var cust = getCustomerById(v.customerId);
        var ch = cust ? (cust.channel || '') : '';
        if (ch.startsWith('makuake')) { usedByChannel.makuake += rev.preSale; }
        else { usedByChannel.stripe += rev.preSale; }
      }
    });
    console.log('\n--- 前売利用合計 ---');
    console.log('Stripe顧客の利用:', usedByChannel.stripe.toLocaleString());
    console.log('Makuake顧客の利用:', usedByChannel.makuake.toLocaleString());
    console.log('前売利用総計:', totalUsed.toLocaleString());

    // 最終残高
    var bal = getBalanceCategories();
    console.log('\n--- 最終残高（消費後） ---');
    console.log('Stripe前売:', bal.stripePreSale.toLocaleString());
    console.log('デポジット:', bal.deposit.toLocaleString());
    console.log('Makuake有効:', bal.makuakeActive.toLocaleString());
    console.log('期限切れ消滅:', bal.makuakeExpired.toLocaleString());
    console.log('残高合計:', bal.total.toLocaleString());

    // 検算: 入金総計 - 利用総計 - 期限切れ消滅 = 残高合計
    var inputTotal = totalDeposits.stripe + totalDeposits.makuake + totalDeposits.makuakeExpired + totalDeposits.deposit;
    var expected = inputTotal - totalUsed - bal.makuakeExpired;
    console.log('\n--- 検算 ---');
    console.log('入金総計 - 利用総計 - 期限切れ消滅 = 残高合計');
    console.log(inputTotal.toLocaleString() + ' - ' + totalUsed.toLocaleString() + ' - ' + bal.makuakeExpired.toLocaleString() + ' = ' + expected.toLocaleString());
    console.log('実際の残高合計:', bal.total.toLocaleString());
    console.log('差異:', (bal.total - expected).toLocaleString());

    // 上位顧客の残高
    console.log('\n--- 顧客別残高TOP10 ---');
    var custBal = [];
    state.customers.forEach(function(c) {
      var deps = state.deposits.filter(function(d) { return d.customerId === c.id; });
      var depTotal = deps.reduce(function(s, d) { return s + d.amount; }, 0);
      if (depTotal === 0) return;
      var used = 0;
      state.visits.forEach(function(v) {
        if (v.customerId !== c.id) return;
        used += calcVisitRevenue(v).preSale;
      });
      custBal.push({ name: c.name, id: c.id, channel: c.channel, deposited: depTotal, used: used, balance: depTotal - used });
    });
    custBal.sort(function(a, b) { return b.balance - a.balance; });
    console.table(custBal.slice(0, 10));

    return bal;
  }

  // Expose for inline handlers
  window.INAI = {
    editVisit: editVisit,
    deleteVisit: deleteVisit,
    editCustomer: editCustomer,
    showCustomerDetail: showCustomerDetail,
    updateBudget: updateBudget,
    deleteBudget: deleteBudget,
    debugBalance: debugBalanceDetail,
    fixUnmatchedStripe: fixUnmatchedStripe,
    fixDepositCustomers: async function() {
      console.log('===== デポジット顧客チェック =====');

      // 1. デポジット顧客を検出（ランクに「デポジット」含む or 入金メモに「デポジット」含む）
      var depositCustIds = {};
      state.customers.forEach(function(c) {
        if ((c.rank || '').indexOf('デポジット') >= 0) depositCustIds[c.id] = c;
      });
      state.deposits.forEach(function(d) {
        if ((d.memo || '').indexOf('デポジット') >= 0 && d.customerId) {
          var c = getCustomerById(d.customerId);
          if (c) depositCustIds[c.id] = c;
        }
      });

      var custIds = Object.keys(depositCustIds);
      console.log('デポジット顧客数:', custIds.length);

      // 2. ticketCount修正 & 重複入金チェック
      var ticketFixes = [];
      var duplicates = [];

      custIds.forEach(function(cid) {
        var c = depositCustIds[cid];
        // ticketCount が0以外なら修正対象
        if (c.ticketCount && c.ticketCount > 0) {
          ticketFixes.push({ id: cid, name: c.name, oldTicketCount: c.ticketCount });
        }

        // 入金の重複チェック（同日・同経路で複数）
        var deps = state.deposits.filter(function(d) { return d.customerId === cid; });
        var seen = {};
        deps.forEach(function(d) {
          var key = d.date + '_' + d.channel;
          if (seen[key]) {
            duplicates.push({
              customerId: cid,
              name: c.name,
              deposit1: seen[key],
              deposit2: d,
            });
          } else {
            seen[key] = d;
          }
        });

        // 入金詳細を表示
        console.log('\n' + c.name + ' (' + cid + ') ランク:' + c.rank + ' ticketCount:' + (c.ticketCount || 0));
        deps.forEach(function(d) {
          console.log('  ' + d.id + ' | ' + d.date + ' | ' + d.channel + ' | ¥' + (d.amount || 0).toLocaleString() + ' | ' + (d.memo || ''));
        });
      });

      // 3. ticketCount一括修正
      if (ticketFixes.length > 0) {
        console.log('\n--- ticketCount修正 (' + ticketFixes.length + '件) ---');
        for (var i = 0; i < ticketFixes.length; i++) {
          var f = ticketFixes[i];
          console.log(f.name + ' (' + f.id + '): ' + f.oldTicketCount + ' → 0');
          await fetch(state.gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'updateCustomer', data: { id: f.id, ticketCount: 0 } }),
          });
          var c2 = getCustomerById(f.id);
          if (c2) c2.ticketCount = 0;
        }
        console.log('ticketCount修正完了');
      }

      // 4. 重複入金を表示
      if (duplicates.length > 0) {
        console.log('\n--- 重複入金 (' + duplicates.length + '件) ---');
        duplicates.forEach(function(dup) {
          console.log(dup.name + ':');
          console.log('  残す: ' + dup.deposit1.id + ' ¥' + dup.deposit1.amount.toLocaleString() + ' ' + (dup.deposit1.memo || ''));
          console.log('  重複: ' + dup.deposit2.id + ' ¥' + dup.deposit2.amount.toLocaleString() + ' ' + (dup.deposit2.memo || ''));
        });
        console.log('\n重複入金の削除は手動で確認してください。削除するIDをINAI.deleteDepositIds([...])で実行できます。');
      } else {
        console.log('\n重複入金なし');
      }

      saveLocal();
      renderPage(state.currentPage);
      showToast('デポジット顧客チェック完了。コンソールを確認してください。');
    },
    deleteDepositIds: async function(ids) {
      if (!ids || ids.length === 0) return;
      console.log('入金削除:', ids);
      await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'deleteDeposits', data: ids }),
      });
      state.deposits = state.deposits.filter(function(d) { return ids.indexOf(d.id) < 0; });
      saveLocal();
      renderPage(state.currentPage);
      showToast(ids.length + '件の入金を削除しました');
    },
    fixChineseCoursePreSale: async function() {
      // 中華コースの来店で前売消費されているものを修正
      var targets = state.visits.filter(function(v) {
        return (v.plan || '').indexOf('中華') >= 0 && (v.preSaleGuests > 0 || v.preSaleRevenue > 0);
      });

      if (targets.length === 0) {
        console.log('中華コースで前売消費している来店はありません');
        return;
      }

      console.log('===== 中華コース前売修正 (' + targets.length + '件) =====');
      for (var i = 0; i < targets.length; i++) {
        var v = targets[i];
        var cust = getCustomerById(v.customerId);
        var name = cust ? cust.name : v.customerName || v.customerId;
        console.log(v.id + ' | ' + v.date + ' | ' + name + ' | ' + v.plan +
          ' | 前売人数:' + (v.preSaleGuests || 0) + '→0' +
          ' | 前売売上:¥' + (v.preSaleRevenue || 0).toLocaleString() + '→¥0');

        // GAS更新
        await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'updateVisit', data: {
            id: v.id,
            preSaleGuests: 0,
            preSaleRevenue: 0,
          }}),
        });

        // ローカル更新
        v.preSaleGuests = 0;
        v.preSaleRevenue = 0;
      }

      saveLocal();
      renderPage(state.currentPage);
      showToast('中華コース ' + targets.length + '件の前売を0に修正しました');
      console.log('修正完了');
    },
  };

  // ============================================================
  // 発注機能
  // ============================================================

  function initOrders() {
    // 仕入れ先選択時
    document.getElementById('order-supplier').addEventListener('change', function () {
      var sid = this.value;
      var area = document.getElementById('order-items-area');
      area.style.display = sid ? '' : 'none';
      state.currentOrder = [];
      renderCurrentOrderItems();
      populateItemSelect(sid);
    });

    // 品目追加
    document.getElementById('btn-order-add-item').addEventListener('click', function () {
      var selectVal = document.getElementById('order-item-select').value;
      var customVal = document.getElementById('order-item-custom').value.trim();
      var name = customVal || selectVal;
      var qty = document.getElementById('order-item-qty').value.trim();
      var unit = document.getElementById('order-item-unit').value;
      if (!name) { showToast('品目を選択または入力してください', true); return; }
      if (!qty) { showToast('数量を入力してください', true); return; }
      state.currentOrder.push({ name: name, qty: qty, unit: unit });
      renderCurrentOrderItems();
      // 入力をリセット
      document.getElementById('order-item-select').value = '';
      document.getElementById('order-item-custom').value = '';
      document.getElementById('order-item-qty').value = '';
      // 品目マスタに未登録なら追加
      var sid = document.getElementById('order-supplier').value;
      if (sid && customVal) {
        var items = state.supplierItems[sid] || [];
        var exists = items.some(function (i) { return i.name === customVal; });
        if (!exists) {
          items.push({ name: customVal, unit: unit });
          state.supplierItems[sid] = items;
          saveLocal();
          populateItemSelect(sid);
        }
      }
    });

    // LINEにコピー
    document.getElementById('btn-order-copy-line').addEventListener('click', function () {
      if (state.currentOrder.length === 0) { showToast('品目を追加してください', true); return; }
      var sid = document.getElementById('order-supplier').value;
      var supplier = state.suppliers.find(function (s) { return s.id === sid; });
      var date = document.getElementById('order-date').value;
      var memo = document.getElementById('order-memo').value.trim();

      var youbi = ['日','月','火','水','木','金','土'];
      var d = new Date(date);
      var dateStr = date + '（' + youbi[d.getDay()] + '）';
      var deliveryTime = document.getElementById('order-delivery-time').value;
      var text = 'お世話になっております。\n' + dateStr + (deliveryTime ? ' ' + deliveryTime : '') + ' で下記発注をお願いします。\n\n';
      state.currentOrder.forEach(function (item) {
        text += '・' + item.name + '　' + item.qty + item.unit + '\n';
      });
      if (memo) text += '\n※' + memo;

      navigator.clipboard.writeText(text).then(function () {
        showToast('LINEにコピーしました！貼り付けて送信してください');
      }).catch(function () {
        // フォールバック: テキストエリアでコピー
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('LINEにコピーしました！');
      });
    });

    // 保存
    document.getElementById('btn-order-save').addEventListener('click', function () {
      if (state.currentOrder.length === 0) { showToast('品目を追加してください', true); return; }
      var sid = document.getElementById('order-supplier').value;
      var supplier = state.suppliers.find(function (s) { return s.id === sid; });
      var date = document.getElementById('order-date').value;
      var memo = document.getElementById('order-memo').value.trim();

      var deliveryTime = document.getElementById('order-delivery-time').value.trim();
      var order = {
        id: 'ORD_' + Date.now(),
        date: date,
        supplierId: sid,
        supplierName: supplier ? supplier.name : '',
        items: state.currentOrder.slice(),
        memo: memo,
        deliveryTime: deliveryTime,
      };
      state.orders.unshift(order);
      saveLocal();
      showToast('発注を保存しました');
      // リセット
      state.currentOrder = [];
      document.getElementById('order-supplier').value = '';
      document.getElementById('order-items-area').style.display = 'none';
      document.getElementById('order-memo').value = '';
      renderOrderHistory();
    });

    // クリア
    document.getElementById('btn-order-clear').addEventListener('click', function () {
      state.currentOrder = [];
      renderCurrentOrderItems();
      document.getElementById('order-memo').value = '';
    });

    // 仕入れ先追加
    document.getElementById('btn-add-supplier').addEventListener('click', function () {
      var name = prompt('仕入れ先の名前を入力:');
      if (!name || !name.trim()) return;
      var id = 'SUP_' + Date.now();
      state.suppliers.push({ id: id, name: name.trim() });
      state.supplierItems[id] = [];
      saveLocal();
      renderOrdersPage();
      showToast(name.trim() + ' を追加しました');
    });
  }

  function populateItemSelect(supplierId) {
    var sel = document.getElementById('order-item-select');
    sel.innerHTML = '<option value="">選択 or 下に直接入力</option>';
    var items = state.supplierItems[supplierId] || [];
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = item.name + '（' + item.unit + '）';
      sel.appendChild(opt);
    });
    // 選択時に単位も自動設定
    sel.addEventListener('change', function () {
      var selected = items.find(function (i) { return i.name === sel.value; });
      if (selected) {
        document.getElementById('order-item-unit').value = selected.unit;
      }
    });
  }

  function renderCurrentOrderItems() {
    var container = document.getElementById('order-items-list');
    if (state.currentOrder.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px">品目を追加してください</div>';
      return;
    }
    var html = '<table><thead><tr><th>品目</th><th class="num">数量</th><th>単位</th><th></th></tr></thead><tbody>';
    state.currentOrder.forEach(function (item, idx) {
      html += '<tr>' +
        '<td>' + item.name + '</td>' +
        '<td class="num">' + item.qty + '</td>' +
        '<td>' + item.unit + '</td>' +
        '<td><button class="row-btn danger order-remove-item" data-idx="' + idx + '">削除</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // 削除ボタン
    container.querySelectorAll('.order-remove-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.currentOrder.splice(parseInt(this.dataset.idx), 1);
        renderCurrentOrderItems();
      });
    });
  }

  function renderOrderHistory() {
    var container = document.getElementById('order-history-list');
    if (state.orders.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">発注履歴はありません</div>';
      return;
    }
    var html = '';
    state.orders.forEach(function (order, idx) {
      var itemsSummary = order.items.map(function (i) { return i.name + ' ' + i.qty + i.unit; }).join('、');
      html += '<div class="order-history-item" style="padding:12px 0;border-bottom:1px solid var(--border-light)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
          '<div>' +
            '<span style="font-weight:600;margin-right:8px">' + order.supplierName + '</span>' +
            '<span style="font-size:12px;color:var(--text-tertiary)">' + order.date + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:4px">' +
            '<button class="row-btn order-recopy" data-idx="' + idx + '" title="再コピー">コピー</button>' +
            '<button class="row-btn danger order-delete" data-idx="' + idx + '">削除</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:13px;color:var(--text-secondary)">' + itemsSummary + '</div>' +
        (order.memo ? '<div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">※' + order.memo + '</div>' : '') +
      '</div>';
    });
    container.innerHTML = html;

    // 再コピー
    container.querySelectorAll('.order-recopy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var order = state.orders[parseInt(this.dataset.idx)];
        var youbi = ['日','月','火','水','木','金','土'];
        var d = new Date(order.date);
        var dateStr = order.date + '（' + youbi[d.getDay()] + '）';
        var text = 'お世話になっております。\n' + dateStr + (order.deliveryTime ? ' ' + order.deliveryTime : '') + ' で下記発注をお願いします。\n\n';
        order.items.forEach(function (item) { text += '・' + item.name + '　' + item.qty + item.unit + '\n'; });
        if (order.memo) text += '\n※' + order.memo;
        navigator.clipboard.writeText(text).then(function () { showToast('コピーしました'); });
      });
    });

    // 削除
    container.querySelectorAll('.order-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('この発注記録を削除しますか？')) return;
        state.orders.splice(parseInt(this.dataset.idx), 1);
        saveLocal();
        renderOrderHistory();
      });
    });
  }

  function renderSupplierMaster() {
    var container = document.getElementById('supplier-master-list');
    if (state.suppliers.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">仕入れ先を追加してください</div>';
      return;
    }
    var html = '';
    state.suppliers.forEach(function (sup) {
      var items = state.supplierItems[sup.id] || [];
      var itemNames = items.map(function (i) { return i.name; }).join('、');
      html += '<div style="padding:12px 0;border-bottom:1px solid var(--border-light)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
          '<span style="font-weight:600">' + sup.name + '</span>' +
          '<div style="display:flex;gap:4px">' +
            '<button class="row-btn supplier-add-item" data-id="' + sup.id + '">+ 品目</button>' +
            '<button class="row-btn danger supplier-delete" data-id="' + sup.id + '">削除</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-tertiary)">' + (itemNames || '品目未登録') + '</div>' +
      '</div>';
    });
    container.innerHTML = html;

    // 品目追加
    container.querySelectorAll('.supplier-add-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = this.dataset.id;
        var name = prompt('品目名を入力:');
        if (!name || !name.trim()) return;
        var unit = prompt('単位を入力（例: 本, kg, パック）:', '個');
        if (!unit) unit = '個';
        var items = state.supplierItems[sid] || [];
        items.push({ name: name.trim(), unit: unit.trim() });
        state.supplierItems[sid] = items;
        saveLocal();
        renderSupplierMaster();
      });
    });

    // 仕入れ先削除
    container.querySelectorAll('.supplier-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = this.dataset.id;
        var sup = state.suppliers.find(function (s) { return s.id === sid; });
        if (!confirm(sup.name + ' を削除しますか？')) return;
        state.suppliers = state.suppliers.filter(function (s) { return s.id !== sid; });
        delete state.supplierItems[sid];
        saveLocal();
        renderOrdersPage();
      });
    });
  }

  function renderOrdersPage() {
    // 仕入れ先プルダウン更新
    var sel = document.getElementById('order-supplier');
    var currentVal = sel.value;
    sel.innerHTML = '<option value="">選択してください</option>';
    state.suppliers.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = currentVal;

    // 発注日デフォルト
    var dateInput = document.getElementById('order-date');
    if (!dateInput.value) dateInput.value = today();

    renderCurrentOrderItems();
    renderOrderHistory();
    renderSupplierMaster();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
