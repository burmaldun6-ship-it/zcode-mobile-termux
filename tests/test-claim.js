'use strict';

// Thin wrapper: the real claim-module suite lives in claim/test-claim.js so the
// claim/ directory stays self-contained for the release tarball. Requiring it
// runs the tests and sets process.exitCode on failure.
require('../claim/test-claim.js');
