/**
 * 국토부 부동산 실거래가 API 프록시 (Vercel Serverless Function)
 * ------------------------------------------------------
 * - API 키를 서버에 숨겨 브라우저로 노출되지 않게 함
 * - CORS 자동 해결
 * - XML → JSON 변환
 * - 최근 N개월 자동 수집 (병렬 호출)
 * - 건물명/면적 기반 후필터링
 *
 * 사용 엔드포인트 (GET):
 *   /api/realestate?sigunguCode=11680&buildingType=아파트&tradeType=매매&months=6
 *
 * 참고: 국토부 API는 한국 서버(apis.data.go.kr)이므로
 * Vercel이 미국(iad1)에서 호출해도 정상 작동합니다.
 */

export const config = {
  runtime: 'edge',
  regions: ['iad1'],
};

const API_BASE = 'https://apis.data.go.kr/1613000';

// 건물종류 + 거래유형 → 엔드포인트 매핑
const ENDPOINTS = {
  '아파트':      { '매매':  'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
                    '전월세': 'RTMSDataSvcAptRent/getRTMSDataSvcAptRent' },
  '오피스텔':    { '매매':  'RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
                    '전월세': 'RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent' },
  '연립다세대':  { '매매':  'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
                    '전월세': 'RTMSDataSvcRHRent/getRTMSDataSvcRHRent' },
  '단독다가구':  { '매매':  'RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
                    '전월세': 'RTMSDataSvcSHRent/getRTMSDataSvcSHRent' },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(request) {
  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Only GET allowed' }, 405);
  }

  const url = new URL(request.url);
  const sigunguCode   = url.searchParams.get('sigunguCode');
  const buildingType  = url.searchParams.get('buildingType') || '아파트';
  const tradeType     = url.searchParams.get('tradeType') || '매매';
  const months        = Math.max(1, Math.min(12, parseInt(url.searchParams.get('months') || '6', 10)));
  const buildingName  = (url.searchParams.get('buildingName') || '').trim();
  const areaStr       = url.searchParams.get('area');
  const area          = areaStr ? parseFloat(areaStr) : null;
  // 면적 필터 허용 오차 (기본 ±10%, 쿼리로 조절 가능)
  const areaTolStr    = url.searchParams.get('areaTolerance');
  const areaTolerance = areaTolStr ? Math.max(0.01, Math.min(1.0, parseFloat(areaTolStr))) : 0.07;

  // 입력 검증
  if (!/^\d{5}$/.test(sigunguCode || '')) {
    return json({ ok: false, error: 'sigunguCode는 5자리 숫자여야 합니다.' }, 400);
  }
  const endpoint = ENDPOINTS[buildingType]?.[tradeType];
  if (!endpoint) {
    return json({ ok: false, error: `지원하지 않는 조합: ${buildingType}/${tradeType}` }, 400);
  }

  const molitApiKey = process.env.MOLIT_API_KEY;
  if (!molitApiKey) {
    return json({
      ok: false,
      error: 'MOLIT_API_KEY 환경변수가 설정되지 않았습니다. Vercel 대시보드에서 등록하세요.'
    }, 500);
  }

  // 최근 N개월 YYYYMM 생성
  const yyyymmList = lastNMonths(months);

  // 병렬 호출
  const results = await Promise.all(
    yyyymmList.map(ymd => fetchMonth(endpoint, sigunguCode, ymd, molitApiKey))
  );

  // 병합 및 정규화
  const allItems = [];
  let errorsCount = 0;
  for (const r of results) {
    if (r.error) { errorsCount++; continue; }
    allItems.push(...r.items);
  }

  const normalized = allItems
    .map(item => normalizeItem(item, buildingType, tradeType))
    .filter(Boolean)
    .sort((a, b) => (b._sortKey || '').localeCompare(a._sortKey || ''));

  // 필터링 (건물명, 면적)
  let filtered = normalized;
  if (buildingName) {
    const kw = buildingName.replace(/\s+/g, '').toLowerCase();
    filtered = filtered.filter(t => (t.name || '').replace(/\s+/g, '').toLowerCase().includes(kw));
  }
  if (area && !isNaN(area)) {
    const lo = area * (1 - areaTolerance);
    const hi = area * (1 + areaTolerance);
    filtered = filtered.filter(t => t.area && t.area >= lo && t.area <= hi);
  }

  const stats = computeStats(filtered.length > 0 ? filtered : normalized, tradeType);

  return json({
    ok: true,
    buildingType,
    tradeType,
    sigunguCode,
    months: yyyymmList,
    totalCount: normalized.length,
    filteredCount: filtered.length,
    apiErrors: errorsCount,
    usedFilter: filtered.length > 0 && (buildingName || area),
    areaTolerance,      // 실제 적용된 허용 오차 (HTML에서 참조)
    ...stats,
    // 클라이언트(HTML)에서 이상치 제거·클러스터링하려면 충분한 표본이 필요함
    transactions: (filtered.length > 0 ? filtered : normalized).slice(0, 200)
      .map(({ _sortKey, ...rest }) => rest),
    source: '국토교통부 공공데이터포털',
  });
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function lastNMonths(n) {
  const out = [];
  const now = new Date();
  // 실거래가 신고는 계약일로부터 30일이라 "이번달"은 데이터가 적음 → 지난달부터 시작
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(ym);
  }
  return out;
}

