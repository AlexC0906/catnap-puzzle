// Catnap — background puzzle generation so the UI never freezes.
/* global importScripts, CatnapEngine, CatnapLogic */
importScripts('engine.js', 'logic.js');
self.onmessage = e => {
  const { id, n, tier, seed } = e.data;
  const p = CatnapLogic.generateRated(CatnapEngine, n, tier, seed);
  self.postMessage({ id, puzzle: p && { n: p.n, regions: p.regions, solution: p.solution, seed: p.seed, baseSeed: p.baseSeed, tier: p.tier } });
};
