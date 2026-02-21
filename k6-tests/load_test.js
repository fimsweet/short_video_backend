import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============================================================
// CUSTOM METRICS
// ============================================================
const errorRate  = new Rate('error_rate');
const feedDuration = new Trend('feed_response_ms');

// ============================================================
// CẤU HÌNH
//
// 2 tầng rate limiting:
//   1. Nginx:  /videos/ → zone=api_general: 30r/s, burst=50, nodelay
//   2. NestJS: ThrottlerModule: 10000 req/60s/IP (tạm nâng từ 100)
//
// Với limit=10000 và Nginx 30r/s (burst=50):
//   Bottleneck là Nginx: 30 req/s sustained
//   100 VUs / sleep(2~4s) avg=3s → ~33 req/s → sát giới hạn
//   Dùng jitter để tránh thundering herd
// ============================================================
const VUS = parseInt(__ENV.VUS) || 100;

export const options = {
  stages: [
    { duration: '30s', target: VUS }, // Tăng dần
    { duration: '2m',  target: VUS }, // Giữ ổn định 2 phút → đo thật
    { duration: '30s', target: 0   }, // Giảm dần
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000'], // 95% request < 1s
    'http_req_failed':   ['rate<0.05'],  // Lỗi < 5%
  },
};

// ============================================================
// URL — /videos/feed/all là PUBLIC endpoint, không cần token
// (Đã xác nhận trong videos.controller.ts: không có @UseGuards)
// ============================================================
const BASE_URL = 'http://18.138.223.226';

export default function () {
  // ============================================================
  // JITTER: mỗi VU sleep ngẫu nhiên 0~2s lúc khởi động
  // để tránh tất cả VUs bắn đồng thời ngay từ đầu
  // ============================================================
  if (__ITER === 0) {
    sleep(Math.random() * 2);
  }

  // ============================================================
  // TEST: GET /videos/feed/all
  //   - Cache HIT  (Redis, 1 phút TTL): ~60ms, không tốn DB
  //   - Cache MISS (MySQL + privacy filter + like/comment counts): ~200-500ms
  // ============================================================
  const res = http.get(`${BASE_URL}/videos/feed/all`);
  feedDuration.add(res.timings.duration);

  const ok = check(res, {
    'status 200':        (r) => r.status === 200,
    'response time <1s': (r) => r.timings.duration < 1000,
    'body not empty':    (r) => r.body && r.body.length > 2,
  });
  errorRate.add(!ok);

  // Nếu thất bại, in ra status code để debug
  if (res.status !== 200) {
    console.error(`[FAIL] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body.substring(0, 100)}`);
  }

  // ============================================================
  // SLEEP ngẫu nhiên 2~4s (avg 3s)
  //   100 VUs / avg 3s = ~33 req/s (Nginx limit 30r/s + burst=50)
  //   Jitter phân tán đều → tránh thundering herd
  //   NestJS Throttler: 10000 req/60s → không còn là bottleneck
  // ============================================================
  sleep(2 + Math.random() * 2);
}