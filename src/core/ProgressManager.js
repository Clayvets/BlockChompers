/**
 * Money and level progression. Pure data + rules: no DOM, no three, no clock.
 *
 * The progression is a cycle: levelNumber runs 1..levelCount and winning the last level wraps back to Level 1, so
 * the whole cycle repeats while money keeps accumulating. getState().isLastLevel tells the UI when the next
 * Continue starts the cycle again ("Play again").
 *
 * The reward (Config.progression.rewardPerLevel) is paid at most once per visit of a level, and only a completed
 * level can be advanced past. GameManager is the only caller that mutates this class (from its commands) and
 * emits the matching events; everyone else reads getState().
 */
export class ProgressManager {
  /** @type {ReadonlyArray<object>} */
  #levels;
  /** Whether the current visit of the current level has been paid. */
  #paid = false;

  /**
   * @param {{ config: object, levels?: object[] }} deps  levels in play order (validated by the caller)
   */
  constructor({ config, levels = [] }) {
    this.config = config;
    this.#levels = Object.freeze([...levels]);
    this.money = config.progression.startingMoney;
    this.levelNumber = 1;
    /** Bumps on every change. */
    this.version = 0;
  }

  get levelCount() {
    return this.#levels.length;
  }

  /** Level definition for the current levelNumber, or null without levels. */
  currentLevel() {
    return this.#levelFor(this.levelNumber);
  }

  /** Level definition that advance() would move to (Level 1 after the last one), or null without levels. */
  nextLevel() {
    return this.#levelFor(this.#nextNumber());
  }

  /** True on the last level of the cycle: the next advance goes back to Level 1. */
  isLastLevel() {
    return this.#levels.length > 0 && this.levelNumber === this.#levels.length;
  }

  #nextNumber() {
    return this.#levels.length === 0 ? this.levelNumber : (this.levelNumber % this.#levels.length) + 1;
  }

  #levelFor(levelNumber) {
    const count = this.#levels.length;
    return count === 0 ? null : this.#levels[(levelNumber - 1) % count];
  }

  /** Reward for completing the current level. */
  currentReward() {
    return this.config.progression.rewardPerLevel;
  }

  /** True once the current visit of this level has been paid. */
  isCompleted() {
    return this.#paid;
  }

  /**
   * Pay the current level's reward. Once per visit: a second call pays nothing.
   * @returns {{ ok: boolean, reward: number, money: number }}
   */
  completeLevel() {
    if (this.#paid) return { ok: false, reward: 0, money: this.money };
    const reward = this.currentReward();
    this.money += reward;
    this.#paid = true;
    this.version += 1;
    return { ok: true, reward, money: this.money };
  }

  /**
   * Move to the next level (Level 1 after the last one). Only a completed visit can be left this way; the new visit
   * starts unpaid.
   * @returns {{ ok: boolean, level: object|null, levelNumber: number }}
   */
  advance() {
    if (!this.#paid || this.#levels.length === 0) return { ok: false, level: null, levelNumber: this.levelNumber };
    this.levelNumber = this.#nextNumber();
    this.#paid = false;
    this.version += 1;
    return { ok: true, level: this.currentLevel(), levelNumber: this.levelNumber };
  }

  /**
   * Plain, JSON-serialisable state.
   * @returns {{ levelNumber: number, levelId: string|null, levelCount: number, isLastLevel: boolean, money: number,
   *             reward: number, completed: boolean, version: number }}
   */
  getState() {
    const level = this.currentLevel();
    return {
      levelNumber: this.levelNumber,
      levelId: level ? level.id : null,
      levelCount: this.#levels.length,
      isLastLevel: this.isLastLevel(),
      money: this.money,
      reward: this.currentReward(),
      completed: this.isCompleted(),
      version: this.version,
    };
  }
}
