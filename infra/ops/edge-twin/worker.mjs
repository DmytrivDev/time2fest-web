// Двійник Worker’а краю репетиції для перевірки перенесення імені (AC-33): відповідає позначкою `x-t2f-twin`,
// щоб зонд бачив, який із двох Worker’ів зараз тримає ім’я. Нічого не читає й не проксує.
export default {
  fetch() {
    return new Response('t2f-edge-rehearsal-alt', { headers: { 'x-t2f-twin': '1', 'cache-control': 'no-store' } });
  },
};
