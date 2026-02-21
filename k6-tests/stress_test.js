import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ============================================================
// STRESS TEST — Tìm điểm giới hạn (breaking point) của hệ thống
//
// Mục đích: Tăng dần VUs để xem response time tăng thế nào
// và tỷ lệ lỗi bắt đầu tăng ở mức nào.
//
// Cho luận văn Section 5.8: Scalability Testing
// ============================================================
const errorRate = new Rate('error_rate');
const feedDuration = new Trend('feed_response_ms');

export const options = {
  stages: [
    { duration: '30s', target: 50   }, // Warm up
    { duration: '1m',  target: 100  }, // Tải bình thường
    { duration: '1m',  target: 200  }, // Tải cao
    { duration: '1m',  target: 300  }, // Stress
    { duration: '1m',  target: 500  }, // High stress
    { duration: '30s', target: 0    }, // Cool down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<2000'], // Stress test: cho phép tới 2s
  },
};

// /videos/feed/all là PUBLIC endpoint — không cần token
const BASE_URL = 'http://18.138.223.226';

export default function () {
  // Jitter khởi động: tránh thundering herd
  if (__ITER === 0) {
    sleep(Math.random() * 3);
  }

  const res = http.get(`${BASE_URL}/videos/feed/all`);
  feedDuration.add(res.timings.duration);

  const ok = check(res, {
    'status 200':        (r) => r.status === 200,
    'response time <2s': (r) => r.timings.duration < 2000,
  });
  errorRate.add(!ok);

  if (res.status !== 200) {
    console.error(`[STRESS] VU=${__VU} status=${res.status}`);
  }

  // Sleep ngẫu nhiên 1~3s — stress test cần tải cao hơn load test
  // Chấp nhận sẽ có lỗi rate limit ở VU cao — đó chính là data cần thu
  sleep(1 + Math.random() * 2);
}