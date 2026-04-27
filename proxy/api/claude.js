/**
 * Anthropic API 프록시 (Vercel Serverless Function)
 * ------------------------------------------------------
 * - 브라우저 → 이 함수 → Anthropic API로 전달
 * - API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에서 읽어 노출되지 않음
 * - 미국 iad1 리전에서 실행되어 Anthropic의 지역 차단 회피
 * - POST 요청만 허용, 요청 body를 그대로 Anthropic에 전달
 *
 * Node.js Runtime 사용 (Vercel 기본값):
 * - Edge Runtime은 maxDuration 설정이 제한적이라 타임아웃 가능
 * - 종합 분석 요청은 이미지 여러 장 + 긴 응답으로 15~30초 소요
 * - Node.js Runtime은 maxDuration: 30이 정상 작동
 * - runtime 필드 생략 시 Vercel이 최신 LTS Node 버전 자동 선택
 */

// Vercel 허용 runtime 값: 'edge' 또는 'nodejs' (버전 명시 안 함)
// Node.js 버전은 Vercel 프로젝트 설정에서 별도 지정
// maxDuration은 Hobby 플랜에선 60초까지 무료, 그 이상은 Pro 필요
export const config = {
  runtime: 'nodejs',
  regions: ['iad1'],
  maxDuration: 60,
};

// req body를 raw 스트림으로 읽어 크기 제한 우회 (이미지 업로드 대응)
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req, res) {
  // CORS 헤더 먼저 세팅
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. Vercel 대시보드에서 등록하세요.'
    });
    return;
  }

  // req body를 raw 스트림에서 읽음 (Vercel 기본 body parser 우회)
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const bodySizeKB = (Buffer.byteLength(body, 'utf8') / 1024).toFixed(1);
  console.log(`[claude] Request size: ${bodySizeKB} KB`);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      const preview = text.slice(0, 500) || '(empty body)';
      console.error(`[claude] Anthropic ERROR status=${upstream.status} body=${preview}`);
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text);
  } catch (e) {
    console.error('[claude] Upstream error:', e);
    res.status(502).json({ error: `Upstream error: ${String(e)}` });
  }
}
