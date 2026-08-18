/**
 * Development-only logging helpers. They also tolerate non-Metro runtimes,
 * such as isolated Node tests where the React Native `__DEV__` global is absent.
 */

export const devWarn = (...args: unknown[]): void => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(...args);
};

export const devError = (...args: unknown[]): void => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error(...args);
};

export const devLog = (...args: unknown[]): void => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log(...args);
};
