/**
 * Input state — a tiny shared store the game loop and the on-screen controls
 * both write into. It is device-agnostic on purpose:
 *
 *   - Pointer (mouse or finger) position over the court sets the paddle TARGET
 *     in world coords (the loop converts screen->world). The paddle follows 1:1.
 *   - `wantCharge` is the "hold to charge a swing" signal. Desktop sets it from
 *     the left mouse button (and Space); mobile sets it from the HOLD-TO-HIT
 *     button. While charging, the paddle locks and pointer movement becomes the
 *     slingshot AIM drag. Releasing fires.
 *
 * The loop owns charge timing + aim math (it has the renderer's transform) and
 * calls `commitSwing` to publish the released swing.
 */
export const inputState = {
  // paddle target in WORLD coords
  targetX: 0,
  targetY: 0,
  // latest pointer position in CSS px relative to the canvas (for aim drag)
  pointerX: 0,
  pointerY: 0,
  // hold-to-charge signal (any device)
  wantCharge: false,
  // reflects whether we are actually charging (loop sets this; for viz)
  charging: false,
  // released-swing output
  swingId: 0,
  aimX: 1,
  aimY: 0,
  power: 0,
};

export function setTarget(x: number, y: number) {
  inputState.targetX = x;
  inputState.targetY = y;
}

export function setPointer(x: number, y: number) {
  inputState.pointerX = x;
  inputState.pointerY = y;
}

export function setWantCharge(v: boolean) {
  inputState.wantCharge = v;
}

export function commitSwing(aimX: number, aimY: number, power: number) {
  inputState.aimX = aimX;
  inputState.aimY = aimY;
  inputState.power = power;
  inputState.swingId += 1;
}

export function resetInput(side: 'A' | 'B' | null) {
  inputState.wantCharge = false;
  inputState.charging = false;
  inputState.aimX = side === 'B' ? -1 : 1;
  inputState.aimY = 0;
  inputState.power = 0;
}
