import http from 'k6/http';
import { check, sleep } from 'k6';

// ============================================================
// SECURITY TEST — Kiểm tra Rate Limiting hoạt động đúng
//
// Cho luận văn Section 5.9: Security Testing
//
// Test 2 tầng rate limiting:
//   1. Nginx: /auth/ → api_auth zone (10r/s, burst=20)
//   2. NestJS Throttler: /videos/ → 100 req/60s/IP (ĐÃ ĐỔI LẠI GỐC)
//
// Kỳ vọng: request vượt giới hạn → bị chặn 429 hoặc 503
//           server KHÔNG crash (không trả 500)
// ============================================================

export const options = {
  scenarios: {
    // Test 1: Nginx rate limit trên /auth/login
    nginx_auth_ratelimit: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 40,
      maxDuration: '30s',
      exec: 'testNginxAuthRateLimit',
    },
    // Test 2: NestJS Throttler trên /videos/feed/all
    nestjs_throttler: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 120,   // > 100 limit → sẽ trigger throttler
      maxDuration: '60s',
      startTime: '35s',  // Chạy sau test 1
      exec: 'testNestjsThrottler',
    },
  },
};

const BASE_URL = 'http://18.138.223.226';

// ============================================================
// TEST 1: Nginx Rate Limit — /auth/login (api_auth: 10r/s, burst=20)
// 40 request liên tục → request 21+ bị chặn 503
// ============================================================
export function testNginxAuthRateLimit() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: 'fake_user', password: 'fake_pass' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(res, {
    '[Nginx] Server không crash': (r) => r.status !== 500,
    '[Nginx] Phản hồi hợp lệ (401/429/503)':
      (r) => [400, 401, 429, 503].includes(r.status),
  });

  const blocked = [429, 503].includes(res.status);
  if (blocked) {
    console.log(`[Nginx Rate Limit OK] iter=${__ITER} status=${res.status}`);
  }
}

// ============================================================
// TEST 2: NestJS Throttler — /videos/feed/all (100 req/60s/IP)
// 120 request liên tục → request 101+ bị chặn 429
// CHÚ Ý: Chỉ test khi đã ĐỔI LẠI limit: 100 (gốc) trong app.module.ts
// ============================================================
export function testNestjsThrottler() {
  const res = http.get(`${BASE_URL}/videos/feed/all`);

  check(res, {
    '[Throttler] Server không crash': (r) => r.status !== 500,
    '[Throttler] Phản hồi hợp lệ (200/429/503)':
      (r) => [200, 429, 503].includes(r.status),
  });

  const blocked = [429, 503].includes(res.status);
  if (blocked) {
    console.log(`[NestJS Throttler OK] iter=${__ITER} status=${res.status}`);
  }
}