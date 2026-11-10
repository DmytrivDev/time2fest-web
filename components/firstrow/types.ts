/**
 * Контракти пропсів презентаційних компонентів «Першого ряду» (C6, C8). Логіку (утримання, оплата, імітація місць)
 * тримають `stores/firstRow`, `lib/firstrow/*` і зв’язувальні компоненти `FirstRowModule` / `FirstRowWindow`;
 * компоненти нижче лише показують стан і викликають колбеки.
 */
import type { FirstRowSeat, Ms, SeatParticipant } from '@/lib/data/types';
import type { FirstRowView } from '@/lib/engine/firstRowView';
import type { FormErrors } from '@/lib/firstrow/pay';

export interface FirstRowDraftValues {
  email: string;
  name: string;
  greeting: string;
  emojiId: string;
}

/** C6. Модуль / смуга «Перший ряд». Корінь: `data-first-row-strip`, `data-state={view.state}`. */
export interface FirstRowStripProps {
  /** Місто події в називному відмінку («Лондон»). */
  city: string;
  /** Північ події (UTC мс) — «Північ о 02:00 за вашим часом». */
  midnightMs: Ms;
  view: FirstRowView;
  seats: readonly FirstRowSeat[];
  /** `tonal`, поки на сторінці коралова кнопка звуку (ІНВ 5.3); інакше `coral`. */
  takeVariant: 'coral' | 'tonal';
  onTake(): void;
  onInfo(): void;
  /** Відкрито «Що дає» (для `aria-expanded` кнопки). */
  infoOpen?: boolean;
  /** Дотик до свого місця / «Моя емоція» (O-EMOJI). */
  onOpenEmoji?(): void;
  /** «Твій квиток» (стан `mine`). */
  onOpenTicket?(): void;
  /** Дотик до чужого місця на стіні — картка учасника (O-AUTHOR). */
  onOpenParticipant?(participant: SeatParticipant): void;
  /** Після півночі: «Поділитися листівкою» (O-SHARE) — з учасником, чиє привітання піде на листівку. */
  onSharePostcard?(featured: SeatParticipant | undefined): void;
  /** Примітка стриманого режиму (`event.restrained.note.uk`). */
  restrainedNote?: string;
  /** `soldout`: «Ще є місця: Перший ряд · Дублін і ще 3 ›» — відкриває список на місці чату / шторкою. */
  soldOutAlt?: { city: string; more: number; onOpen(): void; open?: boolean };
  countryName?(flagCode: string): string | undefined;
  /** `module` — повний модуль (десктоп, сторінка країни); `compact` — смуга під плеєром на телефоні. */
  layout?: 'module' | 'compact';
  /** Рівень заголовка «Перший ряд · Лондон». */
  headingLevel?: 2 | 3;
  /** Телефон: людина розгорнула/згорнула смугу (розгортання «Першого ряду» згортає чат). */
  onToggle?(): void;
  /** Смуга спочатку розгорнута (за замовчуванням так; телефон-головна починає згорнутою). */
  defaultOpen?: boolean;
  /** Є місце (чи утримання) в тому ж поясі, місті або країні: «Зайняти місце» немає — пояснення й «Моє місце». */
  blocked?: { city: string; onOwn(): void };
  /** Телефон, головна: смуга на всю ширину під липким рядком плеєра. */
  dockBar?: boolean;
  /**
   * Планшет-портрет (`Tab-P-New`, кадр 1, 2026-11-10): згорнута смуга одним рядком з «останнє місце» й ціною праворуч.
   * Натиск на смугу чи стрілку розгортає її з учасниками, як на телефоні (правка власника 2026-11-10 — не вікно «Що дає»).
   */
  barSummary?: boolean;
  className?: string;
}

/** Рядок у вкладці «Чат» на телефоні: «Перший ряд · Лондон · 8 ›». */
export interface FirstRowChatRowProps {
  city: string;
  freeCount: number;
  onClick(): void;
  className?: string;
}

/** C8. O-FIRST-ROW-INFO «Що дає «Перший ряд»» (на місці чату / шторкою). Корінь: `data-window="O-FIRST-ROW-INFO"`. */
export interface FirstRowInfoProps {
  city: string;
  midnightMs: Ms;
  view: FirstRowView;
  /** У гостя вже є (куплений) пас — блок «−50% на кожне місце» замість «пас у подарунок». */
  hasPass?: boolean;
  /** «Зайняти місце» — завжди `coral` (у вікні звук нейтральний). Немає, якщо продаж не відкритий. */
  onTake?(): void;
  /** «Закрити». */
  onClose(): void;
  /** «‹ До списку» — вікно відкрите зі «Ще є місця». */
  onBack?(): void;
  className?: string;
}

/** «Ще є місця»: рядок списку інших «Перших рядів». */
export interface FirstRowMoreRow {
  eventId: string;
  city: string;
  country: string;
  flagCode: string;
  midnightMs: Ms;
  free: number;
  price: number;
  main: boolean;
}

