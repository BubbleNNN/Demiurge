'use strict';
// Artwork-specific choices are data; use the generic publisher and quality gate.
process.env.MORI_MOTION_SOURCE = 'shared/cyrene-motion-source.json';
require('./compile-motion-pack.cjs');
