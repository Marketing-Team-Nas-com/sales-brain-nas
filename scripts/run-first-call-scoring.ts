import { runFirstCallScoring } from "../app/lib/first-call-scoring/run";

console.log(JSON.stringify(await runFirstCallScoring(), null, 2));
