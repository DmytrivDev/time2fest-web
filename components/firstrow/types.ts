/**
 * Контракти пропсів презентаційних компонентів «Першого ряду» (C6, C8). Логіку (утримання, оплата, імітація місць)
 * тримають `stores/firstRow`, `lib/firstrow/*` і зв’язувальні компоненти `FirstRowModule` / `FirstRowWindow`;
 * компоненти нижче лише показують стан і викликають колбеки.
 */
import type { FirstRowSeat, Ms } from '@/lib/data/types';
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
  /** Примітка стриманого режиму (`event.restrained.note.uk`). */
  restrainedNote?: string;
  /** `closed`: «Наступний «Перший ряд» — Азорські острови о 03:00». */
  nextSale?: { city: string; midnightMs: Ms; href?: string };
  /** `soldout`: «Ще є місця: Перший ряд · Ріо-де-Жанейро». */
  soldOutAlt?: { city: string; href?: string };
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
  className?: string;
}

/** Рядок у вкладці «Чат» на телефоні: «Перший ряд · Лондон · 8 ›». */
export interface FirstRowChatRowProps {
  city: string;
  freeCount: number;
  onClick(): void;
  className?: string;
}

/** C8. O-FIRST-ROW-INFO «Що дає «Перший ряд»» (InFlowSlot). Корінь: `data-window="O-FIRST-ROW-INFO"`. */
export interface FirstRowInfoProps {
  city: string;
  midnightMs: Ms;
  view: FirstRowView;
  /** Кнопка «Зайняти місце» — завжди `coral` (у вікні звук нейтральний). Немає, якщо продаж не відкритий. */
  onTake?(): void;
  /** Десктоп: Collapsible «Згорнути». */
  onCollapse(): void;
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
