/** «Париж · Ейфелева вежа» → «Париж» (назва міста з назви трансляції). */
export function cityOf(title: string): string {
  return title.split(' · ')[0] ?? title;
}
