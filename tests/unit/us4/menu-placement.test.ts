import { describe, expect, it } from 'vitest';
import { MENU_GAP, chooseMenuPlacement, menuTopInContainer } from '@/components/chat/menuPlacement';

describe('меню «⋯»: куди відкривати', () => {
  const menuHeight = 250;

  it('під повідомленням, якщо між його низом і низом стрічки вистачає місця з відступом', () => {
    expect(chooseMenuPlacement({ anchorBottom: 100, viewBottom: 100 + MENU_GAP + menuHeight, menuHeight })).toBe('below');
    expect(chooseMenuPlacement({ anchorBottom: 100, viewBottom: 600, menuHeight })).toBe('below');
  });

  it('над повідомленням, якщо місця на 1 px менше або повідомлення біля низу', () => {
    expect(chooseMenuPlacement({ anchorBottom: 100, viewBottom: 100 + MENU_GAP + menuHeight - 1, menuHeight })).toBe('above');
    expect(chooseMenuPlacement({ anchorBottom: 580, viewBottom: 600, menuHeight })).toBe('above');
  });

  it('верх меню: 4 px під повідомленням або 4 px над ним, не виходить за колонку чату', () => {
    const base = { containerTop: 50, containerHeight: 600, menuHeight, anchorTop: 100, anchorBottom: 160 };
    expect(menuTopInContainer({ ...base, placement: 'below' })).toBe(160 - 50 + MENU_GAP);
    expect(menuTopInContainer({ ...base, placement: 'above', anchorTop: 400, anchorBottom: 460 })).toBe(400 - 50 - MENU_GAP - menuHeight);
    // над самим верхом колонки — притискається до верху; під самим низом — до низу
    expect(menuTopInContainer({ ...base, placement: 'above', anchorTop: 60, anchorBottom: 120 })).toBe(0);
    expect(menuTopInContainer({ ...base, placement: 'below', anchorTop: 590, anchorBottom: 640 })).toBe(600 - menuHeight);
  });
});
