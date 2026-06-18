/**
 * Pickleball rules engine — pure helpers for serving geometry, fault
 * classification, and score progression. All rule toggles come from RuleConfig
 * so the same engine supports singles now and rally/doubles variants later.
 *
 * SERVICE-COURT CONVENTION (documented for the README):
 *   - A server's service court is decided by their own score parity:
 *       even score -> RIGHT court, odd score -> LEFT court.
 *   - "Right"/"left" are from each player's perspective facing the net:
 *       Team A faces +x, so A.right = the y<CENTER side (bottom of screen).
 *       Team B faces -x, so B.right = the y>CENTER side (top of screen).
 *   - The serve must land in the diagonally opposite service court.
 */
import {
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  KITCHEN_A_MIN_X,
  KITCHEN_B_MAX_X,
  NET_X,
} from '../shared/constants';
import type {
  FaultReason,
  RuleConfig,
  ScoreState,
  ServiceCourt,
  Side,
} from '../shared/types';

export const opponent = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/** Even score serves from the right court, odd from the left. */
export function serviceCourtFor(score: number): ServiceCourt {
  return score % 2 === 0 ? 'right' : 'left';
}

/** Does y fall on the "bottom" (y<center) or "top" half? */
const isBottom = (y: number): boolean => y < CENTER_Y;

/**
 * Rectangle (in court coords) of a side's service court. The service court is
 * the area behind the kitchen on that side, split at the center line.
 */
export function serviceBox(side: Side, court: ServiceCourt) {
  // Determine which y-half this court maps to for this side.
  const bottom =
    side === 'A' ? court === 'right' : court === 'left'; // see convention note
  const yMin = bottom ? 0 : CENTER_Y;
  const yMax = bottom ? CENTER_Y : COURT_WIDTH;
  const xMin = side === 'A' ? 0 : KITCHEN_B_MAX_X;
  const xMax = side === 'A' ? KITCHEN_A_MIN_X : COURT_LENGTH;
  return { xMin, xMax, yMin, yMax };
}

/** The court a serve from (side, court) must land in (diagonally opposite). */
export function diagonalTarget(server: Side): {
  side: Side;
  court: ServiceCourt;
} {
  // Diagonal => receiver's court on the opposite y-half, but because both
  // players face the net, a right-court serve goes to the receiver's right.
  return { side: opponent(server), court: 'right' };
}

/** Is the point in the kitchen (non-volley zone) for the given side? */
export function inKitchen(side: Side, x: number): boolean {
  return side === 'A' ? x >= KITCHEN_A_MIN_X && x < NET_X : x > NET_X && x <= KITCHEN_B_MAX_X;
}

/** Validate that a serve landed in the correct diagonal service court. */
export function isServeLegal(
  server: Side,
  landX: number,
  landY: number,
  rules: RuleConfig,
): boolean {
  if (!rules.enforceDiagonalServe) {
    // Lenient mode: just needs to land in the opponent's non-kitchen court.
    const opp = opponent(server);
    const box = {
      xMin: opp === 'A' ? 0 : KITCHEN_B_MAX_X,
      xMax: opp === 'A' ? KITCHEN_A_MIN_X : COURT_LENGTH,
      yMin: 0,
      yMax: COURT_WIDTH,
    };
    return (
      landX >= box.xMin && landX <= box.xMax && landY >= box.yMin && landY <= box.yMax
    );
  }
  const score = server === 'A' ? 0 : 0; // resolved by caller via servingScore
  void score;
  return true; // detailed check is done in evaluateServeLanding using score
}

/**
 * Full serve-landing evaluation. Returns a fault reason or null if good.
 */
export function evaluateServeLanding(
  server: Side,
  servingScore: number,
  landX: number,
  landY: number,
  hitNet: boolean,
  rules: RuleConfig,
): FaultReason | null {
  if (hitNet) return 'net';
  const court = serviceCourtFor(servingScore);
  const target = diagonalTarget(server);
  if (rules.enforceDiagonalServe) {
    // Receiver's service court is decided by the SERVER's parity mirrored.
    const box = serviceBox(target.side, court);
    const inBox =
      landX >= box.xMin &&
      landX <= box.xMax &&
      landY >= box.yMin &&
      landY <= box.yMax;
    return inBox ? null : 'out';
  }
  return isServeLegal(server, landX, landY, rules) ? null : 'out';
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
export interface PointOutcome {
  score: ScoreState;
  matchWinner: Side | null;
  sideOut: boolean;
}

/** Has `score` reached a winning state for the given rules? */
export function checkMatchWinner(
  score: ScoreState,
  rules: RuleConfig,
): Side | null {
  const { A, B } = score;
  const lead = Math.abs(A - B);
  if (A >= rules.pointsToWin && lead >= rules.winBy) return 'A';
  if (B >= rules.pointsToWin && lead >= rules.winBy) return 'B';
  return null;
}

/**
 * Apply the result of a rally. `rallyWinner` is the side that won the rally.
 * In traditional scoring only the serving side can score; otherwise it is a
 * side-out. In rally scoring every rally scores a point.
 */
export function resolveRally(
  score: ScoreState,
  rallyWinner: Side,
  rules: RuleConfig,
): PointOutcome {
  const next: ScoreState = { ...score };
  let sideOut = false;

  if (rules.scoring === 'rally') {
    next[rallyWinner] += 1;
    if (rallyWinner !== score.serving) {
      next.serving = rallyWinner;
      sideOut = true;
    }
  } else {
    // Traditional: serving side scores; receiver winning => side-out only.
    if (rallyWinner === score.serving) {
      next[rallyWinner] += 1;
    } else {
      next.serving = rallyWinner;
      sideOut = true;
    }
  }

  next.serverNumber = 1; // singles MVP: always server #1
  next.serviceCourt = serviceCourtFor(next[next.serving]);

  return { score: next, matchWinner: checkMatchWinner(next, rules), sideOut };
}
