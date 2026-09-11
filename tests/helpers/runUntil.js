/** Step the game until predicate(game) is true or maxSteps is exhausted. Returns the steps taken. */
export function runUntil(game, predicate, maxSteps = 1000) {
  let steps = 0;
  while (!predicate(game) && steps < maxSteps) {
    game.step();
    steps += 1;
  }
  return steps;
}
