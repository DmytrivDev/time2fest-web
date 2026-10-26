/**
 * Чи людина зараз працює з карткою оцінки (фокус усередині, наведення, щойно змінена оцінка).
 * Картку малює сторінка (`Rate.onInteractionChange`), а закриття за часом рахує `EngineScheduler`
 * (`rate.isInteracting`): поки взаємодія триває, `moment:rate-close` відкладається (WCAG 2.2.1).
 * Одна вкладка — одна картка, тож досить модульного прапорця.
 */
let interacting = false;

export function setRateInteracting(value: boolean): void {
  interacting = value;
}

export function isRateInteracting(): boolean {
  return interacting;
}
