'use strict';
// A correction plan as the chat model and search produce it, for tests of what happens after.
const plan = (feedback = '修正', extra = {}) => ({
  prompt: `Planned correction for: ${feedback}`,
  summary: `理解：${feedback}`.slice(0, 200),
  conflicts: '',
  query: 'costume detail',
  sources: [],
  searched: 0,
  warnings: [],
  model: 'fixture-chat',
  createdAt: '2026-11-08T00:00:00.000Z',
  ...extra,
});
module.exports = { plan };
