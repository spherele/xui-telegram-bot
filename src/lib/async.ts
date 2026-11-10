/** Явно игнорируем ошибку: `.catch(ignoreError)` — например, сообщение уже удалено. */
export const ignoreError = (): undefined => undefined;

/** Ничего не делает — для «пустых» колбэков. */
export const noop = (): undefined => undefined;
