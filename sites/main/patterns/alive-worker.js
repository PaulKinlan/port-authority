// A worker that counts prime numbers, for the demo where a page restarts a
// worker that has stopped answering. It is given two ports: one for the work,
// one to answer health pings on. The work port's protocol knows nothing about
// health, and the health port knows nothing about primes.
import { answer } from "/alive.js";

function primesBelow(n) {
  const sieve = new Uint8Array(n);
  let count = 0;
  for (let i = 2; i < n; i++) {
    if (sieve[i]) continue;
    count++;
    for (let j = i * i; j < n; j += i) sieve[j] = 1;
  }
  return count;
}

onmessage = ({ data, ports }) => {
  if (data.ports) {
    const [work, health] = ports;
    answer(health);
    work.onmessage = ({ data: ask }) => work.postMessage({ id: ask.id, n: ask.n, count: primesBelow(ask.n) });
  }
  // Only for the demo: ways for this worker to go wrong.
  if (data.hang) for (;;);
  if (data.quit) close();
};