/** «Ще є місця» (на місці чату / шторкою). Корінь: `data-window="O-FIRST-ROW-MORE"`. */
export interface FirstRowMoreProps {
  /** Місто розпроданого ряду. */
  city: string;
  /** Північ розпроданого ряду — для групи «Та сама північ». */
  midnightMs: Ms;
  now: Ms;
  rows: readonly FirstRowMoreRow[];
  onPick(eventId: string): void;
  onClose(): void;
  className?: string;
}

/** C8. Форма O-FIRST-ROW (також стани `declined` і `expired`). Корінь: `data-window="O-FIRST-ROW"`, `data-phase`. */
export interface FirstRowFormProps {
  city: string;
  /** Прапор гостя для прев’ю «Так тебе побачать на стіні». */
  flagCode?: string;
  midnightMs: Ms;
  freeCount: number;
  total: number;
  view: FirstRowView;
  /** Сума на кнопці «Оплатити $4,99» (з урахуванням знижки пасу й `priceChanged.to`). */
  payPrice: number;
  /** Місце тримаємо до (UTC мс) — «Місце тримаємо до 21:12». */
  holdUntil: Ms;
  /** Табло «Лишилось 1:58 з 10 хвилин»: після повернення без оплати або в останні 2 хв. */
  holdBoard?: { remainingMs: number; totalMin: number };
  /** «Ще 2 хвилини» + «Продовжити» (один раз). */
  holdWarning?: { canExtend: boolean };
  /** Утримання щойно продовжено (рядок «Продовжили — тримаємо до …»). */
  extendedUntil?: Ms;
  onExtend(): void;
  /** Текст для зчитувача (ввічливо): лише на 5 і 1 хв утримання. */
  announce?: string | null;
  /** Рядок причини над формою. */
  notice?: { kind: 'declined' } | { kind: 'expired'; free: number; price: number; holdUntil: Ms; priceChanged: boolean };
  values: FirstRowDraftValues;
  onChange(patch: Partial<FirstRowDraftValues>): void;
  /** Вибір прапора (той самий, що в O-NICK): прапор спільний для чату й квитка. */
  flag?: { detected?: string; undetected: boolean; onChange(code: string): void };
  errors?: FormErrors;
  onPay(): void;
  /** Іде перехід на сторінку оплати. */
  submitting?: boolean;
  /** Показати «Новорічний пас у подарунок» (у гостя немає пасу). */
  giftPass: boolean;
  /** «Маєш Новорічний пас? Увійди — місце на 50% дешевше» (у гостя немає купленого пасу). */
  onLoginForPass?(): void;
  /**
   * Людина увійшла: замість поля email — рядок акаунта («Квиток і лист — сюди», «Не ти?»), дошки
   * `O-FIRST-ROW · Форма, увійшов — без email`. `onPassInfo` — «що дає пас» (без купленого пасу).
   */
  account?: { email: string; onNotYou(): void; onPassInfo?(): void };
  onHelp?(): void;
  className?: string;
}

export interface FirstRowPendingProps {
  city: string;
  /** Прапор гостя для прев’ю «Так тебе побачать на стіні». */
  flagCode?: string;
  midnightMs: Ms;
  freeCount: number;
  total: number;
  preview: { name: string; emojiId: string };
  holdUntil: Ms;
  email: string;
  onClose(): void;
  onHelp?(): void;
  className?: string;
}

export interface FirstRowSuccessProps {
  city: string;
  cityId: string;
  midnightMs: Ms;
  seat: number;
  name: string;
  flagCode: string;
  emojiId: string;
  greeting: string;
  email: string;
  /** `gifted` — «Новорічний пас — у подарунок, уже активний»; `discount` — «Знижку −50% … застосовано». */
  pass: 'gifted' | 'discount';
  /** «№ LON-04». */
  ticketCode: string;
  onShare?(): void;
  onEdit(): void;
  className?: string;
}

export interface FirstRowSoldOutProps {
  city: string;
  onBack(): void;
  /** «Обрати інше святкування» — посилання на список країн. */
  otherHref: string;
  className?: string;
}

export interface FirstRowEditProps {
  city: string;
  /** Прапор гостя для прев’ю «Так тебе побачать на стіні». */
  flagCode?: string;
  seat: number;
  values: Pick<FirstRowDraftValues, 'name' | 'greeting' | 'emojiId'>;
  onChange(patch: Partial<Pick<FirstRowDraftValues, 'name' | 'greeting' | 'emojiId'>>): void;
  /** Секунд до наступної зміни емоції (0 — можна; раз на 10 с). */
  emojiWaitSec: number;
  errors?: Pick<FormErrors, 'name' | 'greeting'>;
  onSave(): void;
  onCancel(): void;
  className?: string;
}
