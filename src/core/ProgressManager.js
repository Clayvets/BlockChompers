/**
 * Money and level progression. Pure data + rules: no DOM, no three, no clock.
 *
 * levelNumber is what the player sees ("Level 3") and keeps counting forever. The level CONTENT loops:
 * levelNumber n plays levels[(n - 1) % levels.length], so finishing the last level continues with the
 * first one as the next number and progression never dead-ends.
 *
 * The reward (Config.progression.rewardPerLevel) is paid at most once per levelNumber, and only a
 * completed level can be advanced past. GameManager is the only caller that mutates this class (from its
 * commands) and emits the matching events; everyone else reads getState().
 */
export class ProgressManager {
  /** @type {ReadonlyArray<object>} */
  #levels;
  /** levelNumber whose reward has been paid (0 = none yet). */
  #paidLevelNumber = 0;

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

  /** Level definition that advance() would move to, or null without levels. */
  nextLevel() {
    return this.#levelFor(this.levelNumber + 1);
  }

  #levelFor(levelNumber) {
    const count = this.#levels.length;
    return count === 0 ? null : this.#levels[(levelNumber - 1) % count];
  }

  /** Reward for completing the current level. */
  currentReward() {
    return this.config.progression.rewardPerLevel;
  }

  /** True once the current level's reward has been paid. */
  isCompleted() {
    return this.#paidLevelNumber === this.levelNumber;
  }

  /**
   * Pay the current level's reward. Idempotent per levelNumber: a second call pays nothing.
   * @returns {{ ok: boolean, reward: number, money: number }}
   */
  completeLevel() {
    if (this.isCompleted()) return { ok: false, reward: 0, money: this.money };
    const reward = this.currentReward();
    this.money += reward;
    this.#paidLevelNumber = this.levelNumber;
    this.version += 1;
    return { ok: true, reward, money: this.money };
  }

  /**
   * Move to the next levelNumber. Only a completed level can be left this way.
   * @returns {{ ok: boolean, level: object|null, levelNumber: number }}
   */
  advance() {
    if (!this.isCompleted() || this.#levels.length === 0) return { ok: false, level: null, levelNumber: this.levelNumber };
    this.levelNumber += 1;
    this.version += 1;
    return { ok: true, level: this.currentLevel(), levelNumber: this.levelNumber };
  }

  /**
   * Plain, JSON-serialisable state.
   * @returns {{ levelNumber: number, levelId: string|null, levelCount: number, money: number, reward: number, completed: boolean, version: number }}
   */
  getState() {
    const level = this.currentLevel();
    return {
      levelNumber: this.levelNumber,
      levelId: level ? level.id : null,
      levelCount: this.#levels.length,
      money: this.money,
      reward: this.currentReward(),
      completed: this.isCompleted(),
      version: this.version,
    };
  }
}