async function fetchMonth(endpoint, lawdCd, dealYmd, serviceKey) {
  const params = new URLSearchParams({
    serviceKey,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo: '1',
    numOfRows: '500',
  });
  const url = `${API_BASE}/${endpoint}?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/xml' },
      // Vercel Edge에도 캐시 가능하지만 외부 API라 명시 안 해도 됨
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}`, items: [] };
    const xml = await resp.text();
    const items = parseXmlItems(xml);
    return { items };
  } catch (e) {
    return { error: String(e), items: [] };
  }
}

function parseXmlItems(xml) {
  if (/<resultCode>(?!00)/.test(xml) && !/<resultCode>00<\/resultCode>/.test(xml)) {
    const msg = (xml.match(/<resultMsg>([^<]+)<\/resultMsg>/) || [])[1] || '';
    if (msg && !/정상/.test(msg) && !/NORMAL/i.test(msg)) {
      return [];
    }
  }

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const inner = m[1];
    const obj = {};
    const tagRegex = /<([A-Za-z][A-Za-z0-9]*)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRegex.exec(inner)) !== null) {
      obj[t[1]] = t[2].trim();
    }
    items.push(obj);
  }
  return items;
}

function normalizeItem(item, buildingType, tradeType) {
  const year  = item.dealYear  || '';
  const month = (item.dealMonth || '').padStart(2, '0');
  const day   = (item.dealDay   || '').padStart(2, '0');
  if (!year || !month) return null;

  // 전체 날짜 (일자까지 포함) — 주차별 집계에 필요
  const date = (day && day !== '00') ? `${year}-${month}-${day}` : `${year}-${month}`;
  const sortKey = `${year}${month}${day}`;

  let name = '';
  if (buildingType === '아파트')     name = item.aptNm || '';
  if (buildingType === '오피스텔')    name = item.offiNm || '';
  if (buildingType === '연립다세대')  name = item.mhouseNm || '';
  if (buildingType === '단독다가구')  name = item.houseType || '단독/다가구';

  let area = null;
  if (buildingType === '단독다가구') {
    area = item.totalFloorAr ? parseFloat(item.totalFloorAr) : null;
  } else {
    area = item.excluUseAr ? parseFloat(item.excluUseAr) : null;
  }

  const toInt = v => {
    if (!v) return null;
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? null : n;
  };

  const base = {
    date,                                                  // "2026-03-15"
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: day && day !== '00' ? parseInt(day, 10) : null,   // 일자 (주차 계산용)
    type: tradeType,
    name: name || '(미상)',
    area,
    floor: item.floor || null,
    dong: item.umdNm || '',
    jibun: item.jibun || '',
    buildYear: item.buildYear ? parseInt(item.buildYear, 10) : null,
    _sortKey: sortKey,
  };

  if (tradeType === '매매') {
    base.price = toInt(item.dealAmount);
    base.deposit = null;
    base.monthlyRent = null;
  } else {
    base.price = null;
    base.deposit = toInt(item.deposit);
    base.monthlyRent = toInt(item.monthlyRent);
    if (base.monthlyRent === 0) base.monthlyRent = null;
  }

  return base;
}

function computeStats(items, tradeType) {
  if (tradeType === '매매') {
    const prices = items.map(i => i.price).filter(n => n && n > 0);
    return {
      avg_sale_price: avg(prices),
      median_sale_price: median(prices),
      min_sale_price: prices.length ? Math.min(...prices) : null,
      max_sale_price: prices.length ? Math.max(...prices) : null,
      avg_deposit: null,
      avg_monthly_rent: null,
    };
  } else {
    const leaseOnly = items.filter(i => (i.monthlyRent || 0) === 0 || i.monthlyRent === null)
      .map(i => i.deposit).filter(n => n && n > 0);
    const withRent = items.filter(i => i.monthlyRent && i.monthlyRent > 0);
    return {
      avg_sale_price: null,
      avg_deposit: avg(items.map(i => i.deposit).filter(n => n && n > 0)),
      avg_lease_deposit: avg(leaseOnly),
      avg_monthly_rent: avg(withRent.map(i => i.monthlyRent)),
      avg_monthly_deposit: avg(withRent.map(i => i.deposit).filter(n => n && n > 0)),
    };
  }
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
