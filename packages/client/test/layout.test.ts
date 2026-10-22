import { describe, expect, it } from 'vitest';
import { clampRect, isPhone, layoutMode, ndcToPixels, toastOnTop, viewOffsetFor } from '../src/hud/layout';

describe('layout da HUD', () => {
  it('escolhe um layout por tamanho de tela', () => {
    expect(layoutMode(1440, 900)).toBe('wide');
    expect(layoutMode(1280, 720)).toBe('wide');
    expect(layoutMode(768, 1024)).toBe('tablet');
    expect(layoutMode(375, 812)).toBe('phone-portrait');
    expect(layoutMode(812, 375)).toBe('phone-landscape');
    expect(isPhone(layoutMode(812, 375))).toBe(true);
    expect(isPhone(layoutMode(1024, 768))).toBe(false);
  });

  it('põe os avisos em cima em telas baixas', () => {
    expect(toastOnTop('wide', 900)).toBe(false);
    expect(toastOnTop('wide', 600)).toBe(true);
    expect(toastOnTop('phone-landscape', 375)).toBe(true);
  });

  it('enquadra a câmera no retângulo livre do palco', () => {
    const offset = viewOffsetFor(1440, 900, { x: 250, y: 80, width: 900, height: 650 });
    expect(offset).not.toBeNull();
    expect(offset!.fullWidth).toBe(900);
    expect(offset!.fullHeight).toBe(650);
    expect(offset!.x).toBe(-250);
    expect(offset!.y).toBe(-80);
    expect(offset!.width).toBe(1440);
    expect(offset!.aspect).toBeCloseTo(900 / 650);
  });

  it('usa a tela inteira para retângulos minúsculos ou cheios', () => {
    expect(viewOffsetFor(800, 600, { x: 0, y: 0, width: 800, height: 600 })).toBeNull();
    expect(viewOffsetFor(800, 600, { x: 0, y: 0, width: 100, height: 600 })).toBeNull();
    expect(viewOffsetFor(0, 0, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it('limita os retângulos à tela', () => {
    expect(clampRect({ x: -10, y: 20, width: 200, height: 1000 }, 100, 300)).toEqual({ x: 0, y: 20, width: 100, height: 280 });
  });

  it('converte NDC em pixels', () => {
    expect(ndcToPixels(0, 0, 200, 100)).toEqual({ x: 100, y: 50 });
    expect(ndcToPixels(-1, 1, 200, 100)).toEqual({ x: 0, y: 0 });
  });
});
