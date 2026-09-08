/**
 * API wire for final-4 block endpoints
 */
import {
  e2ePreflight,
  e2eSelfTest,
  ops247Snapshot,
  autopilotTick,
  productionBlock,
  runFinal4SelfCheck,
  type QueueCandidate,
} from '../../../packages/final-4/src/index';

export function final4E2ePreflight() {
  return e2ePreflight(process.env as any);
}

export function final4E2eLogicTest() {
  return e2eSelfTest();
}

export function final4Ops247() {
  return ops247Snapshot();
}

export function final4Production() {
  return productionBlock(process.env as any);
}

export function final4SelfCheck() {
  return runFinal4SelfCheck(process.env as any);
}

export function final4AutopilotTick(candidates: QueueCandidate[], usage: {
  newProductsToday: number;
  publishesToday: number;
  fulfillsToday: number;
  aiCallsToday: number;
  autoApprovesToday: number;
}) {
  return autopilotTick({ candidates, usage });
}
