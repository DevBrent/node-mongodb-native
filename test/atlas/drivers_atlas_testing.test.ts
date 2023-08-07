import { writeFile } from 'node:fs/promises';

import * as path from 'path';

import { runUnifiedSuite } from '../tools/unified-spec-runner/runner';

describe('Node Driver Atlas Testing', async function () {
  console.log('process.env', process.env);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const spec = JSON.parse(process.env.WORKLOAD_SPECIFICATION!);
  runUnifiedSuite([spec]);
  // Write the events.json to the execution directory.
  await writeFile(
    path.join(process.env.OUTPUT_DIRECTORY ?? '', 'events.json'),
    JSON.stringify({ events: [], errors: [], failures: [] })
  );
  // Write the results.json to the execution directory.
  await writeFile(
    path.join(process.env.OUTPUT_DIRECTORY ?? '', 'results.json'),
    JSON.stringify({ numErrors: 0, numFailures: 0, numSuccesses: 0, numIterations: 0 })
  );
});
